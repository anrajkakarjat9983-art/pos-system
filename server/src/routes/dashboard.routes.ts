import { Router } from "express";
import { prisma } from "../db.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/error.js";
import { rangeFor } from "../utils/numbers.js";

const router = Router();
router.use(requireAuth);

async function totals(where: any) {
  const [sales, purchases, expenses, refunds, profit] = await Promise.all([
    prisma.sale.aggregate({ where: { ...where, status: "completed" }, _sum: { total: true, taxAmount: true, subtotal: true } }),
    prisma.purchase.aggregate({ where: { ...where, status: { not: "cancelled" } }, _sum: { total: true } }),
    prisma.expense.aggregate({ where, _sum: { amount: true } }),
    prisma.salesReturn.aggregate({ where: { ...where, status: "completed" }, _sum: { refundAmount: true } }),
    prisma.$queryRawUnsafe<{ profit: number }[]>(
      `SELECT COALESCE(SUM(si.total - si.discountAmount - si.taxAmount - (si.costPrice * si.quantity)), 0) as profit
       FROM SaleItem si JOIN Sale s ON s.id = si.saleId
       WHERE s.status = 'completed' AND s.createdAt BETWEEN ? AND ?`,
      where.createdAt?.gte || new Date(0), where.createdAt?.lte || new Date(8640000000000000)
    ),
  ]);
  return {
    sales: sales._sum.total || 0,
    salesTax: sales._sum.taxAmount || 0,
    purchases: purchases._sum.total || 0,
    expenses: expenses._sum.amount || 0,
    refunds: refunds._sum.refundAmount || 0,
    profit: Math.round(profit[0]?.profit || 0),
  };
}

router.get(
  "/stats",
  requirePermission("dashboard.view"),
  asyncHandler(async (req, res) => {
    const range = rangeFor(String(req.query.period || "today"), String(req.query.from || ""), String(req.query.to || ""));
    const where = { createdAt: { gte: range.from, lte: range.to } };
    const t = await totals(where);

    const [customers, suppliers, products, stockProducts, pendingCustomerPayments, pendingSupplierPayments, cashBalance, pendingPurchases] =
      await Promise.all([
        prisma.customer.count({ where: { status: "active" } }),
        prisma.supplier.count({ where: { status: "active" } }),
        prisma.product.count({ where: { status: "active" } }),
        prisma.product.findMany({
          where: { status: "active" },
          include: { inventories: { select: { quantity: true } } },
          take: 1000,
        }),
        prisma.customerTransaction.aggregate({
          where: { type: { in: ["sale", "opening", "adjustment"] }, balanceAfter: { gt: 0 } },
          _sum: { balanceAfter: true },
        }),
        prisma.supplierTransaction.aggregate({
          where: { type: { in: ["purchase", "opening", "adjustment"] }, balanceAfter: { gt: 0 } },
          _sum: { balanceAfter: true },
        }),
        prisma.$queryRawUnsafe<{ total: number }[]>(
          `SELECT
            COALESCE((SELECT SUM(amount) FROM CashTransaction WHERE type IN ('opening','sale','cash_in') AND registerId IN (SELECT id FROM CashRegister WHERE status = 'open')), 0) -
            COALESCE((SELECT SUM(amount) FROM CashTransaction WHERE type IN ('expense','refund','cash_out') AND registerId IN (SELECT id FROM CashRegister WHERE status = 'open')), 0) as total`
        ),
        prisma.purchase.count({ where: { status: { in: ["pending", "draft"] } } }),
      ]);

    res.json({
      ...t,
      customers,
      suppliers,
      products,
      lowStock: stockProducts.filter((p) => {
        const q = p.inventories.reduce((s, i) => s + i.quantity, 0);
        return q > 0 && q <= p.minStock;
      }).length,
      outStock: stockProducts.filter((p) => p.inventories.reduce((s, i) => s + i.quantity, 0) <= 0).length,
      pendingCustomerPayments: pendingCustomerPayments._sum.balanceAfter || 0,
      pendingSupplierPayments: pendingSupplierPayments._sum.balanceAfter || 0,
      cashBalance: Number(cashBalance[0]?.total || 0),
      pendingPurchases,
      period: range,
    });
  })
);

router.get(
  "/chart/sales-purchases",
  requirePermission("dashboard.view"),
  asyncHandler(async (req, res) => {
    const range = rangeFor(String(req.query.period || "30d"), String(req.query.from || ""), String(req.query.to || ""));
    const days: string[] = [];
    for (let d = new Date(range.from); d <= range.to; d.setDate(d.getDate() + 1)) {
      days.push(d.toISOString().slice(0, 10));
    }
    const [sales, purchases] = await Promise.all([
      prisma.$queryRawUnsafe<{ day: string; total: number }[]>(
        `SELECT strftime('%Y-%m-%d', createdAt) as day, SUM(total) as total FROM Sale WHERE status = 'completed' AND createdAt BETWEEN ? AND ? GROUP BY day`,
        range.from, range.to
      ),
      prisma.$queryRawUnsafe<{ day: string; total: number }[]>(
        `SELECT strftime('%Y-%m-%d', createdAt) as day, SUM(total) as total FROM Purchase WHERE status != 'cancelled' AND createdAt BETWEEN ? AND ? GROUP BY day`,
        range.from, range.to
      ),
    ]);
    const salesMap = Object.fromEntries(sales.map((s) => [s.day, Number(s.total)]));
    const purchasesMap = Object.fromEntries(purchases.map((s) => [s.day, Number(s.total)]));
    res.json({
      labels: days,
      sales: days.map((d) => salesMap[d] || 0),
      purchases: days.map((d) => purchasesMap[d] || 0),
    });
  })
);

router.get(
  "/chart/profit",
  requirePermission("dashboard.view"),
  asyncHandler(async (req, res) => {
    const range = rangeFor(String(req.query.period || "30d"), String(req.query.from || ""), String(req.query.to || ""));
    const rows = await prisma.$queryRawUnsafe<{ day: string; profit: number }[]>(
      `SELECT strftime('%Y-%m-%d', s.createdAt) as day,
        SUM(si.total - si.discountAmount - si.taxAmount - (si.costPrice * si.quantity)) as profit
       FROM SaleItem si JOIN Sale s ON s.id = si.saleId
       WHERE s.status = 'completed' AND s.createdAt BETWEEN ? AND ?
       GROUP BY day`,
      range.from, range.to
    );
    res.json(rows.map((r) => ({ day: r.day, profit: Math.round(r.profit) })));
  })
);

router.get(
  "/chart/top-products",
  requirePermission("dashboard.view"),
  asyncHandler(async (req, res) => {
    const range = rangeFor(String(req.query.period || "30d"), String(req.query.from || ""), String(req.query.to || ""));
    const rows = await prisma.$queryRawUnsafe<{ name: string; qty: number; total: number }[]>(
      `SELECT COALESCE(p.name, si.note) as name, SUM(si.quantity) as qty, SUM(si.total) as total
       FROM SaleItem si LEFT JOIN Product p ON p.id = si.productId
       JOIN Sale s ON s.id = si.saleId
       WHERE s.status = 'completed' AND s.createdAt BETWEEN ? AND ?
       GROUP BY name ORDER BY qty DESC LIMIT 10`,
      range.from, range.to
    );
    res.json(rows);
  })
);

router.get(
  "/chart/sales-by-category",
  requirePermission("dashboard.view"),
  asyncHandler(async (req, res) => {
    const range = rangeFor(String(req.query.period || "30d"), String(req.query.from || ""), String(req.query.to || ""));
    const rows = await prisma.$queryRawUnsafe<{ name: string; total: number }[]>(
      `SELECT COALESCE(c.name, 'Uncategorized') as name, SUM(si.total) as total
       FROM SaleItem si
       LEFT JOIN Product p ON p.id = si.productId
       LEFT JOIN Category c ON c.id = p.categoryId
       JOIN Sale s ON s.id = si.saleId
       WHERE s.status = 'completed' AND s.createdAt BETWEEN ? AND ?
       GROUP BY name ORDER BY total DESC`,
      range.from, range.to
    );
    res.json(rows);
  })
);

router.get(
  "/chart/payments",
  requirePermission("dashboard.view"),
  asyncHandler(async (req, res) => {
    const range = rangeFor(String(req.query.period || "30d"), String(req.query.from || ""), String(req.query.to || ""));
    const rows = await prisma.$queryRawUnsafe<{ method: string; total: number }[]>(
      `SELECT method, SUM(amount) as total FROM SalePayment WHERE receivedAt BETWEEN ? AND ? GROUP BY method`,
      range.from, range.to
    );
    res.json(rows.map((r) => ({ method: r.method, total: Number(r.total) })));
  })
);

export default router;