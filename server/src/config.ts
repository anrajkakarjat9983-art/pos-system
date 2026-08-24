import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const config = {
  port: Number(process.env.PORT || 4000),
  jwtSecret: process.env.JWT_SECRET || "pos-super-secret-change-in-production",
  clientOrigin: process.env.CLIENT_ORIGIN || "http://localhost:5173",
  dataDir: path.resolve(__dirname, "..", process.env.DATA_DIR || "./data"),
  uploadsDir: path.resolve(__dirname, "..", "uploads"),
  dbPath: path.resolve(__dirname, "..", "prisma", "dev.db"),
};

export function ensureDirs() {
  for (const dir of [config.dataDir, config.uploadsDir, path.join(config.dataDir, "backups")]) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }
}