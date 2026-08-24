import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";
import { validate, getValidated } from "../middleware/validate.js";
import { asyncHandler, AppError } from "../middleware/error.js";
import { auditLog } from "../utils/audit.js";

const router = Router();
router.use(requireAuth);

const branchSchema = z.object({
  name: z.string().min(1),
  code: z.string().min(1),
  address: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  gstNumber: z.string().nullable().optional(),
  status: z.string().default("active"),
});

router.get(
  "/",
  asyncHandler(async (_req, res) => {
    const branches = await prisma.branch.findMany({
      orderBy: { name: "asc" },
      include: { _count: { select: { users: true, sales: true, products: true } } },
    });
    res.json(branches);
  })
);

router.post(
  "/",
  requirePermission("branches.manage"),
  validate(branchSchema),
  asyncHandler(async (req, res) => {
    const data = getValidated<z.infer<typeof branchSchema>>(req);
    const exists = await prisma.branch.findUnique({ where: { code: data.code } });
    if (exists) throw new AppError(409, "Branch code already exists");
    const branch = await prisma.branch.create({ data: { ...data, email: data.email || null } });
    await auditLog({ userId: req.authUserId, action: "CREATE_BRANCH", module: "branches", entityId: branch.id });
    res.status(201).json({ ok: true, id: branch.id });
  })
);

const branchUpdateSchema = branchSchema.partial();
router.put(
  "/:id",
  requirePermission("branches.manage"),
  validate(branchUpdateSchema),
  asyncHandler(async (req, res) => {
    const data = getValidated<z.infer<typeof branchUpdateSchema>>(req);
    await prisma.branch.update({ where: { id: req.params.id }, data });
    await auditLog({ userId: req.authUserId, action: "UPDATE_BRANCH", module: "branches", entityId: req.params.id });
    res.json({ ok: true });
  })
);

router.delete(
  "/:id",
  requirePermission("branches.manage"),
  asyncHandler(async (req, res) => {
    const users = await prisma.user.count({ where: { branchId: req.params.id } });
    if (users > 0) throw new AppError(400, "Branch has users assigned. Reassign or remove them first.");
    await prisma.branch.update({ where: { id: req.params.id }, data: { status: "inactive" } });
    await auditLog({ userId: req.authUserId, action: "DELETE_BRANCH", module: "branches", entityId: req.params.id });
    res.json({ ok: true });
  })
);

export default router;