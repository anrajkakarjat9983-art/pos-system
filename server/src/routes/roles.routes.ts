import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { requireAuth, requirePermission, isSuperAdmin } from "../middleware/auth.js";
import { validate, getValidated } from "../middleware/validate.js";
import { asyncHandler, AppError } from "../middleware/error.js";
import { auditLog } from "../utils/audit.js";

const router = Router();
router.use(requireAuth);

router.get(
  "/",
  requirePermission("roles.view"),
  asyncHandler(async (_req, res) => {
    const roles = await prisma.role.findMany({
      include: { permissions: { select: { permissionId: true } }, _count: { select: { users: true } } },
      orderBy: { name: "asc" },
    });
    res.json(
      roles.map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        isSystem: r.isSystem,
        userCount: r._count.users,
        permissionIds: r.permissions.map((p) => p.permissionId),
      }))
    );
  })
);

router.get(
  "/permissions",
  requirePermission("roles.view"),
  asyncHandler(async (_req, res) => {
    const perms = await prisma.permission.findMany({ orderBy: [{ module: "asc" }, { name: "asc" }] });
    const grouped: Record<string, typeof perms> = {};
    for (const p of perms) {
      (grouped[p.module] ||= []).push(p);
    }
    res.json(grouped);
  })
);

const roleSchema = z.object({
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  permissionIds: z.array(z.string()).default([]),
});

router.post(
  "/",
  requirePermission("roles.manage"),
  validate(roleSchema),
  asyncHandler(async (req, res) => {
    const data = getValidated<z.infer<typeof roleSchema>>(req);
    const role = await prisma.role.create({
      data: {
        name: data.name,
        description: data.description || null,
        permissions: { create: data.permissionIds.map((permissionId) => ({ permissionId })) },
      },
    });
    await auditLog({ userId: req.authUserId, action: "CREATE_ROLE", module: "roles", entityId: role.id, details: { name: role.name } });
    res.status(201).json({ ok: true, id: role.id });
  })
);

const roleUpdateSchema = roleSchema.partial();

router.put(
  "/:id",
  requirePermission("roles.manage"),
  validate(roleUpdateSchema),
  asyncHandler(async (req, res) => {
    const data = getValidated<z.infer<typeof roleUpdateSchema>>(req);
    const role = await prisma.role.findUnique({ where: { id: req.params.id } });
    if (!role) throw new AppError(404, "Role not found");
    if (role.isSystem && data.permissionIds) {
      // system roles may have permission matrix updated but not renamed
    }
    await prisma.$transaction([
      prisma.rolePermission.deleteMany({ where: { roleId: req.params.id } }),
      prisma.role.update({
        where: { id: req.params.id },
        data: {
          name: data.name || role.name,
          description: data.description ?? role.description,
          permissions: {
            create: (data.permissionIds || []).map((permissionId) => ({ permissionId })),
          },
        },
      }),
    ]);
    await auditLog({ userId: req.authUserId, action: "UPDATE_ROLE", module: "roles", entityId: req.params.id });
    res.json({ ok: true });
  })
);

router.delete(
  "/:id",
  requirePermission("roles.manage"),
  asyncHandler(async (req, res) => {
    const role = await prisma.role.findUnique({
      where: { id: req.params.id },
      include: { _count: { select: { users: true } } },
    });
    if (!role) throw new AppError(404, "Role not found");
    if (role.isSystem) throw new AppError(400, "System roles cannot be deleted");
    if (role._count.users > 0) throw new AppError(400, "Role is assigned to users and cannot be deleted");
    await prisma.role.delete({ where: { id: req.params.id } });
    await auditLog({ userId: req.authUserId, action: "DELETE_ROLE", module: "roles", entityId: req.params.id });
    res.json({ ok: true });
  })
);

export default router;