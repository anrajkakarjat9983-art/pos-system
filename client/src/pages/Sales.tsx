import { useCallback, useEffect, useState } from "react";
import { get, post, downloadCsv } from "../api";
import { money, dateTimeFmt } from "../format";
import { Button, Card, Input, Modal, Pagination, Spinner, Table, Td, ErrorMsg, statusBadge } from "../ui";

export default function Sales() {
  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [paymentStatus, setPaymentStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [detail, setDetail] = useState<any>(null);
  const [returning, setReturning] = useState(false);
  const [returnQty, setReturnQty] = useState<Record<string, number>>({});
  const pageSize = 20;

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    const q = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
      ...(search ? { search } : {}),
      ...(status ? { status } : {}),
      ...(paymentStatus ? { paymentStatus } : {}),
    });
    get(`/sales?${q}`)
      .then((r) => {
        setRows(r.data || []);
        setTotal(r.total ?? 0);
      })
      .catch(setError)
      .finally(() => setLoading(false));
  }, [page, search, status, paymentStatus]);

  useEffect(load, [load]);

  async function openDetail(id: string) {
    try {
      const d = await get(`/sales/${id}`);
      setDetail(d);
      setReturnQty({});
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to load sale");
    }
  }

  async function submitReturn() {
    if (!detail) return;
    const items = (detail.items || [])
      .map((it: any) => ({ saleItemId: it.id, quantity: Number(returnQty[it.id] || 0), reason: "Customer return" }))
      .filter((i: any) => i.quantity > 0);
    if (!items.length) return alert("Enter quantity to return on at least one item");
    try {
      const r = await post("/returns/sales", { saleId: detail.id, items, refundMethod: "cash", restocked: true });
      alert(`Return created (${r.returnNo}). Refund: ${money(r.refundAmount)}`);
      setReturning(false);
      openDetail(detail.id);
      load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Return failed");
    }
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold">Sales</h1>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={() => downloadCsv("/reports/sales/daily?days=30", `sales-${Date.now()}.csv`)}>
            Daily summary CSV
          </Button>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap gap-2">
        <Input
          placeholder="Invoice no / customer…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          className="w-64"
        />
        <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
          <option value="">All statuses</option>
          <option value="completed">Completed</option>
          <option value="held">Held</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <select
          value={paymentStatus}
          onChange={(e) => {
            setPaymentStatus(e.target.value);
            setPage(1);
          }}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
        >
          <option value="">All payments</option>
          <option value="paid">Paid</option>
          <option value="partial">Partial</option>
          <option value="unpaid">Unpaid</option>
        </select>
      </div>

      {error && <ErrorMsg error={error} />}
      {loading ? (
        <Spinner />
      ) : (
        <>
          <Table head={["Invoice", "Date", "Customer", "Items", "Total", "Paid", "Balance", "Payment", "Status", ""]}>
            {rows.map((s) => (
              <tr key={s.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                <Td className="font-medium">{s.invoiceNo}</Td>
                <Td>{dateTimeFmt(s.createdAt)}</Td>
                <Td>{s.customer?.name || "Walk-in"}</Td>
                <Td>{s._count?.items ?? s.items?.length ?? "-"}</Td>
                <Td className="font-semibold">{money(s.total)}</Td>
                <Td>{money(s.paidAmount)}</Td>
                <Td className={s.balance > 0 ? "text-red-600" : ""}>{money(s.balance)}</Td>
                <Td>{statusBadge(s.paymentStatus)}</Td>
                <Td>{statusBadge(s.status)}</Td>
                <Td>
                  <Button size="sm" variant="ghost" onClick={() => openDetail(s.id)}>
                    View
                  </Button>
                </Td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <Td className="py-10 text-center text-slate-400">No sales found</Td>
              </tr>
            )}
          </Table>
          <Pagination page={page} pageSize={pageSize} total={total} onPage={setPage} />
        </>
      )}

      <Modal open={!!detail && !returning} onClose={() => setDetail(null)} title={`Sale ${detail?.invoiceNo || ""}`} wide>
        {detail && (
          <div>
            <div className="mb-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
              <div>
                <div className="text-xs text-slate-500">Customer</div>
                <div className="font-medium">{detail.customer?.name || "Walk-in"}</div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Date</div>
                <div className="font-medium">{dateTimeFmt(detail.createdAt)}</div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Cashier</div>
                <div className="font-medium">{detail.user?.name || "-"}</div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Status</div>
                <div>{statusBadge(detail.status)} {statusBadge(detail.paymentStatus)}</div>
              </div>
            </div>
            <Table head={["Item", "Qty", "Price", "Disc", "Tax", "Total"]}>
              {(detail.items || []).map((it: any) => (
                <tr key={it.id} className="border-b border-slate-100 last:border-0">
                  <Td>{it.product?.name || it.note || "Item"}</Td>
                  <Td>{it.quantity}</Td>
                  <Td>{money(it.price)}</Td>
                  <Td>{money(it.discountAmount)}</Td>
                  <Td>{money(it.taxAmount)}</Td>
                  <Td className="font-semibold">{money(it.total)}</Td>
                </tr>
              ))}
            </Table>
            <div className="mt-3 space-y-1 text-right text-sm">
              <div>Subtotal: {money(detail.subtotal)}</div>
              <div>Discount: -{money(detail.discountAmount)}</div>
              <div>Tax: {money(detail.taxAmount)}</div>
              <div className="text-lg font-bold">Total: {money(detail.total)}</div>
              <div>Paid: {money(detail.paidAmount)} · Balance: {money(detail.balance)}</div>
            </div>
            {(detail.payments || []).length > 0 && (
              <div className="mt-2 text-xs text-slate-500">
                Payments: {(detail.payments || []).map((p: any) => `${p.method} ${money(p.amount)}`).join(" · ")}
              </div>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => window.print()}>
                Print
              </Button>
              <Button variant="danger" onClick={() => setReturning(true)}>
                Create Return
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={!!detail && returning} onClose={() => setReturning(false)} title={`Return items — ${detail?.invoiceNo || ""}`}>
        {detail && (
          <div>
            <Table head={["Item", "Sold", "Return qty"]}>
              {(detail.items || []).map((it: any) => (
                <tr key={it.id} className="border-b border-slate-100 last:border-0">
                  <Td>{it.product?.name || "Item"}</Td>
                  <Td>{it.quantity}</Td>
                  <Td>
                    <input
                      type="number"
                      min={0}
                      max={it.quantity - (it.returnedQty || 0)}
                      value={returnQty[it.id] ?? ""}
                      onChange={(e) => setReturnQty({ ...returnQty, [it.id]: Number(e.target.value) })}
                      className="w-20 rounded border border-slate-300 px-2 py-1 text-sm"
                    />
                  </Td>
                </tr>
              ))}
            </Table>
            <p className="mt-2 text-xs text-slate-500">Refund is issued as cash; returned items are restocked automatically.</p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setReturning(false)}>
                Cancel
              </Button>
              <Button variant="danger" onClick={submitReturn}>
                Confirm Return
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
