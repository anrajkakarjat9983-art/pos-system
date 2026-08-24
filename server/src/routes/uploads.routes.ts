import { Router } from "express";
import multer from "multer";
import path from "path";
import crypto from "crypto";
import { config } from "../config.js";
import { requireAuth } from "../middleware/auth.js";
import { asyncHandler, AppError } from "../middleware/error.js";

const router = Router();
router.use(requireAuth);

const upload = multer({ dest: path.join(config.uploadsDir, "tmp") });

router.post(
  "/image",
  upload.single("file"),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new AppError(422, "File required");
    if (req.file.size > 5 * 1024 * 1024) {
      throw new AppError(422, "File too large (max 5MB)");
    }
    const ext = path.extname(req.file.originalname).toLowerCase() || ".png";
    const name = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}${ext}`;
    const target = path.join(config.uploadsDir, name);
    const fs = await import("fs");
    fs.renameSync(req.file.path, target);
    res.json({ ok: true, path: `/uploads/${name}` });
  })
);

export default router;