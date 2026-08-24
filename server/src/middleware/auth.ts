import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { config } from "../config.js";
import { prisma } from "../db.js";

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  roleId: string;
  roleName: string;
  branchId: string | null;
  permissions: Set<string>;
}

declare global {
  namespace Express {
    interface Request {
      auth?: AuthUser;
      authUserId?: string;
    }
  }
}

export async function loadPermissions(userId: string): Promise<Set<string>> {
  const perms = await prisma.permission.findMany({
    where: { roles: { some: { role: { users: { some: { id: userId } } } } } },
    select: { key: true },
  });
  return new Set(perms.map((p) => p.key));
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Authentication required" });
  }
  try {
    const payload = jwt.verify(header.slice(7), config.jwtSecret) as {
      userId: string;
      roleId: string;
    };
    req.authUserId = payload.userId;
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

export async function attachAuth(req: Request, _res: Response, next: NextFunction) {
  if (req.auth) return next();
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) return next();
  try {
    const payload = jwt.verify(header.slice(7), config.jwtSecret) as {
      userId: string;
      roleId: string;
    };
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      include: { role: true },
    });
    if (!user || user.status !== "active") {
      req.auth = undefined;
      req.authUserId = payload.userId;
      return next();
    }
    const permissions = await loadPermissions(user.id);
    req.auth = {
      id: user.id,
      name: user.name,
      email: user.email,
      roleId: user.roleId,
      roleName: user.role.name,
      branchId: user.branchId,
      permissions,
    };
    req.authUserId = user.id;
    next();
  } catch {
    next();
  }
}

export function requirePermission(permission: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth) return res.status(401).json({ error: "Authentication required" });
    if (req.auth.permissions.has(permission)) return next();
    return res.status(403).json({ error: "You do not have permission to perform this action" });
  };
}

export function isSuperAdmin(req: Request) {
  return req.auth?.roleName === "Super Admin";
}