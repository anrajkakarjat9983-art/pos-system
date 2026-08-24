import { useEffect, useState } from "react";
import { get } from "../api";
import { money, num } from "../format";
import { StatCard, Spinner, ErrorMsg, Card } from "../ui";
import { LineChart, HBars } from "../charts";

export default function Dashboard() {
  const [stats, setStats] = useState<any>(null);
  const [chart, setChart] = useState<any>(null);
  const [topProducts, setTopProducts] = useState<any[]>([]);
  const [payments, setPayments] = useState<any[]>([]);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    Promise.all([
      get("/dashboard/stats?period=today"),
      get("/dashboard/chart/sales-purchases?days=14"),
      get("/dashboard/chart/top-products?days=30"),
      get("/dashboard/chart/payments?days=30"),
    ])
      .then(([s, c, t, p]) => {
        setStats(s);
        setChart(c);
        setTopProducts(t || []);
        setPayments(p || []);
      })
      .catch(setError);
  }, []);

  if (error) return <ErrorMsg error={error} />;
  if (!stats) return <Spinner />;

  return (
    <div>
      <h1 className="mb-1 text-xl font-bold">Dashboard</h1>
      <p className="mb-5 text-sm text-slate-500">Today at a glance</p>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard title="Sales Today" value={money(stats.sales)} accent="green" sub={`Tax ${money(stats.salesTax)}`} />
        <StatCard title="Purchases" value={money(stats.purchases)} accent="blue" />
        <StatCard title="Gross Profit*" value={money(stats.profit)} accent="amber" />
        <StatCard title="Expenses" value={money(stats.expenses)} accent="red" />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard title="Cash in Hand" value={money(stats.cashBalance)} accent="slate" />
        <StatCard title="Receivables" value={money(stats.pendingCustomerPayments)} accent="red" />
        <StatCard title="Payables" value={money(stats.pendingSupplierPayments)} accent="amber" />
        <StatCard title="Stock Alerts" value={`${num(stats.lowStock)} low · ${num(stats.outStock)} out`} accent="blue" />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <Card className="p-4 lg:col-span-2">
          <h3 className="mb-3 font-semibold">Sales vs Purchases (14 days)</h3>
          {chart && (
            <LineChart
              labels={chart.labels}
              series={[
                { name: "Sales", color: "#2563eb", values: chart.sales },
                { name: "Purchases", color: "#f59e0b", values: chart.purchases },
              ]}
            />
          )}
        </Card>
        <Card className="p-4">
          <h3 className="mb-3 font-semibold">Top Products (30d)</h3>
          <HBars rows={(topProducts || []).map((r) => ({ label: `${r.name} ×${r.qty}`, value: Number(r.total) }))} />
        </Card>
      </div>

      <div className="mt-4">
        <Card className="p-4">
          <h3 className="mb-3 font-semibold">Payments by Method (30d)</h3>
          <HBars rows={(payments || []).map((r) => ({ label: r.method, value: Number(r.total) }))} />
        </Card>
      </div>

      <p className="mt-4 text-xs text-slate-400">*Gross profit excludes refunds and bill-level discounts.</p>
    </div>
  );
}
