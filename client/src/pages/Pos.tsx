import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { get, post } from "../api";
import { money } from "../format";
import { Button, Card, Input, Modal, Spinner, ErrorMsg, statusBadge } from "../ui";
import { useAuth } from "../store";

interface CartLine {
  productId: string;
  name: string;
  price: number;
  quantity: number;
  taxRate: number;
  maxStock: number;
}

export default function Pos() {
  const { user } = useAuth();
  const [ready, setReady] = useState(false);
  const [gate, setGate] = useState<null | "shift" | "cash" | "both">(null);
  const [openingCash, setOpeningCash] = useState("");
  const [products, setProducts] = useState<any[]>([]);
  const [totalProducts, setTotalProducts] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [categories, setCategories] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [discountInput, setDiscountInput] = useState("");
  const [discountIsPercent, setDiscountIsPercent] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [paidInput, setPaidInput] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<any>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    Promise.all([get("/shifts/my-open").catch(() => null), get("/cash/my-open").catch(() => null), get("/catalog/categories").catch(() => []), get("/customers?pageSize=100").catch(() => null)])
      .then(([shift, cashReg, cats, custs]) => {
        const hasShift = !!(shift as any)?.shift;
        const hasCash = !!(cashReg as any)?.register || !!(cashReg as any)?.data;
        if (!hasShift && !hasCash) setGate("both");
        else if (!hasShift) setGate("shift");
        else if (!hasCash) setGate("cash");
        setCategories((cats as any) || []);
        const cd = (custs as any)?.data || [];
        setCustomers(cd);
      })
      .finally(() => setReady(true));
  }, []);

  const loadProducts = useCallback(async () => {
    setError(null);
    try {
      const q = new URLSearchParams({ page: String(page), pageSize: "24", ...(search ? { search } : {}), ...(categoryId ? { categoryId } : {}) });
      const r = await get(`/pos/products?${q}`);
      setProducts(r.data || []);
      setTotalProducts(r.total ?? 0);
    } catch (e) {
      setError(e);
    }
  }, [page, search, categoryId]);

  useEffect(() => {
    if (ready && !gate) loadProducts();
  }, [ready, gate, loadProducts]);

  function addToCart(p: any) {
    setCart((prev) => {
      const found = prev.find((l) => l.productId === p.id);
      if (found) return prev.map((l) => (l.productId === p.id ? { ...l, quantity: Math.min(l.quantity + 1, Math.max(p.stock, 1)) } : l));
      return [...prev, { productId: p.id, name: p.name, price: p.sellingPrice, quantity: 1, taxRate: p.taxRate?.rate ?? 0, maxStock: p.stock }];
    });
  }

  function setQty(productId: string, q: number) {
    setCart((prev) => prev.map((l) => (l.productId === productId ? { ...l, quantity: Math.max(1, Math.min(q, l.maxStock || 9999)) } : l)));
  }
  function setPrice(productId: string, v: number) {
    setCart((prev) => prev.map((l) => (l.productId === productId ? { ...l, price: Math.max(0, v) } : l)));
  }

  const gross = useMemo(() => cart.reduce((s, l) => s + l.price * l.quantity, 0), [cart]);
  const taxTotal = useMemo(
    () =>
      cart.reduce((s, l) => {
        const lineGross = l.price * l.quantity;
        return s + (lineGross * l.taxRate) / 100;
      }, 0),
    [cart]
  );
  const discountAmount = useMemo(() => {
    const v = Number(discountInput) || 0;
    return discountIsPercent ? Math.min(gross, (gross * v) / 100) : Math.min(gross, v);
  }, [discountInput, discountIsPercent, gross]);
  const total = Math.max(0, gross + taxTotal - discountAmount);

  async function openGates() {
    try {
      if (gate === "shift" || gate === "both") await post("/shifts/open", { openingCash: Number(openingCash) || 0 });
      if (gate === "cash") await post("/cash/open", { openingCash: Number(openingCash) || 0 });
      if (gate === "both") await post("/cash/open", { openingCash: Number(openingCash) || 0 });
      setGate(null);
      loadProducts();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to open shift");
    }
  }

  function resetSale() {
    setCart([]);
    setCustomerId("");
    setDiscountInput("");
    setPaidInput("");
    setNote("");
    searchRef.current?.focus();
  }

  async function complete() {
    if (!cart.length) return;
    const paid = paidInput === "" ? total : Number(paidInput) || 0;
    if (paymentMethod !== "credit" && paid + 0.001 < total) {
      alert("Paid amount is less than total. Choose Credit or increase paid amount.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const payload = {
        customerId: customerId || null,
        items: cart.map((l) => ({ productId: l.productId, quantity: l.quantity, price: l.price, discountAmount: 0, taxRate: l.taxRate })),
        payments: [{ method: paymentMethod, amount: paymentMethod === "credit" ? 0 : Math.min(paid, total) }],
        discountAmount,
        note: note || null,
      };
      const r = await post("/pos/complete", payload);
      const saleId = r.saleId;
      let saleDetail = null;
      try {
        saleDetail = await get(`/sales/${saleId}`);
      } catch {}
      setReceipt({ ...r, detail: saleDetail });
      resetSale();
      loadProducts();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  async function hold() {
    if (!cart.length) return;
    setBusy(true);
    try {
      await post("/pos/hold", {
        customerId: customerId || null,
        items: cart.map((l) => ({ productId: l.productId, quantity: l.quantity, price: l.price, taxRate: l.taxRate })),
        discountAmount,
        note: note || null,
      });
      resetSale();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Hold failed");
    } finally {
      setBusy(false);
    }
  }

  if (!ready) return <Spinner />;

  if (gate)
    return (
      <div className="mx-auto mt-16 max-w-md">
        <Card className="p-6">
          <h2 className="mb-1 text-lg font-bold">Start of day</h2>
          <p className="mb-4 text-sm text-slate-500">
            {gate === "both" ? "Open your shift and cash register to begin selling." : gate === "shift" ? "Open your shift to begin selling." : "Your cash register is closed."}
          </p>
          <Input label="Opening cash in drawer (₹)" type="number" value={openingCash} onChange={(e) => setOpeningCash(e.target.value)} placeholder="0" />
          <div className="mt-4 flex justify-end gap-2">
            <Button onClick={openGates}>Open for business</Button>
          </div>
        </Card>
      </div>
    );

  const pages = Math.max(1, Math.ceil(totalProducts / 24));

  return (
    <div className="flex h-full min-h-[70vh] flex-col gap-4 xl:flex-row">
      {/* Left: products */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="mb-3 flex gap-2">
          <input
            ref={searchRef}
            autoFocus
            placeholder="Search product by name / SKU / barcode…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="w-full rounded-lg border border-slate-300 px-4 py-2.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          />
          <select
            value={categoryId}
            onChange={(e) => {
              setCategoryId(e.target.value);
              setPage(1);
            }}
            className="rounded-lg border border-slate-300 bg-white px-3 text-sm"
          >
            <option value="">All categories</option>
            {(categories as any).map((c: any) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        {error && <ErrorMsg error={error} />}

        <div className="grid flex-1 auto-fill-minmax grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
          {products.map((p) => (
            <button
              key={p.id}
              onClick={() => addToCart(p)}
              disabled={p.stock <= 0}
              className="flex h-full flex-col justify-between rounded-xl border border-slate-200 bg-white p-3 text-left shadow-sm transition hover:border-blue-400 hover:shadow disabled:opacity-40"
            >
              <span className="line-clamp-2 min-h-[2.5em] text-sm font-medium leading-snug">{p.name}</span>
              <span className="mt-2 flex items-baseline justify-between">
                <span className="font-bold text-blue-700">{money(p.sellingPrice)}</span>
                <span className={`text-xs ${p.stock <= 5 ? "text-red-500" : "text-slate-400"}`}>{p.stock} {p.unit}</span>
              </span>
            </button>
          ))}
          {!products.length && <div className="col-span-full py-12 text-center text-sm text-slate-400">No products match</div>}
        </div>

        {pages > 1 && (
          <div className="mt-3 flex items-center gap-2">
            <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              ← Prev
            </Button>
            <span className="text-sm text-slate-500">
              {page} / {pages}
            </span>
            <Button size="sm" variant="secondary" disabled={page >= pages} onClick={() => setPage(page + 1)}>
              Next →
            </Button>
          </div>
        )}
      </div>

      {/* Right: cart */}
      <Card className="flex w-full flex-col p-4 xl:w-[380px] xl:shrink-0">
        <h3 className="mb-2 font-bold">Current Sale</h3>
        <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} className="mb-3 rounded-lg border border-slate-300 px-3 py-2 text-sm">
          <option value="">Walk-in customer</option>
          {customers.map((c: any) => (
            <option key={c.id} value={c.id}>
              {c.name}{c.phone ? ` (${c.phone})` : ""}
            </option>
          ))}
        </select>

        <div className="-mx-1 max-h-[34vh] min-h-[80px] flex-1 overflow-y-auto px-1">
          {!cart.length && <div className="py-8 text-center text-sm text-slate-400">Cart is empty — tap products to add</div>}
          {cart.map((l) => (
            <div key={l.productId} className="mb-2 rounded-lg border border-slate-200 p-2">
              <div className="flex items-start justify-between gap-2">
                <span className="text-sm font-medium">{l.name}</span>
                <button onClick={() => setCart(cart.filter((x) => x.productId !== l.productId))} className="text-red-400 hover:text-red-600">
                  ✕
                </button>
              </div>
              <div className="mt-1.5 flex items-center gap-2 text-sm">
                <button onClick={() => setQty(l.productId, l.quantity - 1)} className="h-6 w-6 rounded bg-slate-200 hover:bg-slate-300">
                  −
                </button>
                <input
                  type="number"
                  value={l.quantity}
                  onChange={(e) => setQty(l.productId, Number(e.target.value))}
                  className="w-14 rounded border border-slate-300 px-1 py-0.5 text-center"
                />
                <button onClick={() => setQty(l.productId, l.quantity + 1)} className="h-6 w-6 rounded bg-slate-200 hover:bg-slate-300">
                  +
                </button>
                <span className="text-slate-400">×</span>
                <input
                  type="number"
                  value={l.price}
                  onChange={(e) => setPrice(l.productId, Number(e.target.value))}
                  className="w-20 rounded border border-slate-300 px-1.5 py-0.5 text-right"
                />
                <span className="ml-auto font-semibold">{money(l.price * l.quantity)}</span>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-3 space-y-1.5 border-t border-dashed border-slate-200 pt-3 text-sm">
          <div className="flex justify-between text-slate-600">
            <span>Subtotal</span>
            <span>{money(gross)}</span>
          </div>
          <div className="flex items-center justify-between gap-2 text-slate-600">
            <span>Discount</span>
            <span className="flex items-center gap-1">
              <input
                type="number"
                value={discountInput}
                onChange={(e) => setDiscountInput(e.target.value)}
                placeholder="0"
                className="w-20 rounded border border-slate-300 px-2 py-1 text-right"
              />
              <button
                onClick={() => setDiscountIsPercent(!discountIsPercent)}
                className={`rounded px-2 py-1 text-xs ${discountIsPercent ? "bg-blue-600 text-white" : "bg-slate-200"}`}
              >
                {discountIsPercent ? "%" : "₹"}
              </button>
            </span>
          </div>
          <div className="flex justify-between text-slate-600">
            <span>Tax</span>
            <span>{money(taxTotal)}</span>
          </div>
          <div className="flex justify-between text-lg font-bold text-slate-900">
            <span>Total</span>
            <span>{money(total)}</span>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-1.5">
          {["cash", "upi", "card", "bank", "credit"].map((m) => (
            <button
              key={m}
              onClick={() => setPaymentMethod(m)}
              className={`rounded-lg border px-2 py-1.5 text-xs font-medium capitalize ${
                paymentMethod === m ? "border-blue-600 bg-blue-50 text-blue-700" : "border-slate-300 text-slate-600 hover:bg-slate-50"
              }`}
            >
              {m}
            </button>
          ))}
        </div>
        {paymentMethod !== "credit" && (
          <div className="mt-2">
            <Input label="Amount received (₹)" type="number" value={paidInput} onChange={(e) => setPaidInput(e.target.value)} placeholder={String(total.toFixed(2))} />
            {Number(paidInput) > total && (
              <div className="mt-1 text-right text-xs font-medium text-emerald-600">Change: {money(Number(paidInput) - total)}</div>
            )}
          </div>
        )}

        <div className="mt-3 grid grid-cols-2 gap-2">
          <Button variant="secondary" onClick={hold} disabled={!cart.length || busy}>
            Hold
          </Button>
          <Button variant="success" size="lg" onClick={complete} disabled={!cart.length || busy}>
            {busy ? "Processing…" : `Charge ${money(total)}`}
          </Button>
        </div>
      </Card>

      <Modal open={!!receipt} onClose={() => setReceipt(null)} title="Sale completed">
        {receipt && (
          <div className="space-y-3">
            <div className="rounded-lg bg-emerald-50 px-4 py-3 text-emerald-800">
              Invoice <b>{receipt.invoiceNo}</b> · Total <b>{money(receipt.total)}</b>
            </div>
            {receipt.detail && (
              <div className="print-area max-h-72 overflow-y-auto rounded-lg border border-slate-200 p-4 text-sm">
                <div className="mb-2 text-center font-bold">{user?.branchName || "POS Store"}</div>
                <div className="mb-3 text-center text-xs text-slate-500">Invoice: {receipt.invoiceNo}</div>
                <table className="w-full">
                  <tbody>
                    {(receipt.detail.items || []).map((it: any, i: number) => (
                      <tr key={i}>
                        <td className="py-0.5 pr-2">{it.quantity} × {(it.product?.name || it.note || "Item").slice(0, 24)}</td>
                        <td className="py-0.5 text-right">{money(it.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="mt-2 space-y-0.5 border-t pt-2 text-right">
                  <div>Total: <b>{money(receipt.detail.total ?? receipt.total)}</b></div>
                  <div>Paid: {money(receipt.detail.paidAmount ?? receipt.total)}</div>
                  {!!receipt.detail.balance && <div>Balance due: {money(receipt.detail.balance)}</div>}
                </div>
                <div className="mt-3 text-center text-xs text-slate-400">Thank you! Visit again.</div>
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setReceipt(null)}>
                New Sale
              </Button>
              <Button onClick={() => window.print()}>Print Receipt</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
