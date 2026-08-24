import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";
import { validate, getValidated } from "../middleware/validate.js";
import { asyncHandler, AppError } from "../middleware/error.js";
import { auditLog } from "../utils/audit.js";
import { extractQuery, branchFilter } from "../utils/helpers.js";
import { applyStockMovement } from "../utils/inventory.js";
import { round2 } from "../utils/numbers.js";
import { nextSalesReturnNo, nextPurchaseReturnNo } from "../utils/reference.js";

const router = Router();
router.use(requireAuth);

const returnItemSchema = z.object({
  saleItemId: z.string().min(1),
  quantity: z.number().positive(),
  reason: z.string().nullable().optional(),
});

const salesReturnSchema = z.object({
  saleId: z.string().min(1),
  items: z.array(returnItemSchema).min(1),
  refundMethod: z.string().default("cash"),
  restocked: z.boolean().default(true),
  note: z.string().nullable().optional(),
});

router.post(
  "/sales",
  requirePermission("returns.create"),
  validate(salesReturnSchema),
  asyncHandler(async (req, res) => {
    const data = getValidated<z.infer<typeof salesReturnSchema>>(req);
    const sale = await prisma.sale.findUnique({
      where: { id: data.saleId },
      include: {
        items: { include: { product: true, variant: true, returns: true } },
        customer: true,
      },
    });
    if (!sale || sale.status !== "completed") throw new AppError(422, "Original invoice not found or not completed");

    let refundAmount = 0;
    let subtotal = 0;
    const validated: { saleItem: any; quantity: number; reason: string | null }[] = [];
    for (const it of data.items) {
      const saleItem = sale.items.find((si) => si.id === it.saleItemId);
      if (!saleItem) throw new AppError(422, "Sale item not found in original invoice");
      const alreadyReturned = saleItem.returnedQty || 0;
      const available = saleItem.quantity - alreadyReturned;
      if (it.quantity > available + 0.001) {
        throw new AppError(422, `Cannot return ${it.quantity} of ${saleItem.product?.name} (max ${available} returnable)`);
      }
      subtotal += round2(it.quantity * saleItem.price);
      validated.push({ saleItem, quantity: it.quantity, reason: it.reason || null });
    }
    refundAmount = round2(Math.min(subtotal, sale.total));

    const returnNo = await nextSalesReturnNo();
    const branchId = req.auth?.branchId || null;

    const result = await prisma.$transaction(async (tx) => {
      const ret = await tx.salesReturn.create({
        data: {
          returnNo,
          saleId: sale.id,
          customerId: sale.customerId,
          branchId: branchId || sale.branchId,
          userId: req.authUserId,
          subtotal: round2(subtotal),
          refundAmount,
          reason: data.note || null,
          restocked: data.restocked,
          items: {
            create: validated.map((v) => ({
              saleItemId: v.saleItem.id,
              productId: v.saleItem.productId,
              quantity: v.quantity,
              price: v.saleItem.price,
              amount: round2(v.quantity * v.saleItem.price),
              reason: v.reason,
            })),
          },
        },
      });

      for (const v of validated) {
        await tx.saleItem.update({
          where: { id: v.saleItem.id },
          data: { returnedQty: { increment: v.quantity } },
        });
        if (data.restocked) {
          await applyStockMovement(tx, {
            productId: v.saleItem.productId!,
            variantId: v.saleItem.variantId,
            branchId,
            type: "return",
            quantity: v.quantity,
            userId: req.authUserId,
            referenceType: "sales_return",
            referenceId: ret.id,
            note: `Return ${returnNo}`,
          });
        }
      }

      if (sale.customer) {
        const lastTx = await tx.customerTransaction.findFirst({
          where: { customerId: sale.customerId! },
          orderBy: { date: "desc" },
        });
        const outstanding = lastTx?.balanceAfter ?? sale.customer.openingBalance;
        const newBalance = round2(outstanding - refundAmount);
        await tx.customerTransaction.create({
          data: {
            customerId: sale.customerId!,
            type: "return",
            amount: -refundAmount,
            referenceId: ret.id,
            balanceAfter: newBalance,
            note: `Refund for ${sale.invoiceNo}`,
          },
        });
      }

      if (data.refundMethod === "cash" && sale.paymentStatus === "paid") {
        // cash refund only if original payment was cash; otherwise it offsets balance
      }

      await tx.auditLog.create({
        data: {
          userId: req.authUserId,
          action: "SALES_RETURN",
          module: "returns",
          entityType: "salesReturn",
          entityId: ret.id,
          details: JSON.stringify({ returnNo, refundAmount, original: sale.invoiceNo }),
        },
      });
      return ret;
    });

    if (refundAmount > 10000) {
      // large refunds trigger notification for review
      const { notify } = await import("../utils/notify.js");
      await notify({
        type: "large_refund",
        title: "Large refund processed",
        message: `${result.returnNo} refunded ${refundAmount.toFixed(2)} against ${sale.invoiceNo}`,
        link: "/sales-returns",
      });
    }

    res.status(201).json({ ok: true, id: result.id, returnNo: result.returnNo, refundAmount });
  })
);

