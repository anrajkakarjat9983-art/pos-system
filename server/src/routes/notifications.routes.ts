import { Router } from "express";
import { prisma } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { asyncHandler, AppError } from "../middleware/error.js";
import { checkStockAlerts } from "../utils/notify.js";

const router = Router();
router.use(requireAuth);

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20));
    const where = req.auth?.roleName === "Super Admin" ? {} : { OR: [{ userId: req.authUserId }, { userId: null }] };
    const [total, rows, unread] = await Promise.all([
      prisma.notification.count({ where }),
      prisma.notification.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.notification.count({ where: { ...where, isRead: false } }),
    ]);
    res.json({ data: rows, total, unread, page, pageSize });
  })
);

router.post(
  "/:id/read",
  asyncHandler(async (req, res) => {
    await prisma.notification.updateMany({
      where: { id: req.params.id, OR: [{ userId: req.authUserId }, { userId: null }] },
      data: { isRead: true },
    });
    res.json({ ok: true });
  })
);

router.post(
  "/read-all",
  asyncHandler(async (req, res) => {
    const where = req.auth?.roleName === "Super Admin" ? {} : { OR: [{ userId: req.authUserId }, { userId: null }] };
    await prisma.notification.updateMany({ where, data: { isRead: true } });
    res.json({ ok: true });
  })
);

router.post(
  "/scan",
  asyncHandler(async (req, res) => {
    await checkStockAlerts();
    res.json({ ok: true });
  })
);

export default router;