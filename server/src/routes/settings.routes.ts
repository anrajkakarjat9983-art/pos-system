import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { prisma } from "../db.js";
import { config } from "../config.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";
import { asyncHandler, AppError } from "../middleware/error.js";
import { auditLog } from "../utils/audit.js";
import { getSettings, setSettings } from "../utils/settings.js";

const router = Router();
router.use(requireAuth);

const upload = multer({ dest: path.join(config.uploadsDir, "tmp") });

router.get(
  "/",
  requirePermission("settings.view"),
  asyncHandler(async (_req, res) => {
    res.json(await getSettings());
  })
);

router.put(
  "/",
  requirePermission("settings.manage"),
  asyncHandler(async (req, res) => {
    const values = req.body as Record<string, unknown>;
    const flat: Record<string, string> = {};
    for (const [k, v] of Object.entries(values)) {
      if (v !== undefined && v !== null) flat[k] = typeof v === "object" ? JSON.stringify(v) : String(v);
    }
    await setSettings(flat, "general");
    await auditLog({ userId: req.authUserId, action: "UPDATE_SETTINGS", module: "settings", details: { keys: Object.keys(flat) } });
    res.json({ ok: true });
  })
);

router.post(
  "/upload-logo",
  requirePermission("settings.manage"),
  upload.single("file"),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new AppError(422, "File required");
    const ext = path.extname(req.file.originalname) || ".png";
    const target = path.join(config.uploadsDir, `logo${ext}`);
    fs.renameSync(req.file.path, target);
    await prisma.setting.upsert({
      where: { key: "company.logo" },
      update: { value: `/uploads/logo${ext}` },
      create: { key: "company.logo", value: `/uploads/logo${ext}`, group: "general" },
    });
    res.json({ ok: true, path: `/uploads/logo${ext}` });
  })
);

export default router;