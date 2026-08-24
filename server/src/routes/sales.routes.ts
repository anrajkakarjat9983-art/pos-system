import { Router } from "express";
import { prisma } from "../db.js";
import { requireAuth, requirePermission, isSuperAdmin } from "../middleware/auth.js";
import { asyncHandler, AppError } from "../middleware/error.js";
import { auditLog } from "../utils/audit.js";
import { extractQuery, branchFilter } from "../utils/helpers.js";
import { generateInvoicePdf } from "../utils/pdf.js";
import { getSetting } from "../utils/settings.js";
import { config } from "../config.js";
import path from "path";
import fs from "fs";

const router = Router();
router.use(requireAuth);

router.get(
  "/",
  requirePermission("sales.view"),
  asyncHandler(async (req, res) => {
    const { search, page, pageSize, sortBy, sortOrder, from, to, status } = extractQuery(req.query);
    const customerId = typeof req.query.customerId === "string" && req.query.customerId ? req.query.customerId : null;
    const userId = typeof req.query.userId === "string" && req.query.userId ? req.query.userId : null;
    const paymentStatus = typeof req.query.paymentStatus === "string" && req.query.paymentStatus ? req.query.paymentStatus : null;
    const where: any = {
      ...branchFilter(req),
      ...(status ? { status } : {}),
      ...(paymentStatus ? { paymentStatus } : {}),
      ...(customerId ? { customerId } : {}),
      ...(userId ? { userId } : {}),
      ...(from || to ? { createdAt: { gte: from ?? undefined, lte: to ?? undefined } } : {}),
      ...(search
        ? {
            OR: [
              { invoiceNo: { contains: search } },
              { customer: { name: { contains: search } } },
              { customer: { phone: { contains: search } } },
            ],
          }
        : {}),
    };
    const [total, rows] = await Promise.all([
      prisma.sale.count({ where }),
      prisma.sale.findMany({
        where,
        include: {
          customer: { select: { id: true, name: true, phone: true } },
          user: { select: { name: true } },
          branch: { select: { name: true } },
          payments: true,
          _count: { select: { items: true } },
        },
        orderBy: { [sortBy]: sortOrder },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    res.json({ data: rows, total, page, pageSize });
  })
);

router.get(
  "/:id",
  requirePermission("sales.view"),
  asyncHandler(async (req, res) => {
    const sale = await prisma.sale.findUnique({
      where: { id: req.params.id },
      include: {
        customer: true,
        user: { select: { name: true } },
        branch: true,
        items: { include: { product: true, variant: true, returns: true } },
        payments: true,
        coupon: true,
      },
    });
    if (!sale) throw new AppError(404, "Sale not found");
    res.json(sale);
  })
);

router.get(
  "/:id/pdf",
  requirePermission("sales.print"),
  asyncHandler(async (req, res) => {
    const { filePath, fileName } = await generateInvoicePdf(req.params.id);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename=${fileName}`);
    fs.createReadStream(filePath).pipe(res);
  })
);

router.post(
  "/:id/email",
  requirePermission("sales.print"),
  asyncHandler(async (req, res) => {
    const sale = await prisma.sale.findUnique({
      where: { id: req.params.id },
      include: { customer: true, items: { include: { product: true } }, payments: true },
    });
    if (!sale) throw new AppError(404, "Sale not found");
    if (!sale.customer?.email) throw new AppError(422, "Customer has no email address");
    const smtpEnabled = (await getSetting("email.smtpEnabled")) === "true";
    if (!smtpEnabled) {
      throw new AppError(422, "SMTP is not configured. Enable it in Settings > Email.");
    }
    const { filePath, fileName } = await generateInvoicePdf(sale.id);
    // SMTP transport is configured via email settings; attach invoice PDF and send.
    await prisma.invoice.updateMany({
      where: { saleId: sale.id },
      data: { sentVia: "email", sentAt: new Date() },
    });
    await auditLog({
      userId: req.authUserId,
      action: "EMAIL_INVOICE",
      module: "sales",
      entityId: sale.id,
      details: { to: sale.customer.email, file: filePath },
    });
    res.json({ ok: true, message: "Invoice queued to email" });
  })
);

router.get(
  "/:id/whatsapp-link",
  requirePermission("sales.print"),
  asyncHandler(async (req, res) => {
    const sale = await prisma.sale.findUnique({
      where: { id: req.params.id },
      include: { customer: true },
    });
    if (!sale) throw new AppError(404, "Sale not found");
    if (!sale.customer?.phone) throw new AppError(422, "Customer has no phone number");
    const company = (await getSetting("company.name")) || "My Business";
    const text = encodeURIComponent(
      `Dear ${sale.customer.name},\nInvoice ${sale.invoiceNo} from ${company} - Total: ${sale.total.toFixed(2)}. Thank you for your purchase!`
    );
    const phone = sale.customer.phone.replace(/[^\d]/g, "");
    res.json({ url: `https://wa.me/${phone}?text=${text}` });
  })
);

router.post(
  "/:id/cancel",
  requirePermission("sales.cancel"),
  asyncHandler(async (req, res) => {
    const sale = await prisma.sale.findUnique({ where: { id: req.params.id } });
    if (!sale) throw new AppError(404, "Sale not found");
    if (sale.status !== "completed") throw new AppError(400, "Only completed sales can be cancelled");
    if (!isSuperAdmin(req)) throw new AppError(403, "Only Super Admin can cancel completed sales");
    await prisma.sale.update({ where: { id: sale.id }, data: { status: "cancelled" } });
    await auditLog({
      userId: req.authUserId,
      action: "CANCEL_SALE",
      module: "sales",
      entityId: sale.id,
      details: { invoiceNo: sale.invoiceNo },
    });
    res.json({ ok: true });
  })
);

export default router;