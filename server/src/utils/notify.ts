import { prisma } from "../db.js";

export async function notify(params: {
  type: string;
  title: string;
  message: string;
  userId?: string | null;
  branchId?: string | null;
  link?: string;
}) {
  try {
    await prisma.notification.create({
      data: {
        type: params.type,
        title: params.title,
        message: params.message,
        userId: params.userId || null,
        branchId: params.branchId || null,
        link: params.link || null,
      },
    });
  } catch (err) {
    console.error("Notification failed:", err);
  }
}

export async function checkStockAlerts() {
  const products = await prisma.product.findMany({
    where: { status: "active" },
    select: { id: true, name: true, minStock: true, inventories: { select: { quantity: true } } },
    take: 1000,
  });
  const low = products.filter((p) => {
    const q = p.inventories.reduce((s, i) => s + i.quantity, 0);
    return q > 0 && q <= p.minStock;
  });
  const out = products.filter((p) => p.inventories.reduce((s, i) => s + i.quantity, 0) <= 0);
  for (const p of low.slice(0, 10)) {
    await notify({
      type: "low_stock",
      title: "Low stock alert",
      message: `${p.name} is running low (${p.inventories[0]?.quantity ?? 0} left, min ${p.minStock})`,
      link: "/inventory",
    });
  }
  for (const p of out.slice(0, 10)) {
    await notify({
      type: "out_of_stock",
      title: "Out of stock",
      message: `${p.name} is out of stock`,
      link: "/inventory",
    });
  }
  const expSoon = await prisma.productBatch.findMany({
    where: { expiryDate: { lte: new Date(Date.now() + 30 * 86400000), gte: new Date() } },
    include: { product: { select: { name: true } } },
    take: 10,
  });
  for (const b of expSoon) {
    await notify({
      type: "expiry",
      title: "Expiry alert",
      message: `${b.product.name} (batch ${b.batchNumber}) expires ${b.expiryDate?.toISOString().slice(0, 10)}`,
      link: "/inventory?tab=expiry",
    });
  }
}