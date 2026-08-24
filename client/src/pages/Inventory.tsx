import { useState } from "react";
import { get, downloadCsv } from "../api";
import { money, num } from "../format";
import { Card, Spinner, ErrorMsg, Badge, Button } from "../ui";

export default function Inventory() {
  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"" | "low" | "out">("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const pageSize = 20;

  function load(p = page, f = filter, s = search) {
    setLoading(true);
    setError(null);
    const q = new URLSearchParams({ page: String(p), pageSize: String(pageSize), ...(s ? { search: s } : {}), ...(f ? { [f]: "1" } : {}) });
    get(`/inventory/stock?${q}`)
      .then((r) => {
        setRows(r.data || []);
        setTotal(r.total ?? 0);
      })
      .catch(setError)
      .finally(() => setLoading(false));
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold">Inventory / Stock</h1>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={() => downloadCsv("/reports/inventory/valuation", `stock-${Date.now()}.csv`)}>
            Export CSV
          </Button>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap gap-2">
        <input
          placeholder="Search product…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            load(1, filter, e.target.value);
          }}
          className="w-64 rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
        {[
          { k: "", label: "All" },
          { k: "low", label: "Low stock" },
          { k: "out", label: "Out of stock" },
        ].map((t) => (
          <button
            key={t.k}
            onClick={() => {
              setFilter(t.k as any);
              setPage(1);
              load(1, t.k as any, search);
            }}
            className={`rounded-lg px-3 py-2 text-sm ${filter === t.k ? "bg-blue-600 text-white" : "bg-white border border-slate-300 hover:bg-slate-50"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && <ErrorMsg error={error} />}
      {loading ? (
        <Spinner />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-slate-50 text-left text-xs uppercase text-slate-500">
                <th className="px-4 py-2.5">Product</th>
                <th className="px-4 py-2.5">SKU</th>
                <th className="px-4 py-2.5">Category</th>
                <th className="px-4 py-2.5 text-right">Stock</th>
                <th className="px-4 py-2.5 text-right">Min</th>
                <th className="px-4 py-2.5 text-right">Cost</th>
                <th className="px-4 py-2.5 text-right">Price</th>
                <th className="px-4 py-2.5">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const out = r.stock <= 0;
                const low = !out && r.stock <= r.minStock;
                return (
                  <tr key={r.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                    <td className="px-4 py-2.5 font-medium">{r.name}</td>
                    <td className="px-4 py-2.5 text-slate-500">{r.sku}</td>
                    <td className="px-4 py-2.5">{r.category || "-"}</td>
                    <td className={`px-4 py-2.5 text-right font-semibold ${out ? "text-red-600" : low ? "text-amber-600" : ""}`}>{num(r.stock)} {r.unit}</td>
                    <td className="px-4 py-2.5 text-right text-slate-500">{num(r.minStock)}</td>
                    <td className="px-4 py-2.5 text-right">{money(r.purchasePrice)}</td>
                    <td className="px-4 py-2.5 text-right">{money(r.sellingPrice)}</td>
                    <td className="px-4 py-2.5">
                      {out ? <Badge color="red">Out of stock</Badge> : low ? <Badge color="amber">Low</Badge> : <Badge color="green">In stock</Badge>}
                    </td>
                  </tr>
                );
              })}
              {!rows.length && (
                <tr>
                  <td colSpan={8} className="py-10 text-center text-slate-400">
                    No products found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>
      )}

      <div className="mt-3 flex items-center justify-between text-sm text-slate-600">
        <span>{total} products · page {page} of {Math.max(1, Math.ceil(total / pageSize))}</span>
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => { setPage(page - 1); load(page - 1); }}>
            Previous
          </Button>
          <Button size="sm" variant="secondary" disabled={page >= Math.ceil(total / pageSize)} onClick={() => { setPage(page + 1); load(page + 1); }}>
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}
