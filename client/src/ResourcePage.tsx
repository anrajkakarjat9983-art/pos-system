import { useEffect, useState, useCallback } from "react";
import { get, post, put } from "./api";
import { Button, Card, Input, Modal, Pagination, Select, Spinner, Table, Td, ErrorMsg, statusBadge } from "./ui";

export interface FieldDef {
  key: string;
  label: string;
  type?: "text" | "number" | "select" | "textarea" | "date" | "password";
  options?:
    | { value: string; label: string }
    | (() => Promise<{ value: string; label: string }[]>);
  required?: boolean;
  hideInTable?: boolean;
  hideInForm?: boolean;
  render?: (row: any) => React.ReactNode;
  default?: any;
  step?: string;
}

export function useOptions(fn?: () => Promise<{ value: string; label: string }[]>) {
  const [options, setOptions] = useState<{ value: string; label: string }[]>([]);
  useEffect(() => {
    if (fn) fn().then(setOptions).catch(() => {});
  }, []);
  return options;
}

export async function fetchRefOptions(endpoint: string, labelKey = "name"): Promise<{ value: string; label: string }[]> {
  const r = await get<any>(endpoint);
  const rows = Array.isArray(r) ? r : r.data || [];
  return [{ value: "", label: "— None —" }, ...rows.map((x: any) => ({ value: x.id, label: x[labelKey] || x.name || x.id }))];
}

export default function ResourcePage({
  title,
  endpoint,
  fields,
  canManage,
  searchPlaceholder = "Search…",
  extraQuery = "",
}: {
  title: string;
  endpoint: string;
  fields: FieldDef[];
  canManage?: boolean;
  searchPlaceholder?: string;
  extraQuery?: string;
}) {
  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [editing, setEditing] = useState<any | null>(null);
  const [saving, setSaving] = useState(false);
  const pageSize = 20;

  const tableFields = fields.filter((f) => !f.hideInTable);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const q = new URLSearchParams({ page: String(page), pageSize: String(pageSize), ...(search ? { search } : {}) });
      const r = await get(`${endpoint}?${q.toString()}${extraQuery}`);
      setRows(r.data || []);
      setTotal(r.total ?? (r.data || []).length);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, [endpoint, page, search, extraQuery]);

  useEffect(() => {
    load();
  }, [load]);

  async function resolveOptions(f: FieldDef) {
    if (typeof f.options === "function") return f.options();
    return f.options || [];
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    setSaving(true);
    try {
      const body: any = {};
      for (const f of fields) {
        if (f.hideInForm) continue;
        let v = editing[f.key];
        if (v === "" || v === undefined) v = null;
        if (f.type === "number" && v !== null) v = Number(v);
        body[f.key] = v;
      }
      if (editing.id) await put(`${endpoint}/${editing.id}`, body);
      else await post(endpoint, body);
      setEditing(null);
      load();
    } catch (e2) {
      alert(e2 instanceof Error ? e2.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold">{title}</h1>
        <div className="flex gap-2">
          <div className="w-56">
            <Input
              placeholder={searchPlaceholder}
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </div>
          {canManage && (
            <Button onClick={() => setEditing(Object.fromEntries(fields.map((f) => [f.key, f.default ?? (f.type === "number" ? 0 : "")])))}>
              + Add
            </Button>
          )}
        </div>
      </div>

      {error && <ErrorMsg error={error} />}
      {loading ? (
        <Spinner />
      ) : (
        <>
          <Table head={[...tableFields.map((f) => f.label)]}>
            {rows.map((row) => (
              <tr key={row.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                {tableFields.map((f) => (
                  <Td key={f.key}>{f.render ? f.render(row) : row[f.key] ?? "-"}</Td>
                ))}
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <Td className="py-10 text-center text-slate-400">No records found</Td>
              </tr>
            )}
          </Table>
          <Pagination page={page} pageSize={pageSize} total={total} onPage={setPage} />
        </>
      )}

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? `Edit ${title.replace(/s$/, "")}` : `New ${title.replace(/s$/, "")}`}>
        {editing && (
          <form onSubmit={save} className="grid grid-cols-2 gap-4">
            {fields
              .filter((f) => !f.hideInForm)
              .map((f) => (
                <FormField key={f.key} field={f} value={editing[f.key]} onChange={(v) => setEditing({ ...editing, [f.key]: v })} />
              ))}
            <div className="col-span-2 mt-2 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setEditing(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? "Saving…" : "Save"}
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}

export function FormField({ field: f, value, onChange }: { field: FieldDef; value: any; onChange: (v: any) => void }) {
  const [options, setOptions] = useState<f["options"] extends infer O ? (O extends () => Promise<infer R> ? R : { value: string; label: string }[]) : never>([]);
  useEffect(() => {
    if (f.type === "select") {
      if (typeof f.options === "function") f.options().then((o) => setOptions(o as any)).catch(() => {});
      else setOptions((f.options as any) || []);
    }
  }, []);

  if (f.type === "select")
    return (
      <Select
        label={f.label + (f.required ? " *" : "")}
        options={(options as any) || []}
        required={f.required}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  if (f.type === "textarea")
    return (
      <label className="col-span-2 block">
        <span className="mb-1 block text-xs font-medium text-slate-600">{f.label}</span>
        <textarea
          rows={2}
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
        />
      </label>
    );
  return (
    <Input
      label={f.label + (f.required ? " *" : "")}
      type={f.type || "text"}
      step={f.step}
      required={f.required}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

export { statusBadge };
