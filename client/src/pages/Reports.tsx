import { useEffect, useState } from "react";
import { get, downloadCsv } from "../api";
import { money, num, todayInput } from "../format";
import { Button, Card, Input, Spinner, Table, Td, ErrorMsg } from "../ui";

type ReportKey = "daily" | "top" | "pnl" | "low" | "out" | "gst";

const TABS: { key: ReportKey; label: string }[] = [
  { key: "daily", label: "Daily Sales" },
  { key: "top", label: "Top Products" },
  { key: "pnl", label: "Profit & Loss" },
  { key: "low", label: "Low Stock" },
  { key: "out", label: "Out of Stock" },
  { key: "gst", label: "GST Summary" },
];

export default function Reports() {
  const [tab, setTab] = useState<ReportKey>("daily");
  const [from, setFrom] = useState(() => new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10));
  const [to, setTo] = useState(todayInput());
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);

  function load() {
    setLoading(true);
    setError(null);
    setData(null);
    const range = `from=${from}&to=${to}`;
    const reqs: Record<ReportKey, Promise<any>> = {
      daily: get(`/reports/sales/daily?${range}`),
      top: get(`/reports/sales/products?${range}`),
      pnl: get(`/reports/financial/pnl?${range}`),
      low: get("/reports/inventory/low-stock"),
      out: get("/reports/inventory/out-of-stock"),
      gst: get(`/reports/gst/summary?${range}`),
    };
    reqs[tab]
      .then(setData)
      .catch(setError)
      .finally(() => setLoading(false));
  }

  useEffect(load, [tab]);

  return (
    <div>
      <h1 className="mb-4 text-xl font-bold">Reports</h1>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-lg px-3.5 py-2 text-sm ${tab === t.key ? "bg-blue-600 text-white" : "border border-slate-300 bg-white hover:bg-slate-50"}`}
          >
            {t.label}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2">
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          <Button onClick={load}>Apply</Button>
        </div>
      </div>

      {error && <ErrorMsg error={error} />}
      {loading ? (
        <Spinner />
      ) : (
        <Card className="p-4">
          {tab === "daily" &&
            (Array.isArray(data) ? (
              <>
                <ExportBtn path={`/reports/sales/daily?from=${from}&to=${to}&export=1`} />
                <Table head={["Date", "Invoices", "Tax", "Discount", "Total"]}>
                  {data.map((r: any, i: number) => (
                    <tr key={i} className="border-b border-slate-100 last:border-0">
                      <Td>{r.day?.slice(0, 10)}</Td>
                      <Td>{num(r.count)}</Td>
                      <Td>{money(r.tax)}</Td>
                      <Td>{money(r.discount)}</Td>
                      <Td className="font-semibold">{money(r.total)}</Td>
                    </tr>
                  ))}
                </Table>
              </>
            ) : (
              <Empty />
            ))}

          {tab === "top" &&
            (Array.isArray(data) && data.length ? (
              <>
                <ExportBtn path={`/reports/sales/products?from=${from}&to=${to}&export=1`} />
                <Table head={["#", "Product", "SKU", "Qty sold", "Revenue", "Profit"]}>
                  {data.map((r: any, i: number) => (
                    <tr key={i} className="border-b border-slate-100 last:border-0">
                      <Td>{i + 1}</Td>
                      <Td className="font-medium">{r.name}</Td>
                      <Td>{r.sku}</Td>
                      <Td>{num(r.qty)}</Td>
                      <Td>{money(r.total)}</Td>
                      <Td className="text-emerald-700">{money(r.profit)}</Td>
                    </tr>
                  ))}
                </Table>
              </>
            ) : (
              <Empty />
            ))}

          {tab === "pnl" && data && !Array.isArray(data) && (
            <div className="mx-auto max-w-md space-y-2 py-4 text-sm">
              {[
                ["Revenue", data.revenue],
                ["Refunds", -(data.refunds || 0)],
                ["Discounts given", -(data.discounts || 0)],
                ["Cost of goods sold", -(data.cogs || 0)],
              ].map(([l, v]) => (
                <Row key={String(l)} label={String(l)} value={money(Number(v))} />
              ))}
              <div className="border-t pt-2">
                <Row label="Gross profit" value={money(data.grossProfit)} bold />
              </div>
              <Row label="Expenses" value={`-${money(data.expenses)}`} />
              <div className="border-t pt-2">
                <Row label="Net profit" value={money(data.netProfit)} bold big />
              </div>
            </div>
          )}

          {tab === "low" &&
            (Array.isArray(data) ? (
              <>
                <ExportBtn path="/reports/inventory/low-stock?export=1" />
                <Table head={["Product", "SKU", "Stock", "Min stock"]}>
                  {data.map((r: any, i: number) => (
                    <tr key={i} className="border-b border-slate-100 last:border-0">
                      <Td className="font-medium">{r.name}</Td>
                      <Td>{r.sku}</Td>
                      <Td className="text-amber-600">{num(r.stock)}</Td>
                      <Td>{num(r.minStock)}</Td>
                    </tr>
                  ))}
                </Table>
              </>
            ) : (
              <Empty />
            ))}

          {tab === "out" &&
            (Array.isArray(data) ? (
              <>
                <ExportBtn path="/reports/inventory/out-of-stock?export=1" />
                <Table head={["Product", "SKU", "Stock"]}>
                  {data.map((r: any, i: number) => (
                    <tr key={i} className="border-b border-slate-100 last:border-0">
                      <Td className="font-medium">{r.name}</Td>
                      <Td>{r.sku}</Td>
                      <Td className="text-red-600">{num(r.stock)}</Td>
                    </tr>
                  ))}
                </Table>
              </>
            ) : (
              <Empty />
            ))}

          {tab === "gst" &&
            (Array.isArray(data) && data.length ? (
              <>
                <ExportBtn path={`/reports/gst/summary?from=${from}&to=${to}&export=1`} />
                <Table head={["Rate", "Taxable", "Tax"]}>
                  {data.map((r: any, i: number) => (
                    <tr key={i} className="border-b border-slate-100 last:border-0">
                      <Td>{r.rate ?? r.taxRate ?? 0}%</Td>
                      <Td>{money(r.taxable)}</Td>
                      <Td>{money(r.tax)}</Td>
                    </tr>
                  ))}
                </Table>
              </>
            ) : (
              <Empty />
            ))}
        </Card>
      )}
    </div>
  );
}

function Row({ label, value, bold, big }: { label: string; value: string; bold?: boolean; big?: boolean }) {
  return (
    <div className={`flex justify-between ${big ? "text-lg" : ""} ${bold ? "font-bold" : ""}`}>
      <span className="text-slate-600">{label}</span>
      <span>{value}</span>
    </div>
  );
}

function ExportBtn({ path }: { path: string }) {
  return (
    <div className="mb-3 text-right">
      <Button size="sm" variant="secondary" onClick={() => downloadCsv(path, `report-${Date.now()}.csv`)}>
        Download CSV
      </Button>
    </div>
  );
}

function Empty() {
  return <div className="py-12 text-center text-sm text-slate-400">No data for this period</div>;
}
