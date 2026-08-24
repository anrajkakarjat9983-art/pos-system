import express from "express";
import cors from "cors";
import helmet from "helmet";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { config, ensureDirs } from "./config.js";
import { requireAuth, attachAuth } from "./middleware/auth.js";
import { notFound, errorHandler } from "./middleware/error.js";
import { apiLimiter } from "./middleware/rateLimit.js";

import authRoutes from "./routes/auth.routes.js";
import usersRoutes from "./routes/users.routes.js";
import rolesRoutes from "./routes/roles.routes.js";
import branchesRoutes from "./routes/branches.routes.js";
import employeesRoutes from "./routes/employees.routes.js";
import shiftsRoutes from "./routes/shifts.routes.js";
import productsRoutes from "./routes/products.routes.js";
import catalogRoutes from "./routes/catalog.routes.js";
import customersRoutes from "./routes/customers.routes.js";
import suppliersRoutes from "./routes/suppliers.routes.js";
import posRoutes from "./routes/pos.routes.js";
import salesRoutes from "./routes/sales.routes.js";
import purchasesRoutes from "./routes/purchases.routes.js";
import returnsRoutes from "./routes/returns.routes.js";
import inventoryRoutes from "./routes/inventory.routes.js";
import expensesRoutes from "./routes/expenses.routes.js";
import cashRoutes from "./routes/cash.routes.js";
import dashboardRoutes from "./routes/dashboard.routes.js";
import reportsRoutes from "./routes/reports.routes.js";
import settingsRoutes from "./routes/settings.routes.js";
import notificationsRoutes from "./routes/notifications.routes.js";
import couponsRoutes from "./routes/coupons.routes.js";
import backupsRoutes from "./routes/backups.routes.js";
import auditRoutes from "./routes/audit.routes.js";
import uploadsRoutes from "./routes/uploads.routes.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
ensureDirs();

const app = express();
app.set("trust proxy", 1);
app.set("json replacer", (_key: string, value: unknown) => (typeof value === "bigint" ? Number(value) : value));
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(cors({ origin: config.clientOrigin, credentials: true }));
app.use(express.json({ limit: "5mb" }));
app.use(apiLimiter);
app.use(attachAuth);

app.use("/uploads", express.static(config.uploadsDir));

app.get("/api/health", (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));

app.use("/api/auth", authRoutes);
app.use("/api/users", usersRoutes);
app.use("/api/roles", rolesRoutes);
app.use("/api/branches", branchesRoutes);
app.use("/api/employees", employeesRoutes);
app.use("/api/shifts", shiftsRoutes);
app.use("/api/products", productsRoutes);
app.use("/api/catalog", catalogRoutes);
app.use("/api/customers", customersRoutes);
app.use("/api/suppliers", suppliersRoutes);
app.use("/api/pos", posRoutes);
app.use("/api/sales", salesRoutes);
app.use("/api/purchases", purchasesRoutes);
app.use("/api/returns", returnsRoutes);
app.use("/api/inventory", inventoryRoutes);
app.use("/api/expenses", expensesRoutes);
app.use("/api/cash", cashRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/reports", reportsRoutes);
app.use("/api/settings", settingsRoutes);
app.use("/api/notifications", notificationsRoutes);
app.use("/api/marketing", couponsRoutes);
app.use("/api/backups", backupsRoutes);
app.use("/api/audit-logs", auditRoutes);
app.use("/api/uploads", uploadsRoutes);

app.use("/api", notFound);

const clientDist = path.resolve(__dirname, "..", "..", "client", "dist");
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api")) return next();
    res.sendFile(path.join(clientDist, "index.html"));
  });
}

app.use(errorHandler);

// Automatic backup scheduler
let backupTimer: ReturnType<typeof setInterval> | null = null;
async function scheduleAutoBackup() {
  const { prisma } = await import("./db.js");
  const { getSetting } = await import("./utils/settings.js");
  const enabled = (await getSetting("backup.automatic", "false")) === "true";
  const hours = Number(await getSetting("backup.intervalHours", "24")) || 24;
  if (backupTimer) clearInterval(backupTimer);
  if (enabled) {
    backupTimer = setInterval(async () => {
      try {
        const backupDir = path.join(config.dataDir, "backups");
        if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
        const stamp = new Date().toISOString().replace(/[:.]/g, "-");
        const fileName = `pos-auto-${stamp}.db`;
        const target = path.join(backupDir, fileName);
        await prisma.$executeRawUnsafe(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
        await prisma.backup.create({
          data: { filename: fileName, path: target, size: fs.statSync(target).size, type: "automatic", status: "completed" },
        });
      } catch (err) {
        console.error("Auto backup failed:", err);
      }
    }, hours * 3600 * 1000);
  }
}
scheduleAutoBackup().catch(() => {});

app.listen(config.port, () => {
  console.log(`POS API server running on http://localhost:${config.port}`);
});