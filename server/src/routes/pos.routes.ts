import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { requireAuth, requirePermission, isSuperAdmin } from "../middleware/auth.js";
import { validate, getValidated } from "../middleware/validate.js";
import { asyncHandler, AppError } from "../middleware/error.js";
import { auditLog } from "../utils/audit.js";
import { consumeStock, getStock } from "../utils/inventory.js";
import { round2, roundOff } from "../utils/numbers.js";
import { nextSaleNo } from "../utils/reference.js";
import { getSetting, getSettings } from "../utils/settings.js";
import { checkStockAlerts, notify } from "../utils/notify.js";

const router = Router();
router.use(requireAuth);

router.get(
  "/products",
  requirePermission("pos.access"),
  asyncHandler(async (req, res) => {
    const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
    const categoryId = typeof req.query.categoryId === "string" ? req.query.categoryId : null;
    const brandId = typeof req.query.brandId === "string" ? req.query.brandId : null;
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(50, Math.max(1, Number(req.query.pageSize) || 24));
    const branchId = req.auth?.branchId || null;
    const where: any = {
      status: "active",
      ...(categoryId ? { categoryId } : {}),
      ...(brandId ? { brandId } : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search } },
              { sku: { contains: search } },
              { barcode: { contains: search } },
              { code: { contains: search } },
              { variants: { some: { barcode: { contains: search } } } },
            ],
          }
        : {}),
    };
    const [total, rows] = await Promise.all([
      prisma.product.count({ where }),
      prisma.product.findMany({
        where,
        include: {
          category: true,
          brand: true,
          unit: true,
          taxRate: true,
          variants: true,
          inventories: { where: { branchId } },
        },
        orderBy: { name: "asc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    res.json({
      data: rows.map((p) => ({
        id: p.id,
        name: p.name,
        sku: p.sku,
        barcode: p.barcode,
        sellingPrice: p.sellingPrice,
        mrp: p.mrp,
        wholesalePrice: p.wholesalePrice,
        stock: p.inventories.reduce((s, i) => s + i.quantity, 0),
        unit: p.unit?.shortName || "pcs",
        category: p.category?.name || "",
        brand: p.brand?.name || "",
        taxRate: p.taxRate?.rate || 0,
        taxType: p.taxRate?.type || "exclusive",
        image: p.image,
        hasVariants: p.hasVariants,
        variants: p.variants.map((v) => ({
          id: v.id,
          name: v.name,
          sku: v.sku,
          barcode: v.barcode,
          sellingPrice: v.sellingPrice,
          stock: 0,
        })),
      })),
      total,
      page,
      pageSize,
    });
  })
);

router.get(
  "/stock/:productId",
  requirePermission("pos.access"),
  asyncHandler(async (req, res) => {
    const branchId = req.auth?.branchId || null;
    const product = await prisma.product.findUnique({
      where: { id: req.params.productId },
      include: { inventories: { where: { branchId } }, variants: { include: { inventories: { where: { branchId } } } } },
    });
    if (!product) throw new AppError(404, "Product not found");
    res.json({
      stock: product.inventories.reduce((s, i) => s + i.quantity, 0),
      variants: product.variants.map((v) => ({
        id: v.id,
        stock: v.inventories.reduce((s, i) => s + i.quantity, 0),
      })),
    });
  })
);

const itemSchema = z.object({
  productId: z.string().min(1),
  variantId: z.string().nullable().optional(),
  quantity: z.number().positive(),
  price: z.number().nonnegative(),
  discountAmount: z.number().default(0),
  taxRate: z.number().default(0),
  taxType: z.string().default("exclusive"),
  note: z.string().nullable().optional(),
});

const paymentSchema = z.object({
  method: z.enum(["cash", "upi", "card", "bank", "credit", "loyalty"]),
  amount: z.number().nonnegative(),
  reference: z.string().nullable().optional(),
});

