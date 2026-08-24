import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";
import { validate, getValidated } from "../middleware/validate.js";
import { asyncHandler, AppError } from "../middleware/error.js";
import { auditLog } from "../utils/audit.js";
import { round2, dateStart, dateEnd } from "../utils/numbers.js";

const router = Router();
router.use(requireAuth);

function todayRange() {
  return { from: dateStart(new Date()), to: dateEnd(new Date()) };
}

router.get(
  "/",
  requirePermission("cash.view"),
  asyncHandler(async (req, res) => {
    const { from, to } = todayRange();
    const rows = await prisma.cashRegister.findMany({
      where: { date: { gte: from, lte: to }, ...(req.auth?.branchId ? { branchId: req.auth.branchId } : {}) },
      include: { user: { select: { name: true } }, branch: { select: { name: true } } },
      orderBy: { date: "desc" },
    });
    res.json(rows);
  })
);

router.get(
  "/my-open",
  requirePermission("cash.view"),
  asyncHandler(async (req, res) => {
    const register = await prisma.cashRegister.findFirst({
      where: { userId: req.authUserId, status: "open", ...(req.auth?.branchId ? { branchId: req.auth.branchId } : {}) },
      include: { transactions: { orderBy: { createdAt: "desc" }, take: 50 } },
    });
    res.json({ register });
  })
);

const openSchema = z.object({
  openingCash: z.number().default(0),
  notes: z.string().nullable().optional(),
});

router.post(
  "/open",
  requirePermission("cash.open"),
  validate(openSchema),
  asyncHandler(async (req, res) => {
    const data = getValidated<z.infer<typeof openSchema>>(req);
    const branchId = req.auth?.branchId || null;
    const existing = await prisma.cashRegister.findFirst({
      where: { userId: req.authUserId, status: "open", branchId },
    });
    if (existing) throw new AppError(400, "You already have an open cash register");
    const register = await prisma.$transaction(async (tx) => {
      const r = await tx.cashRegister.create({
        data: {
          branchId,
          userId: req.authUserId,
          openingCash: data.openingCash,
          openedBy: req.authUserId,
          notes: data.notes || null,
        },
      });
      await tx.cashTransaction.create({
        data: {
          registerId: r.id,
          type: "opening",
          amount: data.openingCash,
          note: "Opening cash",
          userId: req.authUserId,
        },
      });
      return r;
    });
    await auditLog({ userId: req.authUserId, action: "OPEN_CASH", module: "cash", entityId: register.id, details: { openingCash: data.openingCash } });
    res.status(201).json({ ok: true, id: register.id });
  })
);

const closeSchema = z.object({
  actualCash: z.number(),
  notes: z.string().nullable().optional(),
});

router.post(
  "/close",
  requirePermission("cash.close"),
  validate(closeSchema),
  asyncHandler(async (req, res) => {
    const data = getValidated<z.infer<typeof closeSchema>>(req);
    const branchId = req.auth?.branchId || null;
    const register = await prisma.cashRegister.findFirst({
      where: { userId: req.authUserId, status: "open", branchId },
    });
    if (!register) throw new AppError(404, "No open cash register found");

    const { from, to } = todayRange();
    const [cashSales, cashExpenses, cashRefunds, cashIn, cashOut] = await Promise.all([
      prisma.salePayment.aggregate({
        where: { method: "cash", receivedAt: { gte: from, lte: to }, sale: { userId: req.authUserId } },
        _sum: { amount: true },
      }),
      prisma.expense.aggregate({
        where: { method: "cash", date: { gte: from, lte: to }, userId: req.authUserId },
        _sum: { amount: true },
      }),
      prisma.$queryRawUnsafe<{ total: number }[]>(
        `SELECT COALESCE(SUM(amount),0) as total FROM SalesReturn WHERE userId = ? AND status = 'completed' AND createdAt BETWEEN ? AND ?`,
        req.authUserId, from, to
      ),
      prisma.cashTransaction.aggregate({
        where: { registerId: register.id, type: "cash_in" },
        _sum: { amount: true },
      }),
      prisma.cashTransaction.aggregate({
        where: { registerId: register.id, type: "cash_out" },
        _sum: { amount: true },
      }),
    ]);
    const refunds = Number(cashRefunds[0]?.total || 0);
    const expected = round2(
      register.openingCash +
        (cashSales._sum.amount || 0) +
        (cashIn._sum.amount || 0) -
        (cashExpenses._sum.amount || 0) -
        (cashOut._sum.amount || 0) -
        refunds
    );
    const difference = round2(data.actualCash - expected);
    await prisma.$transaction([
      prisma.cashRegister.update({
        where: { id: register.id },
        data: {
          cashSales: cashSales._sum.amount || 0,
          cashExpenses: cashExpenses._sum.amount || 0,
          cashRefunds: refunds,
          cashIn: cashIn._sum.amount || 0,
          cashOut: cashOut._sum.amount || 0,
          expectedCash: expected,
          actualCash: data.actualCash,
          difference,
          status: "closed",
          closedBy: req.authUserId,
          closedAt: new Date(),
          notes: data.notes || register.notes,
        },
      }),
    ]);
    await auditLog({
      userId: req.authUserId,
      action: "CLOSE_CASH",
      module: "cash",
      entityId: register.id,
      details: { expected, actual: data.actualCash, difference },
    });
    res.json({ ok: true, expected, difference });
  })
);

const txnSchema = z.object({
  type: z.enum(["cash_in", "cash_out"]),
  amount: z.number().positive(),
  note: z.string().nullable().optional(),
});

router.post(
  "/transactions",
  requirePermission("cash.open"),
  validate(txnSchema),
  asyncHandler(async (req, res) => {
    const data = getValidated<z.infer<typeof txnSchema>>(req);
    const branchId = req.auth?.branchId || null;
    const register = await prisma.cashRegister.findFirst({
      where: { userId: req.authUserId, status: "open", branchId },
    });
    if (!register) throw new AppError(400, "Open a cash register first");
    const txn = await prisma.cashTransaction.create({
      data: {
        registerId: register.id,
        type: data.type,
        amount: data.amount,
        note: data.note || null,
        userId: req.authUserId,
      },
    });
    const field = data.type === "cash_in" ? "cashIn" : "cashOut";
    await prisma.cashRegister.update({
      where: { id: register.id },
      data: { [field]: { increment: data.amount } },
    });
    await auditLog({ userId: req.authUserId, action: `CASH_${data.type.toUpperCase()}`, module: "cash", entityId: txn.id, details: { amount: data.amount } });
    res.status(201).json({ ok: true, id: txn.id });
  })
);

export default router;