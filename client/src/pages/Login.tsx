import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../store";
import { Button, Card, Input } from "../ui";

export default function Login() {
  const { login, user } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (user) navigate("/", { replace: true });
  }, [user, navigate]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await login(email, password);
      navigate("/", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full items-center justify-center bg-slate-900">
      <Card className="w-full max-w-sm p-8">
        <div className="mb-6 text-center">
          <div className="text-3xl">🏪</div>
          <h1 className="mt-2 text-xl font-bold">POS Pro</h1>
          <p className="text-sm text-slate-500">Sign in to your account</p>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <Input label="Email" type="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} placeholder="admin@pos.com" />
          <Input label="Password" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
          {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
          <Button type="submit" disabled={busy} className="w-full" size="lg">
            {busy ? "Signing in…" : "Sign In"}
          </Button>
        </form>
        <p className="mt-5 text-center text-xs text-slate-400">Demo: admin@pos.com / password123</p>
      </Card>
    </div>
  );
}