const completeSchema = z.object({
  saleId: z.string().nullable().optional(),
  customerId: z.string().nullable().optional(),
  items: z.array(itemSchema).min(1),
  payments: z.array(paymentSchema).min(1),
  discountAmount: z.number().default(0),
  discountPercent: z.number().default(0),
  couponCode: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
});

function canApplyDiscount(req: any): { allowed: boolean; maxPercent: number } {
  const has = req.auth?.permissions.has("sales.discount") || req.auth?.permissions.has("pos.discount");
  const maxPercent = Number(process.env.MAX_DISCOUNT_PERCENT || 100);
  return { allowed: !!has, maxPercent };
}

router.post(
  "/complete",
  requirePermission("pos.access"),
  validate(completeSchema),
  asyncHandler(async (req, res) => {
    const data = getValidated<z.infer<typeof completeSchema>>(req);
    const settings = await getSettings();
    const branchId = req.auth?.branchId || null;
    const maxDiscount = Number(settings["pos.maxDiscountPercent"] || "100");
    const hasDiscountPerm = req.auth?.permissions.has("sales.discount") || req.auth?.permissions.has("pos.discount");
    const effectiveMax = Math.min(maxDiscount, hasDiscountPerm ? 100 : 0);

    let gross = 0;
    let totalDiscount = 0;
    let totalTax = 0;
    const validatedItems: {
      product: any;
      variantId: string | null;
      quantity: number;
      price: number;
      discountAmount: number;
      taxRate: number;
      taxType: string;
      note: string | null;
      taxable: number;
      taxAmount: number;
      total: number;
    }[] = [];

    for (const it of data.items) {
      const product = await prisma.product.findUnique({
        where: { id: it.productId },
        include: { taxRate: true },
      });
      if (!product || product.status !== "active") throw new AppError(422, `Product not found: ${it.productId}`);
      let price = it.price;
      let variantId: string | null = null;
      if (it.variantId) {
        const variant = await prisma.productVariant.findUnique({ where: { id: it.variantId } });
        if (!variant || variant.productId !== product.id) throw new AppError(422, "Invalid variant");
        variantId = variant.id;
        price = it.price || variant.sellingPrice;
      }
      if (price <= 0) price = product.sellingPrice;
      const stock = await getStock(product.id, variantId, branchId);
      if (stock < it.quantity) {
        throw new AppError(422, `Insufficient stock for ${product.name} (available: ${stock})`);
      }
      const itemGross = round2(it.quantity * price);
      const itemDiscount = round2(it.discountAmount || 0);
      const taxable = round2(itemGross - itemDiscount);
      const rate = it.taxRate ?? product.taxRate?.rate ?? 0;
      const taxType = it.taxType ?? product.taxRate?.type ?? "exclusive";
      const taxAmount = taxType === "inclusive" ? round2((taxable * rate) / (100 + rate)) : round2((taxable * rate) / 100);
      gross += itemGross;
      totalDiscount += itemDiscount;
      totalTax += taxAmount;
      validatedItems.push({
        product,
        variantId,
        quantity: it.quantity,
        price: round2(price),
        discountAmount: itemDiscount,
        taxRate: rate,
        taxType,
        note: it.note || null,
        taxable,
        taxAmount,
        total: taxable,
      });
    }

    const discountCap = round2((gross * effectiveMax) / 100);
    const billDiscount = round2(Math.min(data.discountAmount || 0, discountCap));
    if (data.discountAmount && data.discountAmount > discountCap + 0.001) {
      throw new AppError(403, `Discount exceeds your limit (max ${effectiveMax}% = ${discountCap.toFixed(2)})`);
    }
    totalDiscount += billDiscount;

    let couponDiscount = 0;
    let coupon: any = null;
    if (data.couponCode) {
      coupon = await prisma.coupon.findUnique({ where: { code: data.couponCode.toUpperCase() } });
      if (!coupon) throw new AppError(422, "Invalid coupon code");
      const now = new Date();
      if (coupon.status !== "active") throw new AppError(422, "Coupon is not active");
      if (coupon.validFrom && now < coupon.validFrom) throw new AppError(422, "Coupon not yet valid");
      if (coupon.validTo && now > coupon.validTo) throw new AppError(422, "Coupon has expired");
      if (coupon.usageLimit > 0 && coupon.usedCount >= coupon.usageLimit) throw new AppError(422, "Coupon usage limit reached");
      if (coupon.minAmount > 0 && gross - totalDiscount < coupon.minAmount) {
        throw new AppError(422, `Minimum purchase for coupon is ${coupon.minAmount}`);
      }
      couponDiscount =
        coupon.type === "percent" ? round2(((gross - totalDiscount) * coupon.value) / 100) : Math.min(coupon.value, gross - totalDiscount);
      if (coupon.maxDiscount) couponDiscount = Math.min(couponDiscount, coupon.maxDiscount);
      totalDiscount += couponDiscount;
    }

    const subtotal = round2(gross);
    const taxableBase = round2(subtotal - totalDiscount);
    const { value: total, roundOff: ro } = roundOff(taxableBase + totalTax);
    const totalPayments = round2(data.payments.reduce((s, p) => s + p.amount, 0));
    if (totalPayments < total - 0.001 && !data.payments.some((p) => p.method === "credit")) {
      const creditOk = req.auth?.permissions.has("customers.credit") && data.customerId;
      if (!creditOk) throw new AppError(422, "Payment amount is less than total. Use credit only for registered customers.");
    }

    let customer: any = null;
    if (data.customerId) {
      customer = await prisma.customer.findUnique({ where: { id: data.customerId } });
      if (!customer) throw new AppError(422, "Customer not found");
      const lastTx = await prisma.customerTransaction.findFirst({
        where: { customerId: customer.id },
        orderBy: { date: "desc" },
      });
      const outstanding = lastTx?.balanceAfter ?? customer.openingBalance;
      const newBalance = round2(outstanding + Math.max(0, total - totalPayments));
      if (newBalance > customer.creditLimit + 0.001 && customer.creditLimit > 0 && !isSuperAdmin(req)) {
        throw new AppError(422, `Credit limit exceeded for ${customer.name} (limit: ${customer.creditLimit})`);
      }
    }

    let saleId = data.saleId;
    if (saleId) {
      const held = await prisma.sale.findUnique({ where: { id: saleId }, include: { items: true } });
      if (!held || held.status !== "held") throw new AppError(422, "Held bill not found");
    }

    const invoiceNo = await nextSaleNo();
    const loyaltyEnabled = settings["loyalty.enabled"] === "true";
    const pointsPerAmount = Number(settings["loyalty.pointsPerAmount"] || "100");

    const result = await prisma.$transaction(async (tx) => {
      let sale;
      if (saleId) {
        sale = await tx.sale.update({
          where: { id: saleId },
          data: {
            invoiceNo,
            customerId: customer?.id || null,
            subtotal,
            discountAmount: round2(totalDiscount),
            discountPercent: data.discountPercent,
            taxAmount: round2(totalTax),
            roundOff: ro,
            total,
            paidAmount: round2(Math.min(total, totalPayments)),
            balance: round2(Math.max(0, total - totalPayments)),
            status: "completed",
            paymentStatus: totalPayments >= total - 0.001 ? "paid" : totalPayments > 0 ? "partial" : "credit",
            couponId: coupon?.id || null,
            note: data.note || null,
            userId: req.authUserId,
          },
        });
        await tx.saleItem.deleteMany({ where: { saleId } });
      } else {
        sale = await tx.sale.create({
          data: {
            invoiceNo,
            customerId: customer?.id || null,
            branchId,
            userId: req.authUserId,
            subtotal,
            discountAmount: round2(totalDiscount),
            discountPercent: data.discountPercent,
            taxAmount: round2(totalTax),
            roundOff: ro,
            total,
            paidAmount: round2(Math.min(total, totalPayments)),
            balance: round2(Math.max(0, total - totalPayments)),
            status: "completed",
            paymentStatus: totalPayments >= total - 0.001 ? "paid" : totalPayments > 0 ? "partial" : "credit",
            couponId: coupon?.id || null,
            note: data.note || null,
          },
        });
      }

      for (const it of validatedItems) {
        const item = await tx.saleItem.create({
          data: {
            saleId: sale.id,
            productId: it.product.id,
            variantId: it.variantId,
            quantity: it.quantity,
            price: it.price,
            costPrice: it.product.purchasePrice || 0,
            discountAmount: it.discountAmount,
            taxAmount: it.taxAmount,
            taxRate: it.taxRate,
            total: it.total,
            note: it.note,
          },
        });
        await consumeStock(tx, {
          productId: it.product.id,
          variantId: it.variantId,
          branchId,
          type: "sale",
          quantity: it.quantity,
          userId: req.authUserId,
          referenceType: "sale",
          referenceId: sale.id,
          note: `Sale ${invoiceNo}`,
        });
        if (it.product.trackSerial) {
          // serials tracked on sale item for serial-number products
        }
        void item;
      }

      let redeemedPoints = 0;
      for (const p of data.payments) {
        let amount = p.amount;
        if (p.method === "loyalty" && customer && loyaltyEnabled) {
          const pointValue = Number(settings["loyalty.pointValue"] || "1");
          const pointsNeeded = round2(amount / pointValue);
          if (customer.loyaltyPoints < pointsNeeded) throw new AppError(422, "Insufficient loyalty points");
          redeemedPoints += pointsNeeded;
          await tx.loyaltyPoint.create({
            data: {
              customerId: customer.id,
              type: "redeem",
              points: -pointsNeeded,
              balanceAfter: round2(customer.loyaltyPoints - redeemedPoints),
              referenceId: sale.id,
              note: `Redeemed on ${invoiceNo}`,
            },
          });
          await tx.customer.update({
            where: { id: customer.id },
            data: { loyaltyPoints: round2(customer.loyaltyPoints - redeemedPoints) },
          });
          amount = 0;
        }
        await tx.salePayment.create({
          data: {
            saleId: sale.id,
            method: p.method,
            amount: round2(amount),
            reference: p.reference || null,
          },
        });
      }

      if (customer) {
        const earned = loyaltyEnabled ? round2(totalPayments / pointsPerAmount) : 0;
        const lastTx = await tx.customerTransaction.findFirst({
          where: { customerId: customer.id },
          orderBy: { date: "desc" },
        });
        const outstanding = lastTx?.balanceAfter ?? customer.openingBalance;
        const newBalance = round2(outstanding + Math.max(0, total - totalPayments));
        await tx.customerTransaction.create({
          data: {
            customerId: customer.id,
            type: "sale",
            amount: total,
            referenceId: sale.id,
            balanceAfter: newBalance,
            note: `Invoice ${invoiceNo}`,
          },
        });
        if (earned > 0) {
          await tx.loyaltyPoint.create({
            data: {
              customerId: customer.id,
              type: "earn",
              points: earned,
              balanceAfter: round2(customer.loyaltyPoints - redeemedPoints + earned),
              referenceId: sale.id,
              note: `Earned on ${invoiceNo}`,
            },
          });
          await tx.customer.update({
            where: { id: customer.id },
            data: { loyaltyPoints: round2(customer.loyaltyPoints - redeemedPoints + earned) },
          });
        }
      }

      if (coupon) {
        await tx.coupon.update({ where: { id: coupon.id }, data: { usedCount: { increment: 1 } } });
      }

      await tx.invoice.create({
        data: {
          invoiceNo,
          saleId: sale.id,
          template: "a4",
          items: {
            create: validatedItems.map((it) => ({
              productId: it.product.id,
              productName: it.product.name,
              quantity: it.quantity,
              price: it.price,
              discountAmount: it.discountAmount,
              taxAmount: it.taxAmount,
              total: it.total,
            })),
          },
        },
      });

      await tx.auditLog.create({
        data: {
          userId: req.authUserId,
          action: "COMPLETE_SALE",
          module: "pos",
          entityType: "sale",
          entityId: sale.id,
          details: JSON.stringify({ invoiceNo, total, payments: totalPayments }),
        },
      });
      return sale;
    });

    checkStockAlerts().catch(() => {});
    res.status(201).json({ ok: true, saleId: result.id, invoiceNo: result.invoiceNo, total: result.total });
  })
);

