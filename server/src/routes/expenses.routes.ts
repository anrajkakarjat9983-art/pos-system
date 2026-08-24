import { Router } from "express";
import { z } from "zod";
import multer from "multer";
import path from "path";
import fs from "fs";
import { prisma } from "../db.js";
import { config } from "../config.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";
import { validate, getValidated } from "../middleware/validate.js";
import { asyncHandler, AppError } from "../middleware/error.js";
import { auditLog } from "../utils/audit.js";
import { extractQuery } from "../utils/helpers.js";

const router = Router();
router.use(requireAuth);

const upload = multer({ dest: path.join(config.uploadsDir, "tmp") });

router.get(
  "/categories",
  asyncHandler(async (_req, res) => {
    const rows = await prisma.expenseCategory.findMany({ orderBy: { name: "asc" } });
    res.json(rows);
  })
);

const categorySchema = z.object({ name: z.string().min(1) });

router.post(
  "/categories",
  requirePermission("expenses.edit"),
  validate(categorySchema),
  asyncHandler(async (req, res) => {
    const { name } = getValidated<z.infer<typeof categorySchema>>(req);
    const row = await prisma.expenseCategory.create({ data: { name } });
    res.status(201).json({ ok: true, id: row.id });
  })
);

router.put(
  "/categories/:id",
  requirePermission("expenses.edit"),
  validate(categorySchema.partial()),
  asyncHandler(async (req, res) => {
    const { name } = getValidated<{ name?: string }>(req);
    await prisma.expenseCategory.update({ where: { id: req.params.id }, data: { name } });
    res.json({ ok: true });
  })
);

router.delete(
  "/categories/:id",
  requirePermission("expenses.delete"),
  asyncHandler(async (req, res) => {
    const count = await prisma.expense.count({ where: { categoryId: req.params.id } });
    if (count > 0) throw new AppError(400, "Category has expenses. Reassign or delete them first.");
    await prisma.expenseCategory.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  })
);

const expenseSchema = z.object({
  categoryId: z.string().min(1),
  amount: z.number().positive(),
  method: z.string().default("cash"),
  date: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
});

router.get(
  "/",
  requirePermission("expenses.view"),
  asyncHandler(async (req, res) => {
    const { search, page, pageSize, from, to } = extractQuery(req.query);
    const categoryId = typeof req.query.categoryId === "string" && req.query.categoryId ? req.query.categoryId : null;
    const where: any = {
      ...(categoryId ? { categoryId } : {}),
      ...(from || to ? { date: { gte: from ?? undefined, lte: to ?? undefined } } : {}),
      ...(search
        ? { OR: [{ description: { contains: search } }, { category: { name: { contains: search } } }] }
        : {}),
    };
    const [total, rows] = await Promise.all([
      prisma.expense.count({ where }),
      prisma.expense.findMany({
        where,
        include: { category: true, user: { select: { name: true } } },
        orderBy: { date: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    const sum = await prisma.expense.aggregate({ where, _sum: { amount: true } });
    res.json({ data: rows, total, page, pageSize, sum: sum._sum.amount || 0 });
  })
);

router.post(
  "/",
  requirePermission("expenses.create"),
  validate(expenseSchema),
  asyncHandler(async (req, res) => {
    const data = getValidated<z.infer<typeof expenseSchema>>(req);
    const expense = await prisma.expense.create({
      data: {
        categoryId: data.categoryId,
        amount: data.amount,
        method: data.method,
        date: data.date ? new Date(data.date) : new Date(),
        description: data.description || null,
        branchId: req.auth?.branchId || null,
        userId: req.authUserId,
      },
    });
    await auditLog({ userId: req.authUserId, action: "CREATE_EXPENSE", module: "expenses", entityId: expense.id, details: { amount: data.amount } });
    res.status(201).json({ ok: true, id: expense.id });
  })
);

const expenseUpdateSchema = expenseSchema.partial();
router.put(
  "/:id",
  requirePermission("expenses.edit"),
  validate(expenseUpdateSchema),
  asyncHandler(async (req, res) => {
    const data = getValidated<z.infer<typeof expenseUpdateSchema>>(req);
    await prisma.expense.update({
      where: { id: req.params.id },
      data: {
        ...data,
        date: data.date ? new Date(data.date) : undefined,
      },
    });
    await auditLog({ userId: req.authUserId, action: "UPDATE_EXPENSE", module: "expenses", entityId: req.params.id });
    res.json({ ok: true });
  })
);

router.delete(
  "/:id",
  requirePermission("expenses.delete"),
  asyncHandler(async (req, res) => {
    await prisma.expense.delete({ where: { id: req.params.id } });
    await auditLog({ userId: req.authUserId, action: "DELETE_EXPENSE", module: "expenses", entityId: req.params.id });
    res.json({ ok: true });
  })
);

export default router;