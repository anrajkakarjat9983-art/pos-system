import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";
import { validate, getValidated } from "../middleware/validate.js";
import { asyncHandler, AppError } from "../middleware/error.js";
import { auditLog } from "../utils/audit.js";

const router = Router();
router.use(requireAuth);

function crudRoutes(modelName: "category" | "brand" | "unit" | "taxRate", permissionKey: string) {
  const r = Router();
  const model = {
    category: prisma.category,
    brand: prisma.brand,
    unit: prisma.unit,
    taxRate: prisma.taxRate,
  }[modelName] as any;

  const schema =
    modelName === "taxRate"
      ? z.object({
          name: z.string().min(1),
          rate: z.number(),
          cgst: z.number().default(0),
          sgst: z.number().default(0),
          igst: z.number().default(0),
          type: z.string().default("exclusive"),
          status: z.string().default("active"),
        })
      : modelName === "unit"
      ? z.object({ name: z.string().min(1), shortName: z.string().min(1) })
      : z.object({
          name: z.string().min(1),
          parentId: z.string().nullable().optional(),
          status: z.string().default("active"),
        });

  r.get(
    "/",
    requirePermission(permissionKey),
    asyncHandler(async (_req, res) => {
      const rows =
        modelName === "category"
          ? await prisma.category.findMany({
              include: { children: true, _count: { select: { products: true } } },
              orderBy: { name: "asc" },
            })
          : await model.findMany({ orderBy: { name: "asc" } });
      res.json(rows);
    })
  );

  r.post(
    "/",
    requirePermission(permissionKey),
    validate(schema),
    asyncHandler(async (req, res) => {
      const data = getValidated(req);
      const row = await model.create({ data });
      await auditLog({ userId: req.authUserId, action: `CREATE_${modelName.toUpperCase()}`, module: "catalog", entityId: row.id });
      res.status(201).json({ ok: true, id: row.id });
    })
  );

  const updateSchema = schema.partial();
  r.put(
    "/:id",
    requirePermission(permissionKey),
    validate(updateSchema),
    asyncHandler(async (req, res) => {
      const data = getValidated(req);
      await model.update({ where: { id: req.params.id }, data });
      await auditLog({ userId: req.authUserId, action: `UPDATE_${modelName.toUpperCase()}`, module: "catalog", entityId: req.params.id });
      res.json({ ok: true });
    })
  );

  r.delete(
    "/:id",
    requirePermission(permissionKey),
    asyncHandler(async (req, res) => {
      const row = await model.findUnique({ where: { id: req.params.id } });
      if (!row) throw new AppError(404, "Record not found");
      await model.update({ where: { id: req.params.id }, data: { status: "inactive" } });
      await auditLog({ userId: req.authUserId, action: `DELETE_${modelName.toUpperCase()}`, module: "catalog", entityId: req.params.id });
      res.json({ ok: true });
    })
  );

  return r;
}

router.use("/categories", crudRoutes("category", "categories.manage"));
router.use("/brands", crudRoutes("brand", "brands.manage"));
router.use("/units", crudRoutes("unit", "units.manage"));
router.use("/tax-rates", crudRoutes("taxRate", "taxrates.manage"));

export default router;