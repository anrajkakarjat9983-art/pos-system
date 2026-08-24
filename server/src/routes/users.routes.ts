import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../db.js";
import { requireAuth, requirePermission, isSuperAdmin } from "../middleware/auth.js";
import { validate, getValidated } from "../middleware/validate.js";
import { asyncHandler, AppError } from "../middleware/error.js";
import { auditLog } from "../utils/audit.js";
import { extractQuery } from "../utils/helpers.js";

const router = Router();
router.use(requireAuth);

const userSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(6).optional(),
  phone: z.string().nullable().optional(),
  roleId: z.string().min(1),
  branchId: z.string().nullable().optional(),
  status: z.string().default("active"),
});

router.get(
  "/",
  requirePermission("users.view"),
  asyncHandler(async (req, res) => {
    const { search, page, pageSize } = extractQuery(req.query);
    const where = search
      ? { OR: [{ name: { contains: search } }, { email: { contains: search } }, { phone: { contains: search } }] }
      : {};
    const [total, rows] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        include: { role: true, branch: true, employee: true },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    res.json({
      data: rows.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        phone: u.phone,
        avatar: u.avatar,
        status: u.status,
        role: u.role.name,
        roleId: u.roleId,
        branch: u.branch?.name || null,
        branchId: u.branchId,
        employeeId: u.employee?.id || null,
        createdAt: u.createdAt,
      })),
      total,
      page,
      pageSize,
    });
  })
);

router.post(
  "/",
  requirePermission("users.manage"),
  validate(userSchema),
  asyncHandler(async (req, res) => {
    const data = getValidated<z.infer<typeof userSchema>>(req);
    const exists = await prisma.user.findUnique({ where: { email: data.email.toLowerCase() } });
    if (exists) throw new AppError(409, "A user with this email already exists");
    const user = await prisma.user.create({
      data: {
        name: data.name,
        email: data.email.toLowerCase(),
        passwordHash: await bcrypt.hash(data.password || "password123", 10),
        phone: data.phone || null,
        roleId: data.roleId,
        branchId: data.branchId || null,
        status: data.status,
      },
    });
    await auditLog({ userId: req.authUserId, action: "CREATE_USER", module: "users", entityId: user.id, details: { email: user.email } });
    res.status(201).json({ ok: true, id: user.id });
  })
);

const userUpdateSchema = userSchema.partial().omit({ password: true }).extend({
  password: z.string().min(6).optional(),
});

router.put(
  "/:id",
  requirePermission("users.manage"),
  validate(userUpdateSchema),
  asyncHandler(async (req, res) => {
    const data = getValidated<z.infer<typeof userUpdateSchema>>(req);
    const existing = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new AppError(404, "User not found");
    if (data.email) {
      const target = await prisma.user.findUnique({ where: { email: data.email.toLowerCase() } });
      if (target && target.id !== req.params.id) throw new AppError(409, "Email already in use");
    }
    await prisma.user.update({
      where: { id: req.params.id },
      data: {
        name: data.name,
        email: data.email ? data.email.toLowerCase() : undefined,
        phone: data.phone ?? undefined,
        roleId: data.roleId,
        branchId: data.branchId ?? null,
        status: data.status,
        ...(data.password ? { passwordHash: await bcrypt.hash(data.password, 10) } : {}),
      },
    });
    await auditLog({ userId: req.authUserId, action: "UPDATE_USER", module: "users", entityId: req.params.id });
    res.json({ ok: true });
  })
);

router.delete(
  "/:id",
  requirePermission("users.manage"),
  asyncHandler(async (req, res) => {
    if (req.params.id === req.authUserId) throw new AppError(400, "You cannot delete your own account");
    const user = await prisma.user.findUnique({ where: { id: req.params.id }, include: { role: true } });
    if (!user) throw new AppError(404, "User not found");
    if (user.role.name === "Super Admin") throw new AppError(400, "Super Admin cannot be deleted");
    await prisma.user.update({ where: { id: req.params.id }, data: { status: "inactive" } });
    await auditLog({ userId: req.authUserId, action: "DELETE_USER", module: "users", entityId: req.params.id, details: { email: user.email } });
    res.json({ ok: true });
  })
);

export default router;