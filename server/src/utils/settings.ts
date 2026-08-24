import { prisma } from "../db.js";

export async function getSettings(): Promise<Record<string, string>> {
  const rows = await prisma.setting.findMany();
  const out: Record<string, string> = {};
  for (const r of rows) out[r.key] = r.value;
  return out;
}

export async function getSetting(key: string, fallback = ""): Promise<string> {
  const row = await prisma.setting.findUnique({ where: { key } });
  return row?.value ?? fallback;
}

export async function setSetting(key: string, value: string, group = "general") {
  await prisma.setting.upsert({
    where: { key },
    update: { value, group },
    create: { key, value, group },
  });
}

export async function setSettings(values: Record<string, string>, group = "general") {
  for (const [k, v] of Object.entries(values)) {
    if (v !== undefined) await setSetting(k, String(v), group);
  }
}

export async function getCompanyInfo() {
  const s = await getSettings();
  return {
    name: s["company.name"] || "My Business",
    address: s["company.address"] || "",
    phone: s["company.phone"] || "",
    email: s["company.email"] || "",
    gstNumber: s["company.gst"] || "",
    logo: s["company.logo"] || "",
    currency: s["company.currency"] || "₹",
    tagline: s["company.tagline"] || "",
    invoiceTerms: s["invoice.terms"] || "Goods once sold cannot be taken back.",
    invoiceFooter: s["invoice.footer"] || "Thank you for shopping with us!",
    taxType: s["tax.type"] || "exclusive",
  };
}