const holdSchema = z.object({
  customerId: z.string().nullable().optional(),
  items: z.array(itemSchema).min(1),
  discountAmount: z.number().default(0),
  note: z.string().nullable().optional(),
});

router.post(
  "/hold",
  requirePermission("pos.access"),
  validate(holdSchema),
  asyncHandler(async (req, res) => {
    const data = getValidated<z.infer<typeof holdSchema>>(req);
    const branchId = req.auth?.branchId || null;
    let gross = 0;
    let discount = 0;
    const items: any[] = [];
    for (const it of data.items) {
      const product = await prisma.product.findUnique({
        where: { id: it.productId },
        include: { taxRate: true },
      });
      if (!product) throw new AppError(422, "Product not found");
      const itemGross = round2(it.quantity * (it.price || product.sellingPrice));
      gross += itemGross;
      discount += it.discountAmount || 0;
      items.push({
        productId: it.productId,
        variantId: it.variantId || null,
        quantity: it.quantity,
        price: it.price || product.sellingPrice,
        discountAmount: it.discountAmount || 0,
        taxRate: it.taxRate || (product as any).taxRate?.rate || 0,
        total: round2(itemGross - (it.discountAmount || 0)),
        note: it.note || null,
      });
    }
    const sale = await prisma.$transaction(async (tx) => {
      const s = await tx.sale.create({
        data: {
          invoiceNo: `HELD-${Date.now()}`,
          customerId: data.customerId || null,
          branchId,
          userId: req.authUserId,
          subtotal: round2(gross),
          discountAmount: round2(discount),
          total: round2(gross - discount),
          status: "held",
          paymentStatus: "unpaid",
          note: data.note || null,
          items: { create: items },
        },
      });
      await tx.auditLog.create({
        data: {
          userId: req.authUserId,
          action: "HOLD_SALE",
          module: "pos",
          entityType: "sale",
          entityId: s.id,
          details: JSON.stringify({ total: s.total }),
        },
      });
      return s;
    });
    res.status(201).json({ ok: true, id: sale.id });
  })
);

