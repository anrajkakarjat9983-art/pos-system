import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { z } from "zod";
import { prisma } from "../db.js";
import { config } from "../config.js";
import { requireAuth, attachAuth, loadPermissions } from "../middleware/auth.js";
import { validate, getValidated } from "../middleware/validate.js";
import { asyncHandler, AppError } from "../middleware/error.js";
import { authLimiter } from "../middleware/rateLimit.js";
import { auditLog } from "../utils/audit.js";
import { getSetting, getCompanyInfo } from "../utils/settings.js";

const router = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

router.post(
  "/login",
  authLimiter,
  validate(loginSchema),
  asyncHandler(async (req, res) => {
    const { email, password } = getValidated<z.infer<typeof loginSchema>>(req);
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      include: { role: true, branch: true },
    });
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      await auditLog({ action: "LOGIN_FAILED", module: "auth", details: { email }, ipAddress: req.ip });
      throw new AppError(401, "Invalid email or password");
    }
    if (user.status !== "active") throw new AppError(403, "Account is disabled. Contact administrator.");
    const permissions = await loadPermissions(user.id);
    const token = jwt.sign({ userId: user.id, roleId: user.roleId }, config.jwtSecret, { expiresIn: "12h" });
    await auditLog({ userId: user.id, action: "LOGIN", module: "auth", ipAddress: req.ip });
    res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        avatar: user.avatar,
        role: user.role.name,
        branchId: user.branchId,
        branchName: user.branch?.name || null,
        permissions: Array.from(permissions),
      },
    });
  })
);

router.post(
  "/logout",
  requireAuth,
  asyncHandler(async (req, res) => {
    await auditLog({ userId: req.authUserId, action: "LOGOUT", module: "auth", ipAddress: req.ip });
    res.json({ ok: true });
  })
);

router.get(
  "/me",
  requireAuth,
  attachAuth,
  asyncHandler(async (req, res) => {
    if (!req.auth) throw new AppError(401, "Authentication required");
    const user = await prisma.user.findUnique({
      where: { id: req.auth.id },
      include: { role: true, branch: true },
    });
    if (!user) throw new AppError(404, "User not found");
    res.json({
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      avatar: user.avatar,
      role: user.role.name,
      branchId: user.branchId,
      branchName: user.branch?.name || null,
      permissions: Array.from(req.auth.permissions),
    });
  })
);

const forgotSchema = z.object({ email: z.string().email() });

router.post(
  "/forgot-password",
  authLimiter,
  validate(forgotSchema),
  asyncHandler(async (req, res) => {
    const { email } = getValidated<z.infer<typeof forgotSchema>>(req);
    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (!user) {
      return res.json({ ok: true, message: "If the account exists, a reset link has been sent." });
    }
    const token = crypto.randomBytes(32).toString("hex");
    await prisma.passwordResetToken.create({
      data: { userId: user.id, token, expiresAt: new Date(Date.now() + 60 * 60 * 1000) },
    });
    const smtpEnabled = (await getSetting("email.smtpEnabled")) === "true";
    const resetUrl = `${config.clientOrigin}/reset-password?token=${token}`;
    if (smtpEnabled) {
      // SMTP integration hooks into email settings; demo mode returns the link instead.
    }
    await auditLog({ userId: user.id, action: "FORGOT_PASSWORD", module: "auth", ipAddress: req.ip });
    res.json({ ok: true, message: "Reset link generated", resetUrl });
  })
);

const resetSchema = z.object({ token: z.string().min(10), password: z.string().min(6) });

router.post(
  "/reset-password",
  authLimiter,
  validate(resetSchema),
  asyncHandler(async (req, res) => {
    const { token, password } = getValidated<z.infer<typeof resetSchema>>(req);
    const record = await prisma.passwordResetToken.findUnique({ where: { token } });
    if (!record || record.usedAt || record.expiresAt < new Date()) {
      throw new AppError(400, "Invalid or expired reset token");
    }
    const hash = await bcrypt.hash(password, 10);
    await prisma.$transaction([
      prisma.user.update({ where: { id: record.userId }, data: { passwordHash: hash } }),
      prisma.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
    ]);
    await auditLog({ userId: record.userId, action: "RESET_PASSWORD", module: "auth", ipAddress: req.ip });
    res.json({ ok: true });
  })
);

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(6),
});

router.post(
  "/change-password",
  requireAuth,
  validate(changePasswordSchema),
  asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = getValidated<z.infer<typeof changePasswordSchema>>(req);
    const user = await prisma.user.findUnique({ where: { id: req.authUserId } });
    if (!user) throw new AppError(404, "User not found");
    if (!(await bcrypt.compare(currentPassword, user.passwordHash))) {
      throw new AppError(400, "Current password is incorrect");
    }
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await bcrypt.hash(newPassword, 10) } });
    await auditLog({ userId: user.id, action: "CHANGE_PASSWORD", module: "auth", ipAddress: req.ip });
    res.json({ ok: true });
  })
);

const profileSchema = z.object({
  name: z.string().min(1),
  phone: z.string().nullable().optional(),
  avatar: z.string().nullable().optional(),
});

router.put(
  "/profile",
  requireAuth,
  validate(profileSchema),
  asyncHandler(async (req, res) => {
    const data = getValidated<z.infer<typeof profileSchema>>(req);
    const user = await prisma.user.update({
      where: { id: req.authUserId },
      data: { name: data.name, phone: data.phone ?? null, avatar: data.avatar ?? null },
    });
    await auditLog({ userId: user.id, action: "UPDATE_PROFILE", module: "auth", ipAddress: req.ip });
    res.json({ ok: true, user });
  })
);

router.get(
  "/company",
  asyncHandler(async (_req, res) => {
    res.json(await getCompanyInfo());
  })
);

export default router;