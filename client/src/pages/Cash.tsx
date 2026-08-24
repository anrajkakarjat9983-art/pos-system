import { useCallback, useEffect, useState } from "react";
import { get, post } from "../api";
import { money, dateTimeFmt } from "../format";
import { Button, Card, Input, Modal, Spinner, Table, Td, ErrorMsg, statusBadge } from "../ui";

export default function Cash() {
  const [mine, setMine] = useState<any>(null);
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [dialog, setDialog] = useState<null | "open" | "close" | "in" | "out">(null);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([get("/cash/my-open").catch(() => null), get("/cash/?page=1&pageSize=20").catch(() => null)])
      .then(([m, list]) => {
        setMine(m);
        setRows(list?.data || list || []);
      })
      .catch(setError)
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  async function act() {
    try {
      if (dialog === "open") await post("/cash/open", { openingCash: Number(amount) || 0 });
      if (dialog === "close") await post("/cash/close", { actualCash: Number(amount) || 0, note: note || null });
      if (dialog === "in") await post("/cash/transactions", { type: "cash_in", amount: Number(amount), note: note || null });
      if (dialog === "out") await post("/cash/transactions", { type: "cash_out", amount: Number(amount), note: note || null });
      setDialog(null);
      setAmount("");
      setNote("");
      load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Action failed");
    }
  }

  const registerOpen = !!mine?.register;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold">Cash & Shifts</h1>
        <div className="flex flex-wrap gap-2">
          {!registerOpen && <Button onClick={() => setDialog("open")}>Open Register</Button>}
          {registerOpen && (
            <>
              <Button variant="success" onClick={() => setDialog("in")}>
                Cash In
              </Button>
              <Button variant="danger" onClick={() => setDialog("out")}>
                Cash Out
              </Button>
              <Button variant="secondary" onClick={() => setDialog("close")}>
                Close Register
              </Button>
            </>
          )}
        </div>
      </div>

      {error && <ErrorMsg error={error} />}
      {loading ? (
        <Spinner />
      ) : (
        <>
          {registerOpen && (
            <Card className="mb-4 grid grid-cols-2 gap-4 p-4 sm:grid-cols-4">
              <div>
                <div className="text-xs text-slate-500">Register opened</div>
                <div className="font-semibold">{dateTimeFmt(mine.register.openedAt)}</div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Opening cash</div>
                <div className="font-semibold">{money(mine.register.openingCash)}</div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Status</div>
                <div>{statusBadge("open")}</div>
              </div>
            </Card>
          )}

          <Table head={["Opened", "Closed", "Opening", "Closing", "Expected", "Difference", "Status"]}>
            {(Array.isArray(rows) ? rows : []).map((r) => (
              <tr key={r.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                <Td>{dateTimeFmt(r.openedAt)}</Td>
                <Td>{r.closedAt ? dateTimeFmt(r.closedAt) : "—"}</Td>
                <Td>{money(r.openingCash)}</Td>
                <Td>{r.closingCash != null ? money(r.closingCash) : "—"}</Td>
                <Td>{r.expectedCash != null ? money(r.expectedCash) : "—"}</Td>
                <Td className={(Number(r.difference) || 0) !== 0 ? "text-red-600" : ""}>{r.difference != null ? money(r.difference) : "—"}</Td>
                <Td>{statusBadge(r.status)}</Td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <Td colSpan={7} className="py-10 text-center text-slate-400">
                  No cash registers yet
                </Td>
              </tr>
            )}
          </Table>
        </>
      )}

      <Modal open={!!dialog} onClose={() => setDialog(null)} title={{ open: "Open register", close: "Close register", in: "Cash in", out: "Cash out" }[dialog!] || ""}>
        <div className="space-y-4">
          {dialog !== "in" && dialog !== "out" && (
            <Input label="Opening cash (₹)" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" />
          )}
          {dialog === "close" && (
            <Input label="Actual cash counted (₹)" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
          )}
          {(dialog === "in" || dialog === "out") && (
            <Input label="Amount (₹)" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
          )}
          {(dialog === "in" || dialog === "out" || dialog === "close") && <Input label="Note" value={note} onChange={(e) => setNote(e.target.value)} />}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button onClick={act}>Confirm</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
