import PDFDocument from "pdfkit";
import { prisma } from "../db.js";
import { getCompanyInfo } from "./settings.js";
import { config } from "../config.js";
import fs from "fs";
import path from "path";

export function money(n: number): string {
  return n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export async function generateInvoicePdf(saleId: string): Promise<{ filePath: string; fileName: string }> {
  const sale = await prisma.sale.findUnique({
    where: { id: saleId },
    include: {
      customer: true,
      items: { include: { product: true, variant: true } },
      payments: true,
      user: true,
      branch: true,
    },
  });
  if (!sale) throw new Error("Sale not found");
  const company = await getCompanyInfo();
  const dir = path.join(config.dataDir, "invoices");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const fileName = `${sale.invoiceNo}.pdf`;
  const filePath = path.join(dir, fileName);

  const doc = new PDFDocument({ margin: 40, size: "A4" });
  const stream = fs.createWriteStream(filePath);
  doc.pipe(stream);

  const pageW = doc.page.width - 80;
  const right = doc.page.width - 40;

  doc.fontSize(20).font("Helvetica-Bold").text(company.name, 40, 40);
  doc.fontSize(9).font("Helvetica").fillColor("#444").text(company.address, 40, 66);
  doc.text(`Phone: ${company.phone}   Email: ${company.email}`);
  if (company.gstNumber) doc.text(`GSTIN: ${company.gstNumber}`);
  doc.fillColor("#000");

  doc.fontSize(16).font("Helvetica-Bold").text("TAX INVOICE", right - 90, 40, { width: 90, align: "right" });
  doc.fontSize(9).font("Helvetica").fillColor("#444");
  doc.text(`Invoice No: ${sale.invoiceNo}`, right - 90, 62, { width: 90, align: "right" });
  doc.text(`Date: ${sale.createdAt.toLocaleDateString("en-IN")}`, right - 90, 76, { width: 90, align: "right" });
  doc.fillColor("#000");

  const y0 = 120;
  doc.moveTo(40, y0).lineTo(pageW + 40, y0).strokeColor("#ccc").stroke();
  doc.fontSize(10).font("Helvetica-Bold").text("BILL TO", 40, y0 + 14);
  doc.font("Helvetica").fillColor("#333");
  doc.text(sale.customer?.name || "Walk-in Customer", 40, y0 + 28);
  if (sale.customer?.phone) doc.text(`Phone: ${sale.customer.phone}`);
  if (sale.customer?.address) doc.text(sale.customer.address);
  if (sale.customer?.gstNumber) doc.text(`GSTIN: ${sale.customer.gstNumber}`);
  doc.fillColor("#000");

  doc.fontSize(10).font("Helvetica-Bold").text("PAYMENT", right - 160, y0 + 14, { width: 160, align: "right" });
  doc.font("Helvetica").fillColor("#333");
  const payMethods = sale.payments.map((p) => p.method.toUpperCase()).join(", ");
  doc.text(`Method: ${payMethods || sale.paymentStatus.toUpperCase()}`, right - 160, y0 + 28, { width: 160, align: "right" });
  doc.text(`Status: ${sale.paymentStatus.toUpperCase()}`, right - 160, y0 + 42, { width: 160, align: "right" });
  doc.fillColor("#000");

  let y = y0 + 90;
  doc.moveTo(40, y).lineTo(pageW + 40, y).strokeColor("#ccc").stroke();
  const col = {
    item: 40,
    qty: pageW + 40 - 130,
    price: pageW + 40 - 90,
    disc: pageW + 40 - 60,
    total: pageW + 40 - 25,
  };
  doc.fontSize(9).font("Helvetica-Bold");
  doc.text("#", col.item, y + 8);
  doc.text("QTY", col.qty - 40, y + 8, { width: 40, align: "right" });
  doc.text("PRICE", col.price - 30, y + 8, { width: 30, align: "right" });
  doc.text("DISC", col.disc - 5, y + 8, { width: 30, align: "right" });
  doc.text("TOTAL", col.total - 30, y + 8, { width: 30, align: "right" });
  y += 24;

  sale.items.forEach((it, i) => {
    doc.font("Helvetica").fontSize(9);
    const name = it.product?.name || it.note || "Item";
    doc.text(`${i + 1}. ${name}`, col.item, y, { width: 200 });
    doc.text(String(it.quantity), col.qty - 40, y, { width: 40, align: "right" });
    doc.text(money(it.price), col.price - 30, y, { width: 30, align: "right" });
    doc.text(money(it.discountAmount), col.disc - 5, y, { width: 30, align: "right" });
    doc.text(money(it.total), col.total - 30, y, { width: 30, align: "right" });
    y += 16;
  });

  y += 10;
  doc.moveTo(40, y).lineTo(pageW + 40, y).strokeColor("#ccc").stroke();
  y += 14;
  const summaryX = right - 200;
  doc.font("Helvetica").fontSize(10);
  const lines: [string, string][] = [
    ["Subtotal", money(sale.subtotal)],
    ["Discount", `- ${money(sale.discountAmount)}`],
    ["Tax (GST)", money(sale.taxAmount)],
    ["Round Off", money(sale.roundOff)],
  ];
  for (const [k, v] of lines) {
    doc.text(k, summaryX, y);
    doc.text(v, right - 70, y, { width: 70, align: "right" });
    y += 16;
  }
  doc.font("Helvetica-Bold").fontSize(12);
  doc.text("GRAND TOTAL", summaryX, y);
  doc.text(money(sale.total), right - 70, y, { width: 70, align: "right" });
  y += 20;
  doc.font("Helvetica").fontSize(10);
  doc.text(`Paid: ${money(sale.paidAmount)}`, summaryX, y);
  doc.text(`Balance: ${money(sale.balance)}`, summaryX, y + 16);

  y += 60;
  doc.fontSize(9).fillColor("#555");
  const terms = company.invoiceTerms;
  doc.text("Terms & Conditions:", 40, y);
  doc.text(terms, 40, y + 14, { width: pageW });
  doc.text(company.invoiceFooter, 40, y + 40, { width: pageW });

  doc.end();
  await new Promise<void>((resolve, reject) => {
    stream.on("finish", resolve);
    stream.on("error", reject);
  });
  return { filePath, fileName };
}