router.get(
  "/holds",
  requirePermission("pos.access"),
  asyncHandler(async (req, res) => {
    const rows = await prisma.sale.findMany({
      where: { status: "held", branchId: req.auth?.branchId || undefined },
      include: { customer: true, items: { include: { product: { select: { name: true } }, variant: { select: { name: true } } } } },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    res.json(rows);
  })
);

router.get(
  "/holds/:id",
  requirePermission("pos.access"),
  asyncHandler(async (req, res) => {
    const sale = await prisma.sale.findUnique({
      where: { id: req.params.id },
      include: { customer: true, items: { include: { product: true, variant: true } } },
    });
    if (!sale) throw new AppError(404, "Held bill not found");
    res.json(sale);
  })
);

router.post(
  "/cancel/:id",
  requirePermission("pos.cancel"),
  asyncHandler(async (req, res) => {
    const sale = await prisma.sale.findUnique({ where: { id: req.params.id } });
    if (!sale) throw new AppError(404, "Sale not found");
    if (sale.status === "held") {
      await prisma.sale.update({ where: { id: sale.id }, data: { status: "cancelled" } });
    } else if (sale.status === "completed" && isSuperAdmin(req)) {
      await prisma.sale.update({ where: { id: sale.id }, data: { status: "cancelled" } });
    } else {
      throw new AppError(403, "Only held bills can be cancelled");
    }
    await auditLog({ userId: req.authUserId, action: "CANCEL_SALE", module: "pos", entityId: sale.id, details: { invoiceNo: sale.invoiceNo } });
    res.json({ ok: true });
  })
);

export default router;