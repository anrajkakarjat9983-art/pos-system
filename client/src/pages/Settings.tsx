import { useEffect, useState } from "react";
import { get, put, post, downloadCsv } from "../api";
import { Button, Card, Input, Spinner, ErrorMsg, Table, Td, Badge } from "../ui";
import { useAuth } from "../store";

export default function SettingsPage() {
  const { user, can } = useAuth();
  const [settings, setSettings] = useState<Record<string, string> | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [branches, setBranches] = useState<any[]>([]);
  const [roles, setRoles] = useState<any[]>([]);
  const [pwForm, setPwForm] = useState({ currentPassword: "", newPassword: "" });
  const [pwMsg, setPwMsg] = useState("");

  async function loadAll() {
    setError(null);
    try {
      const [s, b, r] = await Promise.all([can("settings.view") ? get("/settings/") : Promise.resolve(null), get("/branches"), get("/roles")]);
      setSettings(s);
      setBranches(b);
      setRoles(r);
    } catch (e) {
      setError(e);
    }
  }

  useEffect(() => {
    loadAll();
  }, []);

  async function saveSettings() {
    if (!settings) return;
    setSaving(true);
    try {
      await put("/settings/", settings);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    setPwMsg("");
    try {
      await post("/auth/change-password", pwForm);
      setPwMsg("Password updated");
      setPwForm({ currentPassword: "", newPassword: "" });
    } catch (err) {
      setPwMsg(err instanceof Error ? err.message : "Failed");
    }
  }

  return (
    <div>
      <h1 className="mb-4 text-xl font-bold">Settings</h1>
      {error && <ErrorMsg error={error} />}

      <div className="grid gap-4 lg:grid-cols-2">
        {settings && (
          <Card className="p-5">
            <h3 className="mb-3 font-semibold">General</h3>
            <div className="grid grid-cols-2 gap-3">
              {Object.entries(settings)
                .filter(([k]) => !k.toLowerCase().includes("secret") && !k.toLowerCase().includes("password"))
                .slice(0, 24)
                .map(([k, v]) => (
                  <label key={k} className="block">
                    <span className="mb-1 block text-xs font-medium text-slate-600">{k}</span>
                    <input
                      value={typeof v === "object" ? JSON.stringify(v) : String(v ?? "")}
                      onChange={(e) => setSettings({ ...settings, [k]: e.target.value })}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    />
                  </label>
                ))}
            </div>
            {can("settings.manage") && (
              <div className="mt-4 flex items-center gap-2">
                <Button onClick={saveSettings} disabled={saving}>
                  {saving ? "Saving…" : "Save Settings"}
                </Button>
                {saved && <span className="text-sm text-emerald-600">Saved ✓</span>}
              </div>
            )}
          </Card>
        )}

        {!settings && can("settings.view") && <Spinner />}

        <Card className="p-5">
          <h3 className="mb-3 font-semibold">Change my password</h3>
          <form onSubmit={changePassword} className="space-y-3">
            <Input label="Current password" type="password" required value={pwForm.currentPassword} onChange={(e) => setPwForm({ ...pwForm, currentPassword: e.target.value })} />
            <Input label="New password (min 6)" type="password" required minLength={6} value={pwForm.newPassword} onChange={(e) => setPwForm({ ...pwForm, newPassword: e.target.value })} />
            <div className="flex items-center gap-2">
              <Button type="submit">Update password</Button>
              {pwMsg && <span className="text-sm text-slate-600">{pwMsg}</span>}
            </div>
          </form>

          <h3 className="mb-2 mt-6 font-semibold">Roles</h3>
          <Table head={["Role"]}>
            {roles.map((r) => (
              <tr key={r.id} className="border-b border-slate-100 last:border-0">
                <Td>{r.name}</Td>
              </tr>
            ))}
          </Table>
        </Card>
      </div>

      <Card className="mt-4 p-5">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-semibold">Branches</h3>
          <Button size="sm" variant="secondary" onClick={() => downloadCsv("/reports/inventory/valuation", `valuation-${Date.now()}.csv`)}>
            Stock valuation CSV
          </Button>
        </div>
        <Table head={["Name", "Code", "Phone", "GST number", "Status"]}>
          {branches.map((b) => (
            <tr key={b.id} className="border-b border-slate-100 last:border-0">
              <Td className="font-medium">{b.name}</Td>
              <Td>{b.code}</Td>
              <Td>{b.phone || "-"}</Td>
              <Td>{b.gstNumber || "-"}</Td>
              <Td>
                <Badge color={b.status === "active" ? "green" : "slate"}>{b.status}</Badge>
              </Td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}
