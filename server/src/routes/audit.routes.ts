import { Router } from "express";
import { prisma } from "../db.js";
import { requireAuth, requirePermission, isSuperAdmin } from "../middleware/auth.js";
import { asyncHandler, AppError } from "../middleware/error.js";
import { extractQuery } from "../utils/helpers.js";

const router = Router();
router.use(requireAuth, requirePermission("audit.view"));

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const { search, page, pageSize, from, to } = extractQuery(req.query);
    const module = typeof req.query.module === "string" && req.query.module ? req.query.module : null;
    const action = typeof req.query.action === "string" && req.query.action ? req.query.action : null;
    const where: any = {
      ...(module ? { module } : {}),
      ...(action ? { action: { contains: action } } : {}),
      ...(from || to ? { createdAt: { gte: from ?? undefined, lte: to ?? undefined } } : {}),
      ...(search ? { OR: [{ user: { name: { contains: search } } }, { action: { contains: search } }, { entityId: { contains: search } }] } : {}),
    };
    const [total, rows] = await Promise.all([
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({
        where,
        include: { user: { select: { name: true, email: true } } },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    res.json({ data: rows, total, page, pageSize });
  })
);

router.get(
  "/modules",
  asyncHandler(async (_req, res) => {
    const rows = await prisma.auditLog.groupBy({ by: ["module"], _count: true });
    res.json(rows);
  })
);

export default router;