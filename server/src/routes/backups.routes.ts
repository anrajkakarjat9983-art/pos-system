import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { prisma } from "../db.js";
import { config } from "../config.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";
import { asyncHandler, AppError } from "../middleware/error.js";
import { auditLog } from "../utils/audit.js";
import { extractQuery } from "../utils/helpers.js";

const router = Router();
router.use(requireAuth);

const upload = multer({ dest: path.join(config.uploadsDir, "tmp") });

router.get(
  "/",
  requirePermission("backups.manage"),
  asyncHandler(async (req, res) => {
    const { page, pageSize } = extractQuery(req.query);
    const [total, rows] = await Promise.all([
      prisma.backup.count(),
      prisma.backup.findMany({
        include: { user: { select: { name: true } } },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    res.json({ data: rows, total, page, pageSize });
  })
);

router.post(
  "/",
  requirePermission("backups.manage"),
  asyncHandler(async (req, res) => {
    const backupDir = path.join(config.dataDir, "backups");
    if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const fileName = `pos-backup-${stamp}.db`;
    const target = path.join(backupDir, fileName);
    try {
      await prisma.$executeRawUnsafe(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
    } catch (err: any) {
      // fallback: plain file copy
      fs.copyFileSync(config.dbPath, target);
      console.warn("VACUUM INTO failed, used file copy:", err.message);
    }
    const size = fs.statSync(target).size;
    const backup = await prisma.backup.create({
      data: {
        filename: fileName,
        path: target,
        size,
        type: "manual",
        status: "completed",
        userId: req.authUserId,
      },
    });
    await auditLog({ userId: req.authUserId, action: "CREATE_BACKUP", module: "backups", entityId: backup.id });
    res.status(201).json({ ok: true, id: backup.id, filename: fileName, size });
  })
);

router.post(
  "/restore/:id",
  requirePermission("backups.manage"),
  asyncHandler(async (req, res) => {
    const backup = await prisma.backup.findUnique({ where: { id: req.params.id } });
    if (!backup) throw new AppError(404, "Backup not found");
    if (!fs.existsSync(backup.path)) throw new AppError(404, "Backup file missing on disk");
    const header = fs.readFileSync(backup.path).subarray(0, 16).toString();
    if (!header.startsWith("SQLite format 3")) throw new AppError(422, "Backup file is not a valid SQLite database");
    await prisma.$disconnect();
    fs.copyFileSync(backup.path, config.dbPath);
    await prisma.$connect();
    await prisma.backup.update({
      where: { id: backup.id },
      data: { status: "restored", note: `Restored ${new Date().toISOString()}` },
    });
    await auditLog({ userId: req.authUserId, action: "RESTORE_BACKUP", module: "backups", entityId: backup.id });
    res.json({ ok: true, message: "Backup restored. Reload the application." });
  })
);

router.post(
  "/upload",
  requirePermission("backups.manage"),
  upload.single("file"),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new AppError(422, "Backup file required");
    const header = fs.readFileSync(req.file.path).subarray(0, 16).toString();
    if (!header.startsWith("SQLite format 3")) {
      fs.unlinkSync(req.file.path);
      throw new AppError(422, "Not a valid SQLite backup file");
    }
    const backupDir = path.join(config.dataDir, "backups");
    const fileName = `pos-restore-${Date.now()}.db`;
    const target = path.join(backupDir, fileName);
    fs.renameSync(req.file.path, target);
    await prisma.$disconnect();
    fs.copyFileSync(target, config.dbPath);
    await prisma.$connect();
    const backup = await prisma.backup.create({
      data: {
        filename: fileName,
        path: target,
        size: fs.statSync(target).size,
        type: "manual",
        status: "restored",
        note: "Uploaded and restored",
        userId: req.authUserId,
      },
    });
    await auditLog({ userId: req.authUserId, action: "RESTORE_BACKUP", module: "backups", entityId: backup.id, details: { source: "upload" } });
    res.json({ ok: true, message: "Backup restored from upload. Reload the application." });
  })
);

router.delete(
  "/:id",
  requirePermission("backups.manage"),
  asyncHandler(async (req, res) => {
    const backup = await prisma.backup.findUnique({ where: { id: req.params.id } });
    if (!backup) throw new AppError(404, "Backup not found");
    try {
      if (fs.existsSync(backup.path)) fs.unlinkSync(backup.path);
    } catch {}
    await prisma.backup.delete({ where: { id: backup.id } });
    res.json({ ok: true });
  })
);

router.post(
  "/schedule",
  requirePermission("backups.manage"),
  asyncHandler(async (req, res) => {
    const { enabled, intervalHours } = req.body as { enabled?: boolean; intervalHours?: number };
    const { setSetting } = await import("../utils/settings.js");
    if (enabled !== undefined) await setSetting("backup.automatic", String(enabled));
    if (intervalHours !== undefined) await setSetting("backup.intervalHours", String(intervalHours));
    res.json({ ok: true });
  })
);

export default router;