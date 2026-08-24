import { useCallback, useEffect, useState } from "react";
import { get, post } from "../api";
import { money, dateFmt, todayInput } from "../format";
import { Button, Card, Input, Modal, Pagination, Select, Spinner, Table, Td, ErrorMsg, statusBadge } from "../ui";

export default function Purchases() {
  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [creating, setCreating] = useState(false);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [form, setForm] = useState<any>({ supplierId: "", invoiceNumber: "", invoiceDate: todayInput(), note: "", status: "received" });
  const [items, setItems] = useState<any[]>([{ productId: "", quantity: 1, purchasePrice: 0 }]);
  const pageSize = 20;

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    get(`/purchases?page=${page}&pageSize=${pageSize}${search ? `&search=${encodeURIComponent(search)}` : ""}`)
      .then((r) => {
        setRows(r.data || []);
        setTotal(r.total ?? 0);
      })
      .catch(setError)
      .finally(() => setLoading(false));
  }, [page, search]);

  useEffect(load, [load]);

  async function openCreate() {
    setForm({ supplierId: "", invoiceNumber: "", invoiceDate: todayInput(), note: "", status: "received" });
    setItems([{ productId: "", quantity: 1, purchasePrice: 0 }]);
    try {
      const [s, p] = await Promise.all([get("/suppliers?pageSize=200"), get("/products?pageSize=200&status=active")]);
      setSuppliers(s.data || []);
      setProducts(p.data || []);
      setCreating(true);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to load data");
    }
  }

  function setItem(i: number, patch: any) {
    setItems(items.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  }

  function pickProduct(i: number, productId: string) {
    const p = products.find((x) => x.id === productId);
    setItem(i, { productId, purchasePrice: p?.purchasePrice ?? 0 });
  }

  const grandTotal = items.reduce((s, it) => s + (Number(it.quantity) || 0) * (Number(it.purchasePrice) || 0), 0);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.supplierId) return alert("Select a supplier");
    const clean = items.filter((i) => i.productId && Number(i.quantity) > 0).map((i) => ({ ...i, quantity: Number(i.quantity), purchasePrice: Number(i.purchasePrice), discountAmount: 0, taxRate: 0 }));
    if (!clean.length) return alert("Add at least one item with a product and quantity");
    try {
      await post("/purchases", {
        supplierId: form.supplierId,
        invoiceNumber: form.invoiceNumber || null,
        invoiceDate: form.invoiceDate || null,
        note: form.note || null,
        status: form.status,
        items: clean,
        discountAmount: 0,
        payments: [],
      });
      setCreating(false);
      load();
    } catch (e2) {
      alert(e2 instanceof Error ? e2.message : "Create failed");
    }
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-bold">Purchases</h1>
        <Button onClick={openCreate}>+ New Purchase</Button>
      </div>

      <Input
        placeholder="Search supplier / invoice…"
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
          setPage(1);
        }}
        className="mb-3 w-64"
      />

      {error && <ErrorMsg error={error} />}
      {loading ? (
        <Spinner />
      ) : (
        <>
          <Table head={["Invoice", "Supplier", "Date", "Status", "Total"]}>
            {rows.map((p) => (
              <tr key={p.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                <Td className="font-medium">{p.invoiceNumber || p.purchaseNo}</Td>
                <Td>{p.supplier?.name || "-"}</Td>
                <Td>{dateFmt(p.createdAt)}</Td>
                <Td>{statusBadge(p.status)}</Td>
                <Td className="font-semibold">{money(p.total)}</Td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <Td colSpan={5} className="py-10 text-center text-slate-400">
                  No purchases found
                </Td>
              </tr>
            )}
          </Table>
          <Pagination page={page} pageSize={pageSize} total={total} onPage={setPage} />
        </>
      )}

      <Modal open={creating} onClose={() => setCreating(false)} title="New Purchase" wide>
        <form onSubmit={submit}>
          <div className="grid grid-cols-2 gap-4">
            <Select
              label="Supplier *"
              value={form.supplierId}
              onChange={(e) => setForm({ ...form, supplierId: e.target.value })}
              options={[{ value: "", label: "— Select —" }, ...suppliers.map((s) => ({ value: s.id, label: s.name }))]}
            />
            <Input label="Invoice number" value={form.invoiceNumber} onChange={(e) => setForm({ ...form, invoiceNumber: e.target.value })} />
            <Input label="Invoice date" type="date" value={form.invoiceDate} onChange={(e) => setForm({ ...form, invoiceDate: e.target.value })} />
            <Select
              label="Status"
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value })}
              options={[
                { value: "received", label: "Received (updates stock)" },
                { value: "pending", label: "Pending" },
                { value: "draft", label: "Draft" },
              ]}
            />
          </div>

          <h4 className="mb-2 mt-4 font-semibold">Items</h4>
          <div className="space-y-2">
            {items.map((it, i) => (
              <div key={i} className="flex items-center gap-2">
                <select value={it.productId} onChange={(e) => pickProduct(i, e.target.value)} className="flex-1 rounded-lg border border-slate-300 px-2 py-1.5 text-sm">
                  <option value="">— Product —</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  min={1}
                  value={it.quantity}
                  onChange={(e) => setItem(i, { quantity: e.target.value })}
                  placeholder="Qty"
                  className="w-20 rounded-lg border border-slate-300 px-2 py-1.5 text-sm text-right"
                />
                <input
                  type="number"
                  step="0.01"
                  value={it.purchasePrice}
                  onChange={(e) => setItem(i, { purchasePrice: e.target.value })}
                  placeholder="Cost"
                  className="w-24 rounded-lg border border-slate-300 px-2 py-1.5 text-sm text-right"
                />
                <button type="button" onClick={() => setItems(items.filter((_, idx) => idx !== i))} className="px-1 text-red-400 hover:text-red-600">
                  ✕
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setItems([...items, { productId: "", quantity: 1, purchasePrice: 0 }])}
            className="mt-2 text-sm font-medium text-blue-600 hover:underline"
          >
            + Add item row
          </button>

          <div className="mt-4 flex items-center justify-between border-t border-dashed pt-3">
            <span className="text-sm text-slate-600">Grand total</span>
            <span className="text-lg font-bold">{money(grandTotal)}</span>
          </div>

          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setCreating(false)}>
              Cancel
            </Button>
            <Button type="submit">Save Purchase</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
