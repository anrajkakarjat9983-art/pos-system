import { prisma } from "../db.js";

async function nextNumber(model: "sale" | "purchase" | "salesReturn" | "purchaseReturn" | "stockTransfer", prefix: string): Promise<string> {
  const result = await prisma.$queryRawUnsafe<{ cnt: number }[]>(
    `SELECT COUNT(*) as cnt FROM "${model}"`
  );
  const count = Number(result[0]?.cnt || 0) + 1;
  const now = new Date();
  const y = now.getFullYear().toString().slice(2);
  const m = String(now.getMonth() + 1).padStart(2, "0");
  return `${prefix}-${y}${m}-${String(count).padStart(5, "0")}`;
}

export async function nextSaleNo() {
  return nextNumber("sale", "INV");
}

export async function nextPurchaseNo() {
  return nextNumber("purchase", "PUR");
}

export async function nextSalesReturnNo() {
  return nextNumber("salesReturn", "SR");
}

export async function nextPurchaseReturnNo() {
  return nextNumber("purchaseReturn", "PR");
}

export async function nextTransferNo() {
  return nextNumber("stockTransfer", "TRF");
}