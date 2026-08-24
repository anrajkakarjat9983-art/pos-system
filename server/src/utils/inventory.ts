import { Prisma } from "@prisma/client";
import { prisma } from "../db.js";

export async function getStock(productId: string, variantId: string | null, branchId: string | null): Promise<number> {
  const key = { productId, variantId, branchId } as any;
  const row = await prisma.inventory.findUnique({
    where: { productId_variantId_branchId: key },
  });
  return row?.quantity || 0;
}

export async function applyStockMovement(tx: Prisma.TransactionClient, params: {
  productId: string;
  variantId?: string | null;
  branchId?: string | null;
  type: string;
  quantity: number;
  userId?: string | null;
  referenceType?: string;
  referenceId?: string;
  note?: string;
}): Promise<number> {
  const variantId = params.variantId || null;
  const branchId = params.branchId || null;
  const key = { productId: params.productId, variantId, branchId } as any;
  let inv = await tx.inventory.findUnique({ where: { productId_variantId_branchId: key } });
  if (!inv) {
    inv = await tx.inventory.create({ data: { ...key, quantity: 0 } });
  }
  const prevStock = inv.quantity;
  const newStock = Math.max(0, prevStock + params.quantity);
  const applied = newStock - prevStock;
  await tx.inventory.update({
    where: { id: inv.id },
    data: { quantity: newStock },
  });
  await tx.stockMovement.create({
    data: {
      productId: params.productId,
      variantId,
      branchId,
      type: params.type,
      quantity: applied,
      prevStock,
      newStock,
      userId: params.userId || null,
      referenceType: params.referenceType || null,
      referenceId: params.referenceId || null,
      note: params.note || null,
    },
  });
  return newStock;
}

export async function consumeStock(tx: Prisma.TransactionClient, params: {
  productId: string;
  variantId?: string | null;
  branchId?: string | null;
  type: string;
  quantity: number;
  userId?: string | null;
  referenceType?: string;
  referenceId?: string;
  note?: string;
}): Promise<number> {
  const variantId = params.variantId || null;
  const branchId = params.branchId || null;
  const key = { productId: params.productId, variantId, branchId } as any;
  const inv = await tx.inventory.findUnique({ where: { productId_variantId_branchId: key } });
  const current = inv?.quantity || 0;
  const qty = Math.min(current, params.quantity);
  const newStock = current - qty;
  if (inv) {
    await tx.inventory.update({ where: { id: inv.id }, data: { quantity: newStock } });
  }
  await tx.stockMovement.create({
    data: {
      productId: params.productId,
      variantId,
      branchId,
      type: params.type,
      quantity: -qty,
      prevStock: current,
      newStock,
      userId: params.userId || null,
      referenceType: params.referenceType || null,
      referenceId: params.referenceId || null,
      note: params.note || null,
    },
  });
  return newStock;
}