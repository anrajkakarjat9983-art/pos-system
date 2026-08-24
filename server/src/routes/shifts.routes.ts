import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";
import { validate, getValidated } from "../middleware/validate.js";
import { asyncHandler, AppError } from "../middleware/error.js";
import { auditLog } from "../utils/audit.js";
import { extractQuery, branchFilter } from "../utils/helpers.js";
import { dateStart, dateEnd, round2 } from "../utils/numbers.js";

const router = Router();
router.use(requireAuth);

const openSchema = z.object({
  openingCash: z.number().default(0),
  notes: z.string().nullable().optional(),
});

router.post(
  "/open",
  requirePermission("shifts.manage"),
  validate(openSchema),
  asyncHandler(async (req, res) => {
    const data = getValidated<z.infer<typeof openSchema>>(req);
    const branchId = req.auth?.branchId || undefined;
    const existing = await prisma.shift.findFirst({
      where: { userId: req.authUserId, status: "open", ...(branchId ? { branchId } : {}) },
    });
    if (existing) throw new AppError(400, "You already have an open shift");
    let targetBranch: string | null = branchId || null;
    if (!targetBranch) {
      const first = await prisma.branch.findFirst({ orderBy: { name: "asc" } });
      targetBranch = first?.id || null;
    }
    if (!targetBranch) throw new AppError(400, "No branch exists. Create a branch first.");
    const shift = await prisma.shift.create({
      data: {
        userId: req.authUserId!,
        branchId: targetBranch,
        openingCash: data.openingCash,
        notes: data.notes || null,
      },
    });
    await auditLog({ userId: req.authUserId, action: "OPEN_SHIFT", module: "shifts", entityId: shift.id, details: { openingCash: data.openingCash } });
    res.status(201).json({ ok: true, id: shift.id });
  })
);

const closeSchema = z.object({
  actualCash: z.number(),
  notes: z.string().nullable().optional(),
});

router.post(
  "/close",
  requirePermission("shifts.manage"),
  validate(closeSchema),
  asyncHandler(async (req, res) => {
    const data = getValidated<z.infer<typeof closeSchema>>(req);
    const branchId = req.auth?.branchId || undefined;
    const shift = await prisma.shift.findFirst({
      where: { userId: req.authUserId, status: "open", ...(branchId ? { branchId } : {}) },
    });
    if (!shift) throw new AppError(404, "No open shift found");

    const { from, to } = { from: shift.openedAt, to: new Date() };
    const [cashSales, cashExpenses, cashRefunds] = await Promise.all([
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
    ]);
    const refunds = Number(cashRefunds[0]?.total || 0);
    const expected = shift.openingCash + (cashSales._sum.amount || 0) - (cashExpenses._sum.amount || 0) - refunds;
    const difference = round2(data.actualCash - expected);
    await prisma.shift.update({
      where: { id: shift.id },
      data: {
        closedAt: new Date(),
        expectedCash: round2(expected),
        actualCash: data.actualCash,
        difference,
        status: "closed",
        notes: data.notes || shift.notes,
      },
    });
    await auditLog({ userId: req.authUserId, action: "CLOSE_SHIFT", module: "shifts", entityId: shift.id, details: { expected, actual: data.actualCash, difference } });
    res.json({ ok: true, expected: round2(expected), difference });
  })
);

router.get(
  "/",
  requirePermission("shifts.view"),
  asyncHandler(async (req, res) => {
    const { page, pageSize, from, to, status } = extractQuery(req.query);
    const where = {
      ...branchFilter(req),
      ...(from || to ? { openedAt: { gte: from ? dateStart(from) : undefined, lte: to ? dateEnd(to) : undefined } } : {}),
      ...(status ? { status } : {}),
    };
    const [total, rows] = await Promise.all([
      prisma.shift.count({ where }),
      prisma.shift.findMany({
        where,
        include: { user: { select: { name: true } }, branch: { select: { name: true } } },
        orderBy: { openedAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    res.json({ data: rows, total, page, pageSize });
  })
);

router.get(
  "/my-open",
  asyncHandler(async (req, res) => {
    const branchId = req.auth?.branchId || undefined;
    const shift = await prisma.shift.findFirst({
      where: { userId: req.authUserId, status: "open", ...(branchId ? { branchId } : {}) },
    });
    res.json({ shift });
  })
);

export default router;