import { createContext, useContext, useState, useEffect, type ReactNode } from "react";
import { get, post, setToken, getToken } from "./api";

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: string;
  branchId: string | null;
  branchName: string | null;
  permissions: string[];
}

interface AuthCtx {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  can: (permission: string) => boolean;
}

const Ctx = createContext<AuthCtx>({ user: null, loading: true, login: async () => {}, logout: () => {}, can: () => false });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!getToken()) {
      setLoading(false);
      return;
    }
    get<{ user: AuthUser }>("/auth/me")
      .then((r) => {
        const u = (r as any).user || (r as any);
        setUser({ ...u, role: u.role?.name || u.roleName || u.role });
      })
      .catch(() => setToken(""))
      .finally(() => setLoading(false));
  }, []);

  async function login(email: string, password: string) {
    const r = await post("/auth/login", { email, password });
    setToken(r.token);
    setUser(r.user);
  }

  function logout() {
    setToken("");
    setUser(null);
  }

  const can = (permission: string) => !!user && user.permissions.includes(permission);

  return <Ctx.Provider value={{ user, loading, login, logout, can }}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
