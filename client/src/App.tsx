import { useState } from "react";
import { BrowserRouter, Routes, Route, Navigate, NavLink, useNavigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./store";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Pos from "./pages/Pos";
import Products from "./pages/Products";
import Inventory from "./pages/Inventory";
import Sales from "./pages/Sales";
import Purchases from "./pages/Purchases";
import Customers from "./pages/Customers";
import Suppliers from "./pages/Suppliers";
import Expenses from "./pages/Expenses";
import Cash from "./pages/Cash";
import Reports from "./pages/Reports";
import Users from "./pages/Users";
import Catalog from "./pages/Catalog";
import SettingsPage from "./pages/Settings";

const NAV = [
  { to: "/", label: "Dashboard", icon: "▤", perm: "dashboard.view" },
  { to: "/pos", label: "POS Terminal", icon: "🛒", perm: "pos.access" },
  { to: "/sales", label: "Sales", icon: "🧾", perm: "sales.view" },
  { to: "/products", label: "Products", icon: "📦", perm: "products.view" },
  { to: "/inventory", label: "Inventory", icon: "🏷️", perm: "inventory.view" },
  { to: "/purchases", label: "Purchases", icon: "📥", perm: "purchases.view" },
  { to: "/customers", label: "Customers", icon: "👥", perm: "customers.view" },
  { to: "/suppliers", label: "Suppliers", icon: "🚚", perm: "suppliers.view" },
  { to: "/expenses", label: "Expenses", icon: "💸", perm: "expenses.view" },
  { to: "/cash", label: "Cash & Shifts", icon: "💵", perm: "cash.view" },
  { to: "/reports", label: "Reports", icon: "📈", perm: "reports.view" },
  { to: "/catalog", label: "Catalog", icon: "🗂️", perm: "categories.manage" },
  { to: "/users", label: "Users", icon: "🔑", perm: "users.manage" },
  { to: "/settings", label: "Settings", icon: "⚙️", perm: "settings.view" },
];

function Shell() {
  const { user, logout, loading } = useAuth();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  if (loading)
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-slate-200 border-t-blue-600" />
      </div>
    );
  if (!user) return <Navigate to="/login" replace />;

  return (
    <div className="flex h-full">
      <aside
        className={`${sidebarOpen ? "translate-x-0" : "-translate-x-full"} fixed inset-y-0 left-0 z-40 flex w-60 flex-col bg-slate-900 text-slate-300 transition-transform md:static md:translate-x-0`}
      >
        <div className="flex items-center gap-2 px-5 py-5">
          <span className="text-xl">🏪</span>
          <span className="text-lg font-bold text-white">POS Pro</span>
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 pb-4">
          {NAV.filter((n) => !n.perm || user.permissions.includes(n.perm)).map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.to === "/"}
              onClick={() => setSidebarOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2 text-sm ${isActive ? "bg-blue-600 text-white" : "hover:bg-slate-800 hover:text-white"}`
              }
            >
              <span className="w-5 text-center">{n.icon}</span>
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-slate-800 px-4 py-3 text-xs">
          <div className="font-medium text-white">{user.name}</div>
          <div className="mb-2 text-slate-400">{user.role}{user.branchName ? ` · ${user.branchName}` : ""}</div>
          <button
            onClick={() => {
              logout();
              navigate("/login");
            }}
            className="text-red-400 hover:text-red-300"
          >
            Sign out
          </button>
        </div>
      </aside>

      <main className="h-full flex-1 overflow-y-auto p-6">
        <button className="mb-3 rounded border px-2 py-1 text-sm md:hidden" onClick={() => setSidebarOpen(!sidebarOpen)}>
          ☰ Menu
        </button>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/pos" element={<Pos />} />
          <Route path="/products" element={<Products />} />
          <Route path="/inventory" element={<Inventory />} />
          <Route path="/sales" element={<Sales />} />
          <Route path="/purchases" element={<Purchases />} />
          <Route path="/customers" element={<Customers />} />
          <Route path="/suppliers" element={<Suppliers />} />
          <Route path="/expenses" element={<Expenses />} />
          <Route path="/cash" element={<Cash />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/catalog" element={<Catalog />} />
          <Route path="/users" element={<Users />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/*" element={<Shell />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
