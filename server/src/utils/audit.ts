import { prisma } from "../db.js";

export async function auditLog(params: {
  userId?: string | null;
  action: string;
  module: string;
  entityType?: string;
  entityId?: string;
  details?: unknown;
  ipAddress?: string;
}) {
  try {
    await prisma.auditLog.create({
      data: {
        userId: params.userId || null,
        action: params.action,
        module: params.module,
        entityType: params.entityType || null,
        entityId: params.entityId || null,
        details: params.details ? JSON.stringify(params.details) : null,
        ipAddress: params.ipAddress || null,
      },
    });
  } catch (err) {
    console.error("Audit log failed:", err);
  }
}