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

const customerSchema = z.object({
  name: z.string().min(1),
  phone: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  gstNumber: z.string().nullable().optional(),
  openingBalance: z.number().default(0),
  creditLimit: z.number().default(0),
  discountPercent: z.number().default(0),
  status: z.string().default("active"),
});

router.get(
  "/",
  requirePermission("customers.view"),
  asyncHandler(async (req, res) => {
    const { search, page, pageSize, sortBy, sortOrder } = extractQuery(req.query);
    const where = search
      ? { OR: [{ name: { contains: search } }, { phone: { contains: search } }, { email: { contains: search } }] }
      : {};
    const [total, rows] = await Promise.all([
      prisma.customer.count({ where }),
      prisma.customer.findMany({
        where,
        include: {
          _count: { select: { sales: true } },
          transactions: { orderBy: { date: "desc" }, take: 1 },
        },
        orderBy: { [sortBy]: sortOrder },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    res.json({
      data: rows.map((c) => ({
        ...c,
        outstanding: c.transactions[0]?.balanceAfter ?? c.openingBalance,
        saleCount: c._count.sales,
      })),
      total,
      page,
      pageSize,
    });
  })
);

router.get(
  "/:id",
  requirePermission("customers.view"),
  asyncHandler(async (req, res) => {
    const customer = await prisma.customer.findUnique({
      where: { id: req.params.id },
      include: {
        transactions: { orderBy: { date: "desc" }, take: 50 },
        payments: { orderBy: { date: "desc" }, take: 50 },
        loyalty: { orderBy: { date: "desc" }, take: 50 },
      },
    });
    if (!customer) throw new AppError(404, "Customer not found");
    const outstanding = customer.transactions[0]?.balanceAfter ?? customer.openingBalance;
    res.json({ ...customer, outstanding });
  })
);

router.post(
  "/",
  requirePermission("customers.create"),
  validate(customerSchema),
  asyncHandler(async (req, res) => {
    const data = getValidated<z.infer<typeof customerSchema>>(req);
    const customer = await prisma.$transaction(async (tx) => {
      const c = await tx.customer.create({
        data: {
          name: data.name,
          phone: data.phone || null,
          email: data.email || null,
          address: data.address || null,
          gstNumber: data.gstNumber || null,
          openingBalance: data.openingBalance,
          creditLimit: data.creditLimit,
          discountPercent: data.discountPercent,
          status: data.status,
          branchId: req.auth?.branchId || null,
        },
      });
      if (data.openingBalance !== 0) {
        await tx.customerTransaction.create({
          data: {
            customerId: c.id,
            type: "opening",
            amount: data.openingBalance,
            balanceAfter: data.openingBalance,
            note: "Opening balance",
          },
        });
      }
      return c;
    });
    await auditLog({ userId: req.authUserId, action: "CREATE_CUSTOMER", module: "customers", entityId: customer.id, details: { name: customer.name } });
    res.status(201).json({ ok: true, id: customer.id });
  })
);

const customerUpdateSchema = customerSchema.partial();
router.put(
  "/:id",
  requirePermission("customers.edit"),
  validate(customerUpdateSchema),
  asyncHandler(async (req, res) => {
    const data = getValidated<z.infer<typeof customerUpdateSchema>>(req);
    await prisma.customer.update({ where: { id: req.params.id }, data });
    await auditLog({ userId: req.authUserId, action: "UPDATE_CUSTOMER", module: "customers", entityId: req.params.id });
    res.json({ ok: true });
  })
);

router.delete(
  "/:id",
  requirePermission("customers.delete"),
  asyncHandler(async (req, res) => {
    const sales = await prisma.sale.count({ where: { customerId: req.params.id, status: "completed" } });
    if (sales > 0) throw new AppError(400, "Customer has sales history and cannot be deleted");
    await prisma.customer.update({ where: { id: req.params.id }, data: { status: "inactive" } });
    await auditLog({ userId: req.authUserId, action: "DELETE_CUSTOMER", module: "customers", entityId: req.params.id });
    res.json({ ok: true });
  })
);

const paymentSchema = z.object({
  amount: z.number().positive(),
  method: z.string().default("cash"),
  reference: z.string().nullable().optional(),
  date: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
  saleId: z.string().nullable().optional(),
});

router.post(
  "/:id/payments",
  requirePermission("customers.edit"),
  validate(paymentSchema),
  asyncHandler(async (req, res) => {
    const data = getValidated<z.infer<typeof paymentSchema>>(req);
    const customer = await prisma.customer.findUnique({ where: { id: req.params.id } });
    if (!customer) throw new AppError(404, "Customer not found");
    const last = await prisma.customerTransaction.findFirst({
      where: { customerId: req.params.id },
      orderBy: { date: "desc" },
    });
    const current = last?.balanceAfter ?? customer.openingBalance;
    const newBalance = round2(current - data.amount);
    const date = data.date ? new Date(data.date) : new Date();
    await prisma.$transaction([
      prisma.customerPayment.create({
        data: {
          customerId: req.params.id,
          saleId: data.saleId || null,
          amount: data.amount,
          method: data.method,
          reference: data.reference || null,
          date,
          note: data.note || null,
          userId: req.authUserId,
        },
      }),
      prisma.customerTransaction.create({
        data: {
          customerId: req.params.id,
          type: "payment",
          amount: data.amount,
          referenceId: data.saleId || null,
          balanceAfter: newBalance,
          date,
          note: data.note || `Payment received (${data.method})`,
        },
      }),
    ]);
    await auditLog({ userId: req.authUserId, action: "CUSTOMER_PAYMENT", module: "customers", entityId: req.params.id, details: { amount: data.amount } });
    res.json({ ok: true, outstanding: newBalance });
  })
);

router.post(
  "/:id/adjust",
  requirePermission("customers.edit"),
  validate(z.object({ amount: z.number(), note: z.string().nullable().optional() })),
  asyncHandler(async (req, res) => {
    const { amount, note } = getValidated<{ amount: number; note?: string | null }>(req);
    const last = await prisma.customerTransaction.findFirst({
      where: { customerId: req.params.id },
      orderBy: { date: "desc" },
    });
    const customer = await prisma.customer.findUnique({ where: { id: req.params.id } });
    if (!customer) throw new AppError(404, "Customer not found");
    const current = last?.balanceAfter ?? customer.openingBalance;
    const newBalance = round2(current + amount);
    await prisma.customerTransaction.create({
      data: {
        customerId: req.params.id,
        type: "adjustment",
        amount,
        balanceAfter: newBalance,
        note: note || "Balance adjustment",
      },
    });
    await auditLog({ userId: req.authUserId, action: "CUSTOMER_ADJUST", module: "customers", entityId: req.params.id, details: { amount } });
    res.json({ ok: true, outstanding: newBalance });
  })
);

router.get(
  "/:id/statement",
  requirePermission("customers.view"),
  asyncHandler(async (req, res) => {
    const { from, to } = extractQuery(req.query);
    const where = {
      customerId: req.params.id,
      ...(from || to ? { date: { gte: from ? dateStart(from) : undefined, lte: to ? dateEnd(to) : undefined } } : {}),
    };
    const rows = await prisma.customerTransaction.findMany({
      where,
      include: { customer: { select: { name: true } } },
      orderBy: { date: "asc" },
    });
    res.json(rows);
  })
);

export default router;