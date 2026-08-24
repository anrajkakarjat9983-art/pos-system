import { useEffect, useState } from "react";
import { get, post, put, del } from "../api";
import { Button, Card, Input, Modal, Select, Spinner, Table, Td, Badge } from "../ui";

type Entity = { id: string; name: string; [k: string]: any };

const TABS = [
  { key: "categories", label: "Categories" },
  { key: "brands", label: "Brands" },
  { key: "units", label: "Units" },
  { key: "tax-rates", label: "Tax Rates" },
] as const;

export default function Catalog() {
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("categories");
  const [rows, setRows] = useState<Entity[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<any | null>(null);
  const [error, setError] = useState<unknown>(null);

  const isUnit = tab === "units";
  const isTax = tab === "tax-rates";

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setRows(await get(`/catalog/${tab}`));
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [tab]);

  function blank() {
    if (isUnit) return { name: "", shortName: "" };
    if (isTax) return { name: "", rate: 0, cgst: 0, sgst: 0, igst: 0, type: "exclusive", status: "active" };
    return { name: "", parentId: "", status: "active" };
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    try {
      if (editing.id) await put(`/catalog/${tab}/${editing.id}`, editing);
      else await post(`/catalog/${tab}`, editing);
      setEditing(null);
      load();
    } catch (e2) {
      alert(e2 instanceof Error ? e2.message : "Save failed");
    }
  }

  async function remove(row: Entity) {
    if (!confirm(`Deactivate "${row.name}"?`)) return;
    try {
      await del(`/catalog/${tab}/${row.id}`);
      load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Delete failed");
    }
  }

  return (
    <div>
      <h1 className="mb-4 text-xl font-bold">Catalog</h1>
      <div className="mb-3 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-lg px-4 py-2 text-sm ${tab === t.key ? "bg-blue-600 text-white" : "border border-slate-300 bg-white hover:bg-slate-50"}`}
          >
            {t.label}
          </button>
        ))}
        <div className="ml-auto">
          <Button onClick={() => setEditing(blank())}>+ Add</Button>
        </div>
      </div>

      {error && <Card className="p-4 text-sm text-red-700">{String(error)}</Card>}
      {loading ? (
        <Spinner />
      ) : (
        <Table head={isTax ? ["Name", "Rate %", "CGST", "SGST", "Type", "Status", ""] : isUnit ? ["Name", "Short name", ""] : ["Name", "Products", "Status", ""]}>
          {(rows as any[]).map((r) => (
            <tr key={r.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
              <Td className="font-medium">{r.name}</Td>
              {isTax ? (
                <>
                  <Td>{r.rate}%</Td>
                  <Td>{r.cgst}%</Td>
                  <Td>{r.sgst}%</Td>
                  <Td>{r.type}</Td>
                </>
              ) : isUnit ? (
                <Td>{r.shortName}</Td>
              ) : (
                <>
                  <Td>{(r as any)._count?.products ?? "-"}</Td>
                  <Td>
                    <Badge color={r.status === "active" ? "green" : "slate"}>{r.status}</Badge>
                  </Td>
                </>
              )}
              {!isTax && !isUnit && null}
              <Td className="text-right">
                <Button size="sm" variant="ghost" onClick={() => setEditing({ ...r })}>
                  Edit
                </Button>{" "}
                <Button size="sm" variant="ghost" onClick={() => remove(r)}>
                  ✕
                </Button>
              </Td>
            </tr>
          ))}
          {!rows.length && (
            <tr>
              <Td colSpan={9} className="py-10 text-center text-slate-400">
                Nothing here yet
              </Td>
            </tr>
          )}
        </Table>
      )}

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? "Edit" : `New ${TABS.find((t) => t.key === tab)?.label}`}>
        {editing && (
          <form onSubmit={save} className="grid grid-cols-2 gap-4">
            <Input label="Name *" required value={editing.name || ""} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
            {isUnit && <Input label="Short name *" required value={editing.shortName || ""} onChange={(e) => setEditing({ ...editing, shortName: e.target.value })} />}
            {isTax && (
              <>
                <Input label="Rate %" type="number" step="0.01" value={editing.rate ?? 0} onChange={(e) => setEditing({ ...editing, rate: Number(e.target.value) })} />
                <Select
                  label="Type"
                  value={editing.type || "exclusive"}
                  onChange={(e) => setEditing({ ...editing, type: e.target.value })}
                  options={[
                    { value: "exclusive", label: "Exclusive" },
                    { value: "inclusive", label: "Inclusive" },
                  ]}
                />
                <Input label="CGST %" type="number" step="0.01" value={editing.cgst ?? 0} onChange={(e) => setEditing({ ...editing, cgst: Number(e.target.value) })} />
                <Input label="SGST %" type="number" step="0.01" value={editing.sgst ?? 0} onChange={(e) => setEditing({ ...editing, sgst: Number(e.target.value) })} />
              </>
            )}
            {!isUnit && !isTax && tab === "categories" && (
              <Select
                label="Parent category"
                value={editing.parentId || ""}
                onChange={(e) => setEditing({ ...editing, parentId: e.target.value })}
                options={[{ value: "", label: "— None —" }, ...rows.filter((x) => x.id !== editing.id).map((x) => ({ value: x.id, label: x.name }))]}
              />
            )}
            <div className="col-span-2 mt-2 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setEditing(null)}>
                Cancel
              </Button>
              <Button type="submit">Save</Button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
