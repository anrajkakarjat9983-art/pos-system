const BASE = process.env.SMOKE_URL || "http://localhost:4000";
const EMAIL = process.env.SMOKE_EMAIL || "admin@pos.com";
const PASSWORD = process.env.SMOKE_PASSWORD || "password123";

let token = "";
let passed = 0;
let failed = 0;

async function req(method: string, url: string, body?: unknown) {
  const res = await fetch(`${BASE}${url}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, json, text };
}

async function check(name: string, method: string, url: string, body?: unknown, expect = 200) {
  try {
    const r = await req(method, url, body);
    const ok = r.status === expect;
    if (ok) passed++;
    else failed++;
    const detail = ok ? "" : ` -> ${r.status} ${String(r.text).slice(0, 200)}`;
    console.log(`${ok ? "PASS" : "FAIL"} ${method} ${url}${detail}`);
    return r;
  } catch (e: any) {
    failed++;
    console.log(`FAIL ${method} ${url} -> ${e.message}`);
    return null;
  }
}

async function main() {
  console.log(`Smoke testing ${BASE}`);

  await check("health", "GET", "/api/health");

  const login = await check("login", "POST", "/api/auth/login", { email: EMAIL, password: PASSWORD });
  if (!login?.json?.token) {
    console.log("Cannot proceed without token. Aborting.");
    process.exit(1);
  }
  token = login.json.token;

  await check("me", "GET", "/api/auth/me");
  await check("dashboard stats", "GET", "/api/dashboard/stats");
  await check("dashboard chart sales-purchases", "GET", "/api/dashboard/chart/sales-purchases?days=7");
  await check("dashboard chart top-products", "GET", "/api/dashboard/chart/top-products?days=30");
  await check("products list", "GET", "/api/products?page=1&limit=10");
  await check("products lowStock", "GET", "/api/products?lowStock=1");
  await check("products outOfStock", "GET", "/api/products?outOfStock=1");
  await check("products search", "GET", "/api/products?search=a&page=1&limit=5");
  await check("catalog categories", "GET", "/api/catalog/categories");
  await check("catalog brands", "GET", "/api/catalog/brands");
  await check("catalog units", "GET", "/api/catalog/units");
  await check("catalog taxRates", "GET", "/api/catalog/tax-rates");
  await check("customers", "GET", "/api/customers?page=1&limit=5");
  await check("suppliers", "GET", "/api/suppliers?page=1&limit=5");
  await check("pos products", "GET", "/api/pos/products?search=");
  await check("sales list", "GET", "/api/sales?page=1&limit=5");
  await check("purchases list", "GET", "/api/purchases?page=1&limit=5");
  await check("returns list", "GET", "/api/returns/sales?page=1&limit=5");
  await check("inventory stock", "GET", "/api/inventory/stock?page=1&limit=5");
  await check("inventory low", "GET", "/api/inventory/stock?low=1");
  await check("expenses", "GET", "/api/expenses?page=1&limit=5");
  await check("cash my-open", "GET", "/api/cash/my-open");
  await check("shift my-open", "GET", "/api/shifts/my-open");
  await check("reports sales daily", "GET", "/api/reports/sales/daily?days=7");
  await check("reports top-products", "GET", "/api/reports/sales/products?days=30");
  await check("reports profit-loss", "GET", "/api/reports/financial/pnl?from=2026-01-01&to=2026-12-31");
  await check("reports low-stock csv", "GET", "/api/reports/inventory/low-stock?export=1");
  await check("settings get", "GET", "/api/settings/");
  await check("notifications", "GET", "/api/notifications");
  await check("coupons", "GET", "/api/marketing/coupons?page=1&limit=5");
  await check("users", "GET", "/api/users?page=1&limit=5");
  await check("roles", "GET", "/api/roles");
  await check("branches", "GET", "/api/branches");
  await check("employees", "GET", "/api/employees?page=1&limit=5");
  await check("audit logs", "GET", "/api/audit-logs?page=1&limit=5");

  // POS sale flow: pick two products and complete a sale
  const posProducts = await req("GET", "/api/pos/products");
  if (posProducts.json && Array.isArray(posProducts.json)) {
    const itemsSource: any[] = posProducts.json;
    if (itemsSource.length >= 2) {
      const p1 = itemsSource[0];
      const p2 = itemsSource[1];
      const complete = await check("pos complete sale", "POST", "/api/pos/complete", {
        customerId: null,
        items: [
          { productId: p1.id, quantity: 1 },
          { productId: p2.id, quantity: 2 },
        ],
        payments: [{ method: "cash", amount: 100000 }],
      }, 201);
      if (complete?.json?.saleId) {
        await check("get created sale", "GET", `/api/sales/${complete.json.saleId}`);
        await check("hold sale", "POST", "/api/pos/hold", {
          customerId: null,
          items: [{ productId: p1.id, quantity: 1 }],
          note: "smoke hold",
        }, 201);
        const saleDetail = await req("GET", `/api/sales/${complete.json.saleId}`);
        const firstItem = saleDetail.json?.items?.[0];
        if (firstItem) {
          await check(
            "create return",
            "POST",
            "/api/returns/sales",
            {
              saleId: complete.json.saleId,
              items: [{ saleItemId: firstItem.id, quantity: 1, reason: "smoke test" }],
              refundMethod: "cash",
              restocked: true,
            },
            201
          );
        }
      }
    } else {
      failed++;
      console.log("FAIL pos complete sale -> not enough products returned by /api/pos/products");
    }
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