router.get(
  "/sales",
  requirePermission("returns.view"),
  asyncHandler(async (req, res) => {
    const { search, page, pageSize, from, to } = extractQuery(req.query);
    const where: any = {
      ...branchFilter(req),
      ...(from || to ? { createdAt: { gte: from ?? undefined, lte: to ?? undefined } } : {}),
      ...(search
        ? {
            OR: [
              { returnNo: { contains: search } },
              { sale: { invoiceNo: { contains: search } } },
              { customer: { name: { contains: search } } },
            ],
          }
        : {}),
    };
    const [total, rows] = await Promise.all([
      prisma.salesReturn.count({ where }),
      prisma.salesReturn.findMany({
        where,
        include: {
          sale: { select: { invoiceNo: true } },
          customer: { select: { name: true } },
          user: { select: { name: true } },
          items: true,
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    res.json({ data: rows, total, page, pageSize });
  })
);

// ==================== PURCHASE RETURNS ====================

const purchaseReturnSchema = z.object({
  purchaseId: z.string().min(1),
  items: z
    .array(
      z.object({
        purchaseItemId: z.string().min(1),
        quantity: z.number().positive(),
        reason: z.string().nullable().optional(),
      })
    )
    .min(1),
  restocked: z.boolean().default(false),
  note: z.string().nullable().optional(),
});

router.post(
  "/purchases",
  requirePermission("purchases.return"),
  validate(purchaseReturnSchema),
  asyncHandler(async (req, res) => {
    const data = getValidated<z.infer<typeof purchaseReturnSchema>>(req);
    const purchase = await prisma.purchase.findUnique({
      where: { id: data.purchaseId },
      include: { items: { include: { product: true } }, supplier: true },
    });
    if (!purchase || purchase.status === "cancelled") throw new AppError(422, "Purchase not found");

    let amount = 0;
    const validated: { purchaseItem: any; quantity: number; reason: string | null }[] = [];
    for (const it of data.items) {
      const item = purchase.items.find((pi) => pi.id === it.purchaseItemId);
      if (!item) throw new AppError(422, "Purchase item not found");
      const available = item.quantity - (item.returnedQty || 0);
      if (it.quantity > available + 0.001) throw new AppError(422, `Cannot return more than ${available}`);
      amount += round2(it.quantity * item.purchasePrice);
      validated.push({ purchaseItem: item, quantity: it.quantity, reason: it.reason || null });
    }

    const returnNo = await nextPurchaseReturnNo();
    const branchId = req.auth?.branchId || null;
    const result = await prisma.$transaction(async (tx) => {
      const ret = await tx.purchaseReturn.create({
        data: {
          returnNo,
          purchaseId: purchase.id,
          supplierId: purchase.supplierId,
          branchId: branchId || purchase.branchId,
          userId: req.authUserId,
          amount: round2(amount),
          reason: data.note || null,
          restocked: data.restocked,
          items: {
            create: validated.map((v) => ({
              purchaseItemId: v.purchaseItem.id,
              productId: v.purchaseItem.productId,
              quantity: v.quantity,
              price: v.purchaseItem.purchasePrice,
              amount: round2(v.quantity * v.purchaseItem.purchasePrice),
              reason: v.reason,
            })),
          },
        },
      });

      for (const v of validated) {
        await tx.purchaseItem.update({
          where: { id: v.purchaseItem.id },
          data: { returnedQty: { increment: v.quantity } },
        });
        if (!data.restocked) {
          await applyStockMovement(tx, {
            productId: v.purchaseItem.productId!,
            variantId: v.purchaseItem.variantId,
            branchId,
            type: "return",
            quantity: -v.quantity,
            userId: req.authUserId,
            referenceType: "purchase_return",
            referenceId: ret.id,
            note: `Purchase return ${returnNo}`,
          });
        }
      }

      const lastTx = await tx.supplierTransaction.findFirst({
        where: { supplierId: purchase.supplierId },
        orderBy: { date: "desc" },
      });
      const outstanding = lastTx?.balanceAfter ?? purchase.supplier.openingBalance;
      await tx.supplierTransaction.create({
        data: {
          supplierId: purchase.supplierId,
          type: "return",
          amount: -amount,
          referenceId: ret.id,
          balanceAfter: round2(outstanding - amount),
          note: `Purchase return ${returnNo}`,
        },
      });

      await tx.auditLog.create({
        data: {
          userId: req.authUserId,
          action: "PURCHASE_RETURN",
          module: "returns",
          entityType: "purchaseReturn",
          entityId: ret.id,
          details: JSON.stringify({ returnNo, amount }),
        },
      });
      return ret;
    });
    res.status(201).json({ ok: true, id: result.id, returnNo: result.returnNo, amount: round2(amount) });
  })
);

router.get(
  "/purchases",
  requirePermission("returns.view"),
  asyncHandler(async (req, res) => {
    const { search, page, pageSize, from, to } = extractQuery(req.query);
    const where: any = {
      ...(from || to ? { createdAt: { gte: from ?? undefined, lte: to ?? undefined } } : {}),
      ...(search ? { OR: [{ returnNo: { contains: search } }, { supplier: { name: { contains: search } } }] } : {}),
    };
    const [total, rows] = await Promise.all([
      prisma.purchaseReturn.count({ where }),
      prisma.purchaseReturn.findMany({
        where,
        include: {
          purchase: { select: { purchaseNo: true } },
          supplier: { select: { name: true } },
          items: true,
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    res.json({ data: rows, total, page, pageSize });
  })
);

export default router;