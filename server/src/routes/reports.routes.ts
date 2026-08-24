import { Router } from "express";
import { prisma } from "../db.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/error.js";
import { extractQuery } from "../utils/helpers.js";
import { rangeFor, round2, dateStart, dateEnd } from "../utils/numbers.js";

const router = Router();
router.use(requireAuth, requirePermission("reports.view"));

function csvResponse(res: any, rows: any[][], name: string) {
  const csv = rows.map((l) => l.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\r\n");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename=${name}-${Date.now()}.csv`);
  res.send("\uFEFF" + csv);
}

function range(req: any) {
  return rangeFor(String(req.query.period || "30d"), String(req.query.from || ""), String(req.query.to || ""));
}

// ============ SALES ============

router.get("/sales/daily", asyncHandler(async (req, res) => {
  const { from, to } = range(req);
  const rows = await prisma.$queryRawUnsafe<{ day: string; count: number; total: number; tax: number; discount: number }[]>(
    `SELECT strftime('%Y-%m-%d', createdAt) as day, COUNT(*) as count, SUM(total) as total, SUM(taxAmount) as tax, SUM(discountAmount) as discount
     FROM Sale WHERE status = 'completed' AND createdAt BETWEEN ? AND ? GROUP BY day ORDER BY day DESC`, from, to);
  if (req.query.export === "1") {
    return csvResponse(res, [["Date", "Invoices", "Total", "Tax", "Discount"], ...rows.map((r) => [r.day, r.count, r.total, r.tax, r.discount])], "daily-sales");
  }
  res.json(rows.map((r) => ({ ...r, total: Number(r.total), tax: Number(r.tax), discount: Number(r.discount) })));
}));

router.get("/sales/monthly", asyncHandler(async (req, res) => {
  const { from, to } = range(req);
  const rows = await prisma.$queryRawUnsafe<{ month: string; count: number; total: number }[]>(
    `SELECT strftime('%Y-%m', createdAt) as month, COUNT(*) as count, SUM(total) as total
     FROM Sale WHERE status = 'completed' AND createdAt BETWEEN ? AND ? GROUP BY month ORDER BY month DESC`, from, to);
  if (req.query.export === "1") return csvResponse(res, [["Month", "Invoices", "Total"], ...rows.map((r) => [r.month, r.count, r.total])], "monthly-sales");
  res.json(rows.map((r) => ({ ...r, total: Number(r.total) })));
}));

router.get("/sales/yearly", asyncHandler(async (req, res) => {
  const { from, to } = range(req);
  const rows = await prisma.$queryRawUnsafe<{ year: string; count: number; total: number }[]>(
    `SELECT strftime('%Y', createdAt) as year, COUNT(*) as count, SUM(total) as total
     FROM Sale WHERE status = 'completed' AND createdAt BETWEEN ? AND ? GROUP BY year ORDER BY year DESC`, from, to);
  if (req.query.export === "1") return csvResponse(res, [["Year", "Invoices", "Total"], ...rows.map((r) => [r.year, r.count, r.total])], "yearly-sales");
  res.json(rows.map((r) => ({ ...r, total: Number(r.total) })));
}));

router.get("/sales/products", asyncHandler(async (req, res) => {
  const { from, to } = range(req);
  const { search, page, pageSize } = extractQuery(req.query);
  const rows = await prisma.$queryRawUnsafe<{ name: string; sku: string; qty: number; total: number; cost: number; profit: number }[]>(
    `SELECT COALESCE(p.name, si.note) as name, COALESCE(p.sku, '') as sku, SUM(si.quantity) as qty, SUM(si.total) as total,
      SUM(si.costPrice * si.quantity) as cost, SUM(si.total - si.discountAmount - si.taxAmount - (si.costPrice * si.quantity)) as profit
     FROM SaleItem si LEFT JOIN Product p ON p.id = si.productId JOIN Sale s ON s.id = si.saleId
     WHERE s.status = 'completed' AND s.createdAt BETWEEN ? AND ?
     GROUP BY name, sku ORDER BY qty DESC`, from, to);
  const filtered = search ? rows.filter((r) => r.name.toLowerCase().includes(search.toLowerCase()) || r.sku.toLowerCase().includes(search.toLowerCase())) : rows;
  if (req.query.export === "1") {
    return csvResponse(res, [["Product", "SKU", "Qty", "Sales", "Cost", "Profit"], ...filtered.map((r) => [r.name, r.sku, r.qty, r.total, r.cost, r.profit])], "product-sales");
  }
  res.json({ data: filtered.slice((page - 1) * pageSize, page * pageSize), total: filtered.length, page, pageSize });
}));

router.get("/sales/categories", asyncHandler(async (req, res) => {
  const { from, to } = range(req);
  const rows = await prisma.$queryRawUnsafe<{ name: string; qty: number; total: number }[]>(
    `SELECT COALESCE(c.name, 'Uncategorized') as name, SUM(si.quantity) as qty, SUM(si.total) as total
     FROM SaleItem si LEFT JOIN Product p ON p.id = si.productId LEFT JOIN Category c ON c.id = p.categoryId
     JOIN Sale s ON s.id = si.saleId WHERE s.status = 'completed' AND s.createdAt BETWEEN ? AND ?
     GROUP BY name ORDER BY total DESC`, from, to);
  if (req.query.export === "1") return csvResponse(res, [["Category", "Qty", "Total"], ...rows.map((r) => [r.name, r.qty, r.total])], "category-sales");
  res.json(rows);
}));

router.get("/sales/customers", asyncHandler(async (req, res) => {
  const { from, to } = range(req);
  const rows = await prisma.$queryRawUnsafe<{ name: string; phone: string; count: number; total: number }[]>(
    `SELECT COALESCE(c.name, 'Walk-in') as name, COALESCE(c.phone, '') as phone, COUNT(*) as count, SUM(s.total) as total
     FROM Sale s LEFT JOIN Customer c ON c.id = s.customerId
     WHERE s.status = 'completed' AND s.createdAt BETWEEN ? AND ? GROUP BY name, phone ORDER BY total DESC`, from, to);
  if (req.query.export === "1") return csvResponse(res, [["Customer", "Phone", "Invoices", "Total"], ...rows.map((r) => [r.name, r.phone, r.count, r.total])], "customer-sales");
  res.json(rows);
}));

router.get("/sales/cashiers", asyncHandler(async (req, res) => {
  const { from, to } = range(req);
  const rows = await prisma.$queryRawUnsafe<{ name: string; count: number; total: number }[]>(
    `SELECT COALESCE(u.name, 'Unknown') as name, COUNT(*) as count, SUM(s.total) as total
     FROM Sale s LEFT JOIN User u ON u.id = s.userId
     WHERE s.status = 'completed' AND s.createdAt BETWEEN ? AND ? GROUP BY name ORDER BY total DESC`, from, to);
  if (req.query.export === "1") return csvResponse(res, [["Cashier", "Invoices", "Total"], ...rows.map((r) => [r.name, r.count, r.total])], "cashier-sales");
  res.json(rows);
}));

router.get("/sales/payments", asyncHandler(async (req, res) => {
  const { from, to } = range(req);
  const rows = await prisma.$queryRawUnsafe<{ method: string; count: number; total: number }[]>(
    `SELECT method, COUNT(*) as count, SUM(amount) as total FROM SalePayment WHERE receivedAt BETWEEN ? AND ? GROUP BY method ORDER BY total DESC`, from, to);
  if (req.query.export === "1") return csvResponse(res, [["Method", "Payments", "Total"], ...rows.map((r) => [r.method, r.count, r.total])], "payment-sales");
  res.json(rows);
}));

router.get("/sales/branches", asyncHandler(async (req, res) => {
  const { from, to } = range(req);
  const rows = await prisma.$queryRawUnsafe<{ name: string; count: number; total: number }[]>(
    `SELECT COALESCE(b.name, 'Main') as name, COUNT(*) as count, SUM(s.total) as total
     FROM Sale s LEFT JOIN Branch b ON b.id = s.branchId
     WHERE s.status = 'completed' AND s.createdAt BETWEEN ? AND ? GROUP BY name ORDER BY total DESC`, from, to);
  if (req.query.export === "1") return csvResponse(res, [["Branch", "Invoices", "Total"], ...rows.map((r) => [r.name, r.count, r.total])], "branch-sales");
  res.json(rows);
}));

// ============ PURCHASES ============

router.get("/purchases", asyncHandler(async (req, res) => {
  const { from, to } = range(req);
  const rows = await prisma.$queryRawUnsafe<{ day: string; count: number; total: number; tax: number }[]>(
    `SELECT strftime('%Y-%m-%d', createdAt) as day, COUNT(*) as count, SUM(total) as total, SUM(taxAmount) as tax
     FROM Purchase WHERE status != 'cancelled' AND createdAt BETWEEN ? AND ? GROUP BY day ORDER BY day DESC`, from, to);
  if (req.query.export === "1") return csvResponse(res, [["Date", "Purchases", "Total", "Tax"], ...rows.map((r) => [r.day, r.count, r.total, r.tax])], "purchases");
  res.json(rows);
}));

router.get("/purchases/suppliers", asyncHandler(async (req, res) => {
  const { from, to } = range(req);
  const rows = await prisma.$queryRawUnsafe<{ name: string; count: number; total: number; paid: number }[]>(
    `SELECT COALESCE(s.name, 'Unknown') as name, COUNT(*) as count, SUM(p.total) as total, SUM(p.paidAmount) as paid
     FROM Purchase p JOIN Supplier s ON s.id = p.supplierId
     WHERE p.status != 'cancelled' AND p.createdAt BETWEEN ? AND ? GROUP BY name ORDER BY total DESC`, from, to);
  if (req.query.export === "1") return csvResponse(res, [["Supplier", "Purchases", "Total", "Paid", "Due"], ...rows.map((r) => [r.name, r.count, r.total, r.paid, Number(r.total) - Number(r.paid)])], "supplier-purchases");
  res.json(rows);
}));

router.get("/purchases/products", asyncHandler(async (req, res) => {
  const { from, to } = range(req);
  const rows = await prisma.$queryRawUnsafe<{ name: string; sku: string; qty: number; total: number }[]>(
    `SELECT COALESCE(p.name, 'Unknown') as name, COALESCE(p.sku, '') as sku, SUM(pi.quantity) as qty, SUM(pi.total) as total
     FROM PurchaseItem pi LEFT JOIN Product p ON p.id = pi.productId JOIN Purchase pu ON pu.id = pi.purchaseId
     WHERE pu.status != 'cancelled' AND pu.createdAt BETWEEN ? AND ? GROUP BY name, sku ORDER BY qty DESC`, from, to);
  if (req.query.export === "1") return csvResponse(res, [["Product", "SKU", "Qty", "Total"], ...rows.map((r) => [r.name, r.sku, r.qty, r.total])], "product-purchases");
  res.json(rows);
}));

// ============ INVENTORY ============

router.get("/inventory/stock", asyncHandler(async (req, res) => {
  const { search, page, pageSize } = extractQuery(req.query);
  const branchId = req.auth?.branchId || null;
  const rows = await prisma.product.findMany({
    where: { ...(search ? { OR: [{ name: { contains: search } }, { sku: { contains: search } }] } : {}), status: "active" },
    include: { category: true, unit: true, inventories: { where: { branchId } } },
    orderBy: { name: "asc" },
  });
  const data = rows.map((p) => {
    const stock = p.inventories.reduce((s, i) => s + i.quantity, 0);
    return { name: p.name, sku: p.sku, category: p.category?.name || "", stock, purchasePrice: p.purchasePrice, value: round2(stock * p.purchasePrice) };
  });
  if (req.query.export === "1") {
    return csvResponse(res, [["Product", "SKU", "Category", "Stock", "Purchase Price", "Value"], ...data.map((r) => [r.name, r.sku, r.category, r.stock, r.purchasePrice, r.value])], "stock");
  }
  res.json({ data: data.slice((page - 1) * pageSize, page * pageSize), total: data.length, page, pageSize });
}));

router.get("/inventory/movements", asyncHandler(async (req, res) => {
  const { from, to } = range(req);
  const { search, page, pageSize } = extractQuery(req.query);
  const where: any = {
    createdAt: { gte: from, lte: to },
    ...(search ? { product: { name: { contains: search } } } : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.stockMovement.count({ where }),
    prisma.stockMovement.findMany({
      where,
      include: { product: { select: { name: true, sku: true } }, user: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);
  if (req.query.export === "1") {
    return csvResponse(res, [["Date", "Product", "Type", "Qty", "Prev Stock", "New Stock", "User"],
      ...rows.map((r) => [r.createdAt.toISOString(), r.product.name, r.type, r.quantity, r.prevStock, r.newStock, r.user?.name])], "movements");
  }
  res.json({ data: rows, total, page, pageSize });
}));

router.get("/inventory/low-stock", asyncHandler(async (req, res) => {
  const branchId = req.auth?.branchId || null;
  const candidates = await prisma.product.findMany({
    where: { status: "active" },
    include: { inventories: { where: { branchId } }, unit: true },
    orderBy: { name: "asc" },
    take: 1000,
  });
  const rows = candidates.filter((p) => {
    const q = p.inventories.reduce((s, i) => s + i.quantity, 0);
    return q > 0 && q <= p.minStock;
  });
  const data = rows.map((p) => {
    const stock = p.inventories.reduce((s, i) => s + i.quantity, 0);
    return { name: p.name, sku: p.sku, stock, minStock: p.minStock, unit: p.unit?.shortName || "" };
  });
  if (req.query.export === "1") return csvResponse(res, [["Product", "SKU", "Stock", "Min Stock", "Unit"], ...data.map((r) => [r.name, r.sku, r.stock, r.minStock, r.unit])], "low-stock");
  res.json(data);
}));

router.get("/inventory/out-of-stock", asyncHandler(async (req, res) => {
  const branchId = req.auth?.branchId || null;
  const candidates = await prisma.product.findMany({
    where: { status: "active" },
    include: { inventories: { where: { branchId } } },
    orderBy: { name: "asc" },
    take: 1000,
  });
  const rows = candidates.filter((p) => p.inventories.reduce((s, i) => s + i.quantity, 0) <= 0);
  const data = rows.map((p) => ({ name: p.name, sku: p.sku, stock: p.inventories.reduce((s, i) => s + i.quantity, 0) }));
  if (req.query.export === "1") return csvResponse(res, [["Product", "SKU", "Stock"], ...data.map((r) => [r.name, r.sku, r.stock])], "out-of-stock");
  res.json(data);
}));

router.get("/inventory/expiry", asyncHandler(async (req, res) => {
  const { from, to } = range(req);
  const rows = await prisma.productBatch.findMany({
    where: { quantity: { gt: 0 }, expiryDate: { gte: from, lte: to } },
    include: { product: { select: { name: true, sku: true } } },
    orderBy: { expiryDate: "asc" },
    take: 500,
  });
  const data = rows.map((r) => ({ product: r.product.name, sku: r.product.sku, batch: r.batchNumber, expiry: r.expiryDate, qty: r.quantity }));
  if (req.query.export === "1") return csvResponse(res, [["Product", "SKU", "Batch", "Expiry", "Qty"], ...data.map((r) => [r.product, r.sku, r.batch, r.expiry?.toISOString().slice(0, 10), r.qty])], "expiry");
  res.json(data);
}));

router.get("/inventory/batches", asyncHandler(async (req, res) => {
  const rows = await prisma.productBatch.findMany({
    where: { quantity: { gt: 0 } },
    include: { product: { select: { name: true, sku: true } } },
    orderBy: { expiryDate: "asc" },
    take: 500,
  });
  const data = rows.map((r) => ({ product: r.product.name, sku: r.product.sku, batch: r.batchNumber, expiry: r.expiryDate, qty: r.quantity }));
  if (req.query.export === "1") return csvResponse(res, [["Product", "SKU", "Batch", "Expiry", "Qty"], ...data.map((r) => [r.product, r.sku, r.batch, r.expiry?.toISOString().slice(0, 10), r.qty])], "batches");
  res.json(data);
}));

router.get("/inventory/valuation", asyncHandler(async (req, res) => {
  const branchId = req.auth?.branchId || null;
  const rows = await prisma.product.findMany({
    where: { status: "active" },
    include: { inventories: { where: { branchId } }, unit: true },
    orderBy: { name: "asc" },
  });
  const data = rows.map((p) => {
    const stock = p.inventories.reduce((s, i) => s + i.quantity, 0);
    return { name: p.name, sku: p.sku, stock, unit: p.unit?.shortName || "", purchasePrice: p.purchasePrice, sellingPrice: p.sellingPrice, value: round2(stock * p.purchasePrice) };
  });
  const totalValue = data.reduce((s, r) => s + r.value, 0);
  if (req.query.export === "1") {
    return csvResponse(res, [["Product", "SKU", "Stock", "Purchase Price", "Selling Price", "Value"], ...data.map((r) => [r.name, r.sku, r.stock, r.purchasePrice, r.sellingPrice, r.value])], "valuation");
  }
  res.json({ data, totalValue: round2(totalValue) });
}));

// ============ FINANCIAL ============

router.get("/financial/pnl", asyncHandler(async (req, res) => {
  const { from, to } = range(req);
  const [grossSales, refunds, discounts, purchases, expenses] = await Promise.all([
    prisma.$queryRawUnsafe<{ total: number }[]>(
      `SELECT SUM(si.total - si.taxAmount) as total FROM SaleItem si JOIN Sale s ON s.id = si.saleId WHERE s.status = 'completed' AND s.createdAt BETWEEN ? AND ?`, from, to),
    prisma.salesReturn.aggregate({ where: { status: "completed", createdAt: { gte: from, lte: to } }, _sum: { refundAmount: true } }),
    prisma.sale.aggregate({ where: { status: "completed", createdAt: { gte: from, lte: to } }, _sum: { discountAmount: true } }),
    prisma.purchase.aggregate({ where: { status: { not: "cancelled" }, createdAt: { gte: from, lte: to } }, _sum: { total: true } }),
    prisma.expense.aggregate({ where: { date: { gte: from, lte: to } }, _sum: { amount: true } }),
  ]);
  const [cogs] = await prisma.$queryRawUnsafe<{ total: number }[]>(
    `SELECT SUM(si.costPrice * si.quantity) as total FROM SaleItem si JOIN Sale s ON s.id = si.saleId WHERE s.status = 'completed' AND s.createdAt BETWEEN ? AND ?`, from, to);
  const revenue = round2(Number((grossSales as any)[0]?.total || 0) + Number(refunds._sum.refundAmount || 0));
  const grossProfit = round2(revenue - Number((cogs as any)[0]?.total || 0) - Number(discounts._sum.discountAmount || 0));
  const netProfit = round2(grossProfit - Number(expenses._sum.amount || 0));
  res.json({ revenue, refunds: refunds._sum.refundAmount || 0, discounts: discounts._sum.discountAmount || 0, cogs: Number((cogs as any)[0]?.total || 0), grossProfit, expenses: expenses._sum.amount || 0, netProfit });
}));

router.get("/financial/expenses", asyncHandler(async (req, res) => {
  const { from, to } = range(req);
  const rows = await prisma.$queryRawUnsafe<{ name: string; count: number; total: number }[]>(
    `SELECT c.name, COUNT(*) as count, SUM(e.amount) as total FROM Expense e JOIN ExpenseCategory c ON c.id = e.categoryId
     WHERE e.date BETWEEN ? AND ? GROUP BY c.name ORDER BY total DESC`, from, to);
  const total = rows.reduce((s, r) => s + Number(r.total), 0);
  if (req.query.export === "1") return csvResponse(res, [["Category", "Count", "Total"], ...rows.map((r) => [r.name, r.count, r.total])], "expense-report");
  res.json({ data: rows, total });
}));

router.get("/financial/cashflow", asyncHandler(async (req, res) => {
  const { from, to } = range(req);
  const days: string[] = [];
  for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) days.push(d.toISOString().slice(0, 10));
  const [sales, purchases, expenses, refunds] = await Promise.all([
    prisma.$queryRawUnsafe<{ day: string; total: number }[]>(`SELECT strftime('%Y-%m-%d', createdAt) as day, SUM(total) as total FROM Sale WHERE status = 'completed' AND createdAt BETWEEN ? AND ? GROUP BY day`, from, to),
    prisma.$queryRawUnsafe<{ day: string; total: number }[]>(`SELECT strftime('%Y-%m-%d', createdAt) as day, SUM(total) as total FROM Purchase WHERE status != 'cancelled' AND createdAt BETWEEN ? AND ? GROUP BY day`, from, to),
    prisma.$queryRawUnsafe<{ day: string; total: number }[]>(`SELECT strftime('%Y-%m-%d', date) as day, SUM(amount) as total FROM Expense WHERE date BETWEEN ? AND ? GROUP BY day`, from, to),
    prisma.$queryRawUnsafe<{ day: string; total: number }[]>(`SELECT strftime('%Y-%m-%d', createdAt) as day, SUM(refundAmount) as total FROM SalesReturn WHERE status = 'completed' AND createdAt BETWEEN ? AND ? GROUP BY day`, from, to),
  ]);
  const m = (rows: { day: string; total: number }[]) => Object.fromEntries(rows.map((r) => [r.day, Number(r.total)]));
  const [sm, pm, em, rm] = [m(sales), m(purchases), m(expenses), m(refunds)];
  const data = days.map((d) => ({
    day: d,
    inflow: round2((sm[d] || 0)),
    outflow: round2((pm[d] || 0) + (em[d] || 0) + (rm[d] || 0)),
    net: round2((sm[d] || 0) - (pm[d] || 0) - (em[d] || 0) - (rm[d] || 0)),
  }));
  if (req.query.export === "1") return csvResponse(res, [["Date", "Inflow", "Outflow", "Net"], ...data.map((r) => [r.day, r.inflow, r.outflow, r.net])], "cashflow");
  res.json(data);
}));

router.get("/financial/receivables", asyncHandler(async (req, res) => {
  const rows = await prisma.$queryRawUnsafe<{ name: string; phone: string; balance: number }[]>(
    `SELECT c.name, COALESCE(c.phone, '') as phone, t.balanceAfter as balance
     FROM CustomerTransaction t JOIN Customer c ON c.id = t.customerId
     WHERE t.id IN (SELECT MAX(id) FROM CustomerTransaction GROUP BY customerId) AND t.balanceAfter > 0
     ORDER BY balance DESC`);
  const total = rows.reduce((s, r) => s + Number(r.balance), 0);
  if (req.query.export === "1") return csvResponse(res, [["Customer", "Phone", "Outstanding"], ...rows.map((r) => [r.name, r.phone, r.balance])], "receivables");
  res.json({ data: rows, total });
}));

router.get("/financial/payables", asyncHandler(async (req, res) => {
  const rows = await prisma.$queryRawUnsafe<{ name: string; phone: string; balance: number }[]>(
    `SELECT s.name, COALESCE(s.phone, '') as phone, t.balanceAfter as balance
     FROM SupplierTransaction t JOIN Supplier s ON s.id = t.supplierId
     WHERE t.id IN (SELECT MAX(id) FROM SupplierTransaction GROUP BY supplierId) AND t.balanceAfter > 0
     ORDER BY balance DESC`);
  const total = rows.reduce((s, r) => s + Number(r.balance), 0);
  if (req.query.export === "1") return csvResponse(res, [["Supplier", "Phone", "Outstanding"], ...rows.map((r) => [r.name, r.phone, r.balance])], "payables");
  res.json({ data: rows, total });
}));

// ============ RETURNS ============

router.get("/returns/sales", asyncHandler(async (req, res) => {
  const { from, to } = range(req);
  const rows = await prisma.salesReturn.findMany({
    where: { status: "completed", createdAt: { gte: from, lte: to } },
    include: { customer: { select: { name: true } }, sale: { select: { invoiceNo: true } } },
    orderBy: { createdAt: "desc" },
    take: 500,
  });
  const data = rows.map((r) => ({ returnNo: r.returnNo, invoice: r.sale?.invoiceNo || "", customer: r.customer?.name || "", amount: r.refundAmount, date: r.createdAt }));
  const total = data.reduce((s, r) => s + r.amount, 0);
  if (req.query.export === "1") return csvResponse(res, [["Return No", "Invoice", "Customer", "Refund", "Date"], ...data.map((r) => [r.returnNo, r.invoice, r.customer, r.amount, r.date])], "sales-returns");
  res.json({ data, total });
}));

router.get("/returns/purchases", asyncHandler(async (req, res) => {
  const { from, to } = range(req);
  const rows = await prisma.purchaseReturn.findMany({
    where: { status: "completed", createdAt: { gte: from, lte: to } },
    include: { supplier: { select: { name: true } }, purchase: { select: { purchaseNo: true } } },
    orderBy: { createdAt: "desc" },
    take: 500,
  });
  const data = rows.map((r) => ({ returnNo: r.returnNo, purchase: r.purchase?.purchaseNo || "", supplier: r.supplier?.name || "", amount: r.amount, date: r.createdAt }));
  const total = data.reduce((s, r) => s + r.amount, 0);
  if (req.query.export === "1") return csvResponse(res, [["Return No", "Purchase", "Supplier", "Amount", "Date"], ...data.map((r) => [r.returnNo, r.purchase, r.supplier, r.amount, r.date])], "purchase-returns");
  res.json({ data, total });
}));

// ============ GST / TAX ============

router.get("/gst/sales", asyncHandler(async (req, res) => {
  const { from, to } = range(req);
  const rows = await prisma.$queryRawUnsafe<{ day: string; invoiceNo: string; customer: string; taxable: number; tax: number; total: number; rate: number }[]>(
    `SELECT strftime('%Y-%m-%d', s.createdAt) as day, s.invoiceNo, COALESCE(c.name, 'Walk-in') as customer,
      SUM(si.total - si.discountAmount) as taxable, SUM(si.taxAmount) as tax, s.total,
      si.taxRate as rate
     FROM SaleItem si JOIN Sale s ON s.id = si.saleId LEFT JOIN Customer c ON c.id = s.customerId
     WHERE s.status = 'completed' AND s.createdAt BETWEEN ? AND ? GROUP BY day, s.invoiceNo, customer, s.total, rate
     ORDER BY day DESC`, from, to);
  if (req.query.export === "1") {
    return csvResponse(res, [["Date", "Invoice", "Customer", "Taxable", "Tax", "Total", "Rate %"], ...rows.map((r) => [r.day, r.invoiceNo, r.customer, r.taxable, r.tax, r.total, r.rate])], "gst-sales");
  }
  res.json(rows);
}));

router.get("/gst/purchases", asyncHandler(async (req, res) => {
  const { from, to } = range(req);
  const rows = await prisma.$queryRawUnsafe<{ day: string; purchaseNo: string; supplier: string; taxable: number; tax: number; total: number; rate: number }[]>(
    `SELECT strftime('%Y-%m-%d', pu.createdAt) as day, pu.purchaseNo, s.name as supplier,
      SUM(pi.total - pi.discountAmount) as taxable, SUM(pi.taxAmount) as tax, pu.total, pi.taxRate as rate
     FROM PurchaseItem pi JOIN Purchase pu ON pu.id = pi.purchaseId JOIN Supplier s ON s.id = pu.supplierId
     WHERE pu.status != 'cancelled' AND pu.createdAt BETWEEN ? AND ? GROUP BY day, pu.purchaseNo, supplier, pu.total, rate
     ORDER BY day DESC`, from, to);
  if (req.query.export === "1") {
    return csvResponse(res, [["Date", "Purchase", "Supplier", "Taxable", "Tax", "Total", "Rate %"], ...rows.map((r) => [r.day, r.purchaseNo, r.supplier, r.taxable, r.tax, r.total, r.rate])], "gst-purchases");
  }
  res.json(rows);
}));

router.get("/gst/summary", asyncHandler(async (req, res) => {
  const { from, to } = range(req);
  const [salesTax, purchaseTax] = await Promise.all([
    prisma.$queryRawUnsafe<{ rate: number; taxable: number; tax: number }[]>(
      `SELECT si.taxRate as rate, SUM(si.total - si.discountAmount) as taxable, SUM(si.taxAmount) as tax
       FROM SaleItem si JOIN Sale s ON s.id = si.saleId WHERE s.status = 'completed' AND s.createdAt BETWEEN ? AND ? GROUP BY rate ORDER BY rate`, from, to),
    prisma.$queryRawUnsafe<{ rate: number; taxable: number; tax: number }[]>(
      `SELECT pi.taxRate as rate, SUM(pi.total - pi.discountAmount) as taxable, SUM(pi.taxAmount) as tax
       FROM PurchaseItem pi JOIN Purchase pu ON pu.id = pi.purchaseId WHERE pu.status != 'cancelled' AND pu.createdAt BETWEEN ? AND ? GROUP BY rate ORDER BY rate`, from, to),
  ]);
  res.json({
    output: salesTax.map((r) => ({ rate: r.rate, taxable: Number(r.taxable), cgst: Number(r.tax) / 2, sgst: Number(r.tax) / 2, igst: Number(r.tax), total: Number(r.tax) })),
    input: purchaseTax.map((r) => ({ rate: r.rate, taxable: Number(r.taxable), cgst: Number(r.tax) / 2, sgst: Number(r.tax) / 2, igst: Number(r.tax), total: Number(r.tax) })),
    outputTax: salesTax.reduce((s, r) => s + Number(r.tax), 0),
    inputTax: purchaseTax.reduce((s, r) => s + Number(r.tax), 0),
    netPayable: round2(salesTax.reduce((s, r) => s + Number(r.tax), 0) - purchaseTax.reduce((s, r) => s + Number(r.tax), 0)),
  });
}));

export default router;