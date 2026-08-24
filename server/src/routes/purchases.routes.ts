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
import { nextPurchaseNo } from "../utils/reference.js";

const router = Router();
router.use(requireAuth);

const itemSchema = z.object({
  productId: z.string().min(1),
  variantId: z.string().nullable().optional(),
  quantity: z.number().positive(),
  purchasePrice: z.number().nonnegative(),
  discountAmount: z.number().default(0),
  taxRate: z.number().default(0),
  batchNumber: z.string().nullable().optional(),
  expiryDate: z.string().nullable().optional(),
});

const purchaseSchema = z.object({
  supplierId: z.string().min(1),
  invoiceNumber: z.string().nullable().optional(),
  invoiceDate: z.string().nullable().optional(),
  items: z.array(itemSchema).min(1),
  discountAmount: z.number().default(0),
  note: z.string().nullable().optional(),
  status: z.string().default("received"), // draft | pending | received
  payments: z
    .array(z.object({ method: z.string().default("cash"), amount: z.number().nonnegative(), reference: z.string().nullable().optional() }))
    .default([]),
});

router.get(
  "/",
  requirePermission("purchases.view"),
  asyncHandler(async (req, res) => {
    const { search, page, pageSize, sortBy, sortOrder, from, to, status } = extractQuery(req.query);
    const supplierId = typeof req.query.supplierId === "string" && req.query.supplierId ? req.query.supplierId : null;
    const where: any = {
      ...branchFilter(req),
      ...(status ? { status } : {}),
      ...(supplierId ? { supplierId } : {}),
      ...(from || to ? { createdAt: { gte: from ?? undefined, lte: to ?? undefined } } : {}),
      ...(search
        ? {
            OR: [
              { purchaseNo: { contains: search } },
              { invoiceNumber: { contains: search } },
              { supplier: { name: { contains: search } } },
            ],
          }
        : {}),
    };
    const [total, rows] = await Promise.all([
      prisma.purchase.count({ where }),
      prisma.purchase.findMany({
        where,
        include: {
          supplier: { select: { id: true, name: true } },
          user: { select: { name: true } },
          branch: { select: { name: true } },
          payments: true,
          _count: { select: { items: true } },
        },
        orderBy: { [sortBy]: sortOrder },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    res.json({ data: rows, total, page, pageSize });
  })
);

router.get(
  "/:id",
  requirePermission("purchases.view"),
  asyncHandler(async (req, res) => {
    const purchase = await prisma.purchase.findUnique({
      where: { id: req.params.id },
      include: {
        supplier: true,
        user: { select: { name: true } },
        items: { include: { product: true, variant: true, returns: true } },
        payments: true,
      },
    });
    if (!purchase) throw new AppError(404, "Purchase not found");
    res.json(purchase);
  })
);

async function computePurchase(data: z.infer<typeof purchaseSchema>) {
  let subtotal = 0;
  let tax = 0;
  let discount = 0;
  const items = [];
  for (const it of data.items) {
    const product = await prisma.product.findUnique({ where: { id: it.productId }, include: { taxRate: true } });
    if (!product) throw new AppError(422, `Product not found: ${it.productId}`);
    const gross = round2(it.quantity * it.purchasePrice);
    const disc = round2(it.discountAmount || 0);
    const rate = it.taxRate ?? product.taxRate?.rate ?? 0;
    subtotal += gross;
    discount += disc;
    tax += round2(((gross - disc) * rate) / 100);
    items.push({
      productId: product.id,
      variantId: it.variantId || null,
      quantity: it.quantity,
      purchasePrice: round2(it.purchasePrice),
      discountAmount: disc,
      taxRate: rate,
      taxAmount: round2(((gross - disc) * rate) / 100),
      total: round2(gross - disc),
      batchNumber: it.batchNumber || null,
      expiryDate: it.expiryDate ? new Date(it.expiryDate) : null,
      product,
    });
  }
  const total = round2(subtotal - discount + tax);
  return { subtotal: round2(subtotal), discount: round2(discount), tax: round2(tax), total, items };
}

router.post(
  "/",
  requirePermission("purchases.create"),
  validate(purchaseSchema),
  asyncHandler(async (req, res) => {
    const data = getValidated<z.infer<typeof purchaseSchema>>(req);
    const supplier = await prisma.supplier.findUnique({ where: { id: data.supplierId } });
    if (!supplier) throw new AppError(422, "Supplier not found");
    const { subtotal, discount, tax, total, items } = await computePurchase(data);
    const totalPayments = round2(data.payments.reduce((s, p) => s + p.amount, 0));
    const purchaseNo = await nextPurchaseNo();
    const branchId = req.auth?.branchId || null;
    const status = data.status || "received";
    const paymentStatus = totalPayments >= total - 0.001 ? "paid" : totalPayments > 0 ? "partially_paid" : "unpaid";

    const result = await prisma.$transaction(async (tx) => {
      const purchase = await tx.purchase.create({
        data: {
          purchaseNo,
          invoiceNumber: data.invoiceNumber || null,
          invoiceDate: data.invoiceDate ? new Date(data.invoiceDate) : new Date(),
          supplierId: supplier.id,
          branchId,
          userId: req.authUserId,
          subtotal,
          discountAmount: discount,
          taxAmount: tax,
          total,
          paidAmount: round2(Math.min(total, totalPayments)),
          balance: round2(Math.max(0, total - totalPayments)),
          status: status === "received" ? paymentStatus === "paid" ? "paid" : paymentStatus === "partially_paid" ? "partially_paid" : "received" : status,
          paymentStatus,
          note: data.note || null,
          receivedAt: status === "received" ? new Date() : null,
          items: {
            create: items.map((it) => ({
              productId: it.productId,
              variantId: it.variantId,
              quantity: it.quantity,
              purchasePrice: it.purchasePrice,
              discountAmount: it.discountAmount,
              taxAmount: it.taxAmount,
              taxRate: it.taxRate,
              total: it.total,
              batchNumber: it.batchNumber,
              expiryDate: it.expiryDate,
            })),
          },
        },
      });

      for (const p of data.payments) {
        await tx.purchasePayment.create({
          data: { purchaseId: purchase.id, method: p.method, amount: round2(p.amount), reference: p.reference || null },
        });
      }

      if (status === "received") {
        for (const it of items) {
          await applyStockMovement(tx, {
            productId: it.productId,
            variantId: it.variantId,
            branchId,
            type: "purchase",
            quantity: it.quantity,
            userId: req.authUserId,
            referenceType: "purchase",
            referenceId: purchase.id,
            note: `Purchase ${purchaseNo}`,
          });
          if (it.batchNumber && it.product.trackBatch) {
            await tx.productBatch.create({
              data: {
                productId: it.productId,
                batchNumber: it.batchNumber,
                expiryDate: it.expiryDate,
                quantity: it.quantity,
                branchId,
                purchaseId: purchase.id,
              },
            });
          }
        }
        const lastTx = await tx.supplierTransaction.findFirst({
          where: { supplierId: supplier.id },
          orderBy: { date: "desc" },
        });
        const outstanding = lastTx?.balanceAfter ?? supplier.openingBalance;
        await tx.supplierTransaction.create({
          data: {
            supplierId: supplier.id,
            type: "purchase",
            amount: total,
            referenceId: purchase.id,
            balanceAfter: round2(outstanding + total - totalPayments),
            note: `Purchase ${purchaseNo}`,
          },
        });
      }

      await tx.auditLog.create({
        data: {
          userId: req.authUserId,
          action: "CREATE_PURCHASE",
          module: "purchases",
          entityType: "purchase",
          entityId: purchase.id,
          details: JSON.stringify({ purchaseNo, total }),
        },
      });
      return purchase;
    });

    res.status(201).json({ ok: true, id: result.id, purchaseNo: result.purchaseNo, total: result.total });
  })
);

router.post(
  "/:id/receive",
  requirePermission("purchases.receive"),
  asyncHandler(async (req, res) => {
    const purchase = await prisma.purchase.findUnique({
      where: { id: req.params.id },
      include: { items: true, supplier: true },
    });
    if (!purchase) throw new AppError(404, "Purchase not found");
    if (purchase.status === "received" || purchase.status === "paid" || purchase.status === "partially_paid") {
      throw new AppError(400, "Purchase already received");
    }
    if (purchase.status === "cancelled") throw new AppError(400, "Purchase is cancelled");

    const branchId = req.auth?.branchId || null;
    await prisma.$transaction(async (tx) => {
      await tx.purchase.update({
        where: { id: purchase.id },
        data: {
          status: purchase.paymentStatus === "paid" ? "paid" : purchase.paymentStatus === "partially_paid" ? "partially_paid" : "received",
          receivedAt: new Date(),
        },
      });
      for (const it of purchase.items) {
        await applyStockMovement(tx, {
          productId: it.productId!,
          variantId: it.variantId,
          branchId,
          type: "purchase",
          quantity: it.quantity,
          userId: req.authUserId,
          referenceType: "purchase",
          referenceId: purchase.id,
          note: `Receive ${purchase.purchaseNo}`,
        });
        if (it.batchNumber) {
          await tx.productBatch.create({
            data: {
              productId: it.productId!,
              batchNumber: it.batchNumber,
              expiryDate: it.expiryDate,
              quantity: it.quantity,
              branchId,
              purchaseId: purchase.id,
            },
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
          type: "purchase",
          amount: purchase.total,
          referenceId: purchase.id,
          balanceAfter: round2(outstanding + purchase.total - purchase.paidAmount),
          note: `Receive ${purchase.purchaseNo}`,
        },
      });
      await tx.auditLog.create({
        data: {
          userId: req.authUserId,
          action: "RECEIVE_PURCHASE",
          module: "purchases",
          entityType: "purchase",
          entityId: purchase.id,
        },
      });
    });
    res.json({ ok: true });
  })
);

router.post(
  "/:id/payments",
  requirePermission("purchases.pay"),
  validate(
    z.object({
      method: z.string().default("cash"),
      amount: z.number().positive(),
      reference: z.string().nullable().optional(),
      date: z.string().nullable().optional(),
    })
  ),
  asyncHandler(async (req, res) => {
    const data = getValidated<{ method: string; amount: number; reference?: string | null; date?: string | null }>(req);
    const purchase = await prisma.purchase.findUnique({ where: { id: req.params.id }, include: { supplier: true } });
    if (!purchase) throw new AppError(404, "Purchase not found");
    const paid = round2(purchase.paidAmount + data.amount);
    const status = paid >= purchase.total - 0.001 ? "paid" : "partially_paid";
    await prisma.$transaction(async (tx) => {
      await tx.purchasePayment.create({
        data: {
          purchaseId: purchase.id,
          method: data.method,
          amount: round2(data.amount),
          reference: data.reference || null,
          paidAt: data.date ? new Date(data.date) : new Date(),
        },
      });
      await tx.purchase.update({
        where: { id: purchase.id },
        data: {
          paidAmount: paid,
          balance: round2(purchase.total - paid),
          paymentStatus: status === "paid" ? "paid" : "partially_paid",
          status: status === "paid" ? "paid" : purchase.status === "draft" || purchase.status === "pending" ? purchase.status : "partially_paid",
        },
      });
      const lastTx = await tx.supplierTransaction.findFirst({
        where: { supplierId: purchase.supplierId },
        orderBy: { date: "desc" },
      });
      const outstanding = lastTx?.balanceAfter ?? purchase.supplier.openingBalance;
      await tx.supplierTransaction.create({
        data: {
          supplierId: purchase.supplierId,
          type: "payment",
          amount: data.amount,
          referenceId: purchase.id,
          balanceAfter: round2(outstanding - data.amount),
          note: `Payment for ${purchase.purchaseNo}`,
        },
      });
    });
    await auditLog({ userId: req.authUserId, action: "PURCHASE_PAYMENT", module: "purchases", entityId: purchase.id, details: { amount: data.amount } });
    res.json({ ok: true });
  })
);

router.post(
  "/:id/cancel",
  requirePermission("purchases.edit"),
  asyncHandler(async (req, res) => {
    const purchase = await prisma.purchase.findUnique({ where: { id: req.params.id } });
    if (!purchase) throw new AppError(404, "Purchase not found");
    if (purchase.status === "paid" || purchase.status === "partially_paid" || purchase.status === "received") {
      throw new AppError(400, "Received purchase cannot be cancelled. Use a purchase return instead.");
    }
    await prisma.purchase.update({ where: { id: purchase.id }, data: { status: "cancelled" } });
    await auditLog({ userId: req.authUserId, action: "CANCEL_PURCHASE", module: "purchases", entityId: purchase.id });
    res.json({ ok: true });
  })
);

export default router;