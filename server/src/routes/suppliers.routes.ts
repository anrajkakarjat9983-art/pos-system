import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";
import { validate, getValidated } from "../middleware/validate.js";
import { asyncHandler, AppError } from "../middleware/error.js";
import { auditLog } from "../utils/audit.js";
import { extractQuery } from "../utils/helpers.js";
import { round2, dateStart, dateEnd } from "../utils/numbers.js";

const router = Router();
router.use(requireAuth);

const supplierSchema = z.object({
  name: z.string().min(1),
  company: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  gstNumber: z.string().nullable().optional(),
  openingBalance: z.number().default(0),
  creditLimit: z.number().default(0),
  paymentTerms: z.string().nullable().optional(),
  status: z.string().default("active"),
});

router.get(
  "/",
  requirePermission("suppliers.view"),
  asyncHandler(async (req, res) => {
    const { search, page, pageSize, sortBy, sortOrder } = extractQuery(req.query);
    const where = search
      ? { OR: [{ name: { contains: search } }, { company: { contains: search } }, { phone: { contains: search } }] }
      : {};
    const [total, rows] = await Promise.all([
      prisma.supplier.count({ where }),
      prisma.supplier.findMany({
        where,
        include: {
          _count: { select: { purchases: true } },
          transactions: { orderBy: { date: "desc" }, take: 1 },
        },
        orderBy: { [sortBy]: sortOrder },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    res.json({
      data: rows.map((s) => ({
        ...s,
        outstanding: s.transactions[0]?.balanceAfter ?? s.openingBalance,
        purchaseCount: s._count.purchases,
      })),
      total,
      page,
      pageSize,
    });
  })
);

router.get(
  "/:id",
  requirePermission("suppliers.view"),
  asyncHandler(async (req, res) => {
    const supplier = await prisma.supplier.findUnique({
      where: { id: req.params.id },
      include: {
        transactions: { orderBy: { date: "desc" }, take: 50 },
        payments: { orderBy: { date: "desc" }, take: 50 },
        purchases: { orderBy: { createdAt: "desc" }, take: 10 },
      },
    });
    if (!supplier) throw new AppError(404, "Supplier not found");
    const outstanding = supplier.transactions[0]?.balanceAfter ?? supplier.openingBalance;
    res.json({ ...supplier, outstanding });
  })
);

router.post(
  "/",
  requirePermission("suppliers.create"),
  validate(supplierSchema),
  asyncHandler(async (req, res) => {
    const data = getValidated<z.infer<typeof supplierSchema>>(req);
    const supplier = await prisma.$transaction(async (tx) => {
      const s = await tx.supplier.create({
        data: {
          name: data.name,
          company: data.company || null,
          phone: data.phone || null,
          email: data.email || null,
          address: data.address || null,
          gstNumber: data.gstNumber || null,
          openingBalance: data.openingBalance,
          creditLimit: data.creditLimit,
          paymentTerms: data.paymentTerms || null,
          status: data.status,
          branchId: req.auth?.branchId || null,
        },
      });
      if (data.openingBalance !== 0) {
        await tx.supplierTransaction.create({
          data: {
            supplierId: s.id,
            type: "opening",
            amount: data.openingBalance,
            balanceAfter: data.openingBalance,
            note: "Opening balance",
          },
        });
      }
      return s;
    });
    await auditLog({ userId: req.authUserId, action: "CREATE_SUPPLIER", module: "suppliers", entityId: supplier.id, details: { name: supplier.name } });
    res.status(201).json({ ok: true, id: supplier.id });
  })
);

const supplierUpdateSchema = supplierSchema.partial();
router.put(
  "/:id",
  requirePermission("suppliers.edit"),
  validate(supplierUpdateSchema),
  asyncHandler(async (req, res) => {
    const data = getValidated<z.infer<typeof supplierUpdateSchema>>(req);
    await prisma.supplier.update({ where: { id: req.params.id }, data });
    await auditLog({ userId: req.authUserId, action: "UPDATE_SUPPLIER", module: "suppliers", entityId: req.params.id });
    res.json({ ok: true });
  })
);

router.delete(
  "/:id",
  requirePermission("suppliers.delete"),
  asyncHandler(async (req, res) => {
    const purchases = await prisma.purchase.count({ where: { supplierId: req.params.id } });
    if (purchases > 0) throw new AppError(400, "Supplier has purchase history and cannot be deleted");
    await prisma.supplier.update({ where: { id: req.params.id }, data: { status: "inactive" } });
    await auditLog({ userId: req.authUserId, action: "DELETE_SUPPLIER", module: "suppliers", entityId: req.params.id });
    res.json({ ok: true });
  })
);

const paymentSchema = z.object({
  amount: z.number().positive(),
  method: z.string().default("cash"),
  reference: z.string().nullable().optional(),
  date: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
  purchaseId: z.string().nullable().optional(),
});

router.post(
  "/:id/payments",
  requirePermission("suppliers.edit"),
  validate(paymentSchema),
  asyncHandler(async (req, res) => {
    const data = getValidated<z.infer<typeof paymentSchema>>(req);
    const supplier = await prisma.supplier.findUnique({ where: { id: req.params.id } });
    if (!supplier) throw new AppError(404, "Supplier not found");
    const last = await prisma.supplierTransaction.findFirst({
      where: { supplierId: req.params.id },
      orderBy: { date: "desc" },
    });
    const current = last?.balanceAfter ?? supplier.openingBalance;
    const newBalance = round2(current - data.amount);
    const date = data.date ? new Date(data.date) : new Date();
    await prisma.$transaction([
      prisma.supplierPayment.create({
        data: {
          supplierId: req.params.id,
          purchaseId: data.purchaseId || null,
          amount: data.amount,
          method: data.method,
          reference: data.reference || null,
          date,
          note: data.note || null,
          userId: req.authUserId,
        },
      }),
      prisma.supplierTransaction.create({
        data: {
          supplierId: req.params.id,
          type: "payment",
          amount: data.amount,
          referenceId: data.purchaseId || null,
          balanceAfter: newBalance,
          date,
          note: data.note || `Payment made (${data.method})`,
        },
      }),
    ]);
    if (data.purchaseId) {
      const purchase = await prisma.purchase.findUnique({ where: { id: data.purchaseId } });
      if (purchase) {
        const paid = purchase.paidAmount + data.amount;
        const paymentStatus = paid >= purchase.total ? "paid" : "partially_paid";
        const status = paymentStatus === "paid" ? "paid" : purchase.status;
        await prisma.purchase.update({
          where: { id: purchase.id },
          data: { paidAmount: round2(paid), paymentStatus, status, balance: round2(purchase.total - paid) },
        });
      }
    }
    await auditLog({ userId: req.authUserId, action: "SUPPLIER_PAYMENT", module: "suppliers", entityId: req.params.id, details: { amount: data.amount } });
    res.json({ ok: true, outstanding: newBalance });
  })
);

router.post(
  "/:id/adjust",
  requirePermission("suppliers.edit"),
  validate(z.object({ amount: z.number(), note: z.string().nullable().optional() })),
  asyncHandler(async (req, res) => {
    const { amount, note } = getValidated<{ amount: number; note?: string | null }>(req);
    const last = await prisma.supplierTransaction.findFirst({
      where: { supplierId: req.params.id },
      orderBy: { date: "desc" },
    });
    const supplier = await prisma.supplier.findUnique({ where: { id: req.params.id } });
    if (!supplier) throw new AppError(404, "Supplier not found");
    const current = last?.balanceAfter ?? supplier.openingBalance;
    const newBalance = round2(current + amount);
    await prisma.supplierTransaction.create({
      data: {
        supplierId: req.params.id,
        type: "adjustment",
        amount,
        balanceAfter: newBalance,
        note: note || "Balance adjustment",
      },
    });
    await auditLog({ userId: req.authUserId, action: "SUPPLIER_ADJUST", module: "suppliers", entityId: req.params.id, details: { amount } });
    res.json({ ok: true, outstanding: newBalance });
  })
);

router.get(
  "/:id/statement",
  requirePermission("suppliers.view"),
  asyncHandler(async (req, res) => {
    const { from, to } = extractQuery(req.query);
    const where = {
      supplierId: req.params.id,
      ...(from || to ? { date: { gte: from ? dateStart(from) : undefined, lte: to ? dateEnd(to) : undefined } } : {}),
    };
    const rows = await prisma.supplierTransaction.findMany({
      where,
      include: { supplier: { select: { name: true } } },
      orderBy: { date: "asc" },
    });
    res.json(rows);
  })
);

export default router;