import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";
import { validate, getValidated } from "../middleware/validate.js";
import { asyncHandler, AppError } from "../middleware/error.js";
import { auditLog } from "../utils/audit.js";

const router = Router();
router.use(requireAuth);

// ==================== COUPONS ====================

const couponSchema = z.object({
  code: z.string().min(1),
  type: z.enum(["percent", "fixed"]),
  value: z.number().positive(),
  minAmount: z.number().default(0),
  maxDiscount: z.number().nullable().optional(),
  usageLimit: z.number().default(0),
  validFrom: z.string().nullable().optional(),
  validTo: z.string().nullable().optional(),
  status: z.string().default("active"),
  customerId: z.string().nullable().optional(),
  productId: z.string().nullable().optional(),
});

router.get(
  "/coupons",
  requirePermission("coupons.manage"),
  asyncHandler(async (_req, res) => {
    const rows = await prisma.coupon.findMany({
      include: { customer: { select: { name: true } }, product: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
    });
    res.json(rows);
  })
);

router.post(
  "/coupons",
  requirePermission("coupons.manage"),
  validate(couponSchema),
  asyncHandler(async (req, res) => {
    const data = getValidated<z.infer<typeof couponSchema>>(req);
    const exists = await prisma.coupon.findUnique({ where: { code: data.code.toUpperCase() } });
    if (exists) throw new AppError(409, "Coupon code already exists");
    const coupon = await prisma.coupon.create({
      data: {
        code: data.code.toUpperCase(),
        type: data.type,
        value: data.value,
        minAmount: data.minAmount,
        maxDiscount: data.maxDiscount ?? null,
        usageLimit: data.usageLimit,
        validFrom: data.validFrom ? new Date(data.validFrom) : null,
        validTo: data.validTo ? new Date(data.validTo) : null,
        status: data.status,
        customerId: data.customerId || null,
        productId: data.productId || null,
      },
    });
    await auditLog({ userId: req.authUserId, action: "CREATE_COUPON", module: "coupons", entityId: coupon.id });
    res.status(201).json({ ok: true, id: coupon.id });
  })
);

const couponUpdateSchema = couponSchema.partial();
router.put(
  "/coupons/:id",
  requirePermission("coupons.manage"),
  validate(couponUpdateSchema),
  asyncHandler(async (req, res) => {
    const data = getValidated<z.infer<typeof couponUpdateSchema>>(req);
    await prisma.coupon.update({
      where: { id: req.params.id },
      data: {
        ...data,
        code: data.code ? data.code.toUpperCase() : undefined,
        validFrom: data.validFrom ? new Date(data.validFrom) : undefined,
        validTo: data.validTo ? new Date(data.validTo) : undefined,
      },
    });
    await auditLog({ userId: req.authUserId, action: "UPDATE_COUPON", module: "coupons", entityId: req.params.id });
    res.json({ ok: true });
  })
);

router.delete(
  "/coupons/:id",
  requirePermission("coupons.manage"),
  asyncHandler(async (req, res) => {
    await prisma.coupon.update({ where: { id: req.params.id }, data: { status: "inactive" } });
    await auditLog({ userId: req.authUserId, action: "DELETE_COUPON", module: "coupons", entityId: req.params.id });
    res.json({ ok: true });
  })
);

// ==================== DISCOUNTS ====================

const discountSchema = z.object({
  name: z.string().min(1),
  type: z.enum(["product", "category", "customer", "bill"]),
  value: z.number(),
  valueType: z.string().default("percent"),
  appliesTo: z.string().nullable().optional(),
  productId: z.string().nullable().optional(),
  customerId: z.string().nullable().optional(),
  validFrom: z.string().nullable().optional(),
  validTo: z.string().nullable().optional(),
  status: z.string().default("active"),
});

router.get(
  "/discounts",
  requirePermission("discounts.manage"),
  asyncHandler(async (_req, res) => {
    const rows = await prisma.discount.findMany({
      include: { product: { select: { name: true } }, customer: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
    });
    res.json(rows);
  })
);

router.post(
  "/discounts",
  requirePermission("discounts.manage"),
  validate(discountSchema),
  asyncHandler(async (req, res) => {
    const data = getValidated<z.infer<typeof discountSchema>>(req);
    const discount = await prisma.discount.create({
      data: {
        name: data.name,
        type: data.type,
        value: data.value,
        valueType: data.valueType,
        appliesTo: data.appliesTo || null,
        productId: data.productId || null,
        customerId: data.customerId || null,
        validFrom: data.validFrom ? new Date(data.validFrom) : null,
        validTo: data.validTo ? new Date(data.validTo) : null,
        status: data.status,
      },
    });
    await auditLog({ userId: req.authUserId, action: "CREATE_DISCOUNT", module: "discounts", entityId: discount.id });
    res.status(201).json({ ok: true, id: discount.id });
  })
);

const discountUpdateSchema = discountSchema.partial();
router.put(
  "/discounts/:id",
  requirePermission("discounts.manage"),
  validate(discountUpdateSchema),
  asyncHandler(async (req, res) => {
    const data = getValidated<z.infer<typeof discountUpdateSchema>>(req);
    await prisma.discount.update({
      where: { id: req.params.id },
      data: {
        ...data,
        validFrom: data.validFrom ? new Date(data.validFrom) : undefined,
        validTo: data.validTo ? new Date(data.validTo) : undefined,
      },
    });
    await auditLog({ userId: req.authUserId, action: "UPDATE_DISCOUNT", module: "discounts", entityId: req.params.id });
    res.json({ ok: true });
  })
);

router.delete(
  "/discounts/:id",
  requirePermission("discounts.manage"),
  asyncHandler(async (req, res) => {
    await prisma.discount.update({ where: { id: req.params.id }, data: { status: "inactive" } });
    await auditLog({ userId: req.authUserId, action: "DELETE_DISCOUNT", module: "discounts", entityId: req.params.id });
    res.json({ ok: true });
  })
);

// ==================== LOYALTY ====================

router.get(
  "/loyalty/points",
  requirePermission("customers.view"),
  asyncHandler(async (req, res) => {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20));
    const customerId = typeof req.query.customerId === "string" && req.query.customerId ? req.query.customerId : null;
    const where = customerId ? { customerId } : {};
    const [total, rows] = await Promise.all([
      prisma.loyaltyPoint.count({ where }),
      prisma.loyaltyPoint.findMany({
        where,
        include: { customer: { select: { name: true, phone: true, loyaltyPoints: true } } },
        orderBy: { date: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    res.json({ data: rows, total, page, pageSize });
  })
);

export default router;