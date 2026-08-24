import { Router } from "express";
import { z } from "zod";
import multer from "multer";
import path from "path";
import fs from "fs";
import { prisma } from "../db.js";
import { config } from "../config.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";
import { validate, getValidated } from "../middleware/validate.js";
import { asyncHandler, AppError } from "../middleware/error.js";
import { auditLog } from "../utils/audit.js";
import { extractQuery, branchFilter } from "../utils/helpers.js";
import { applyStockMovement } from "../utils/inventory.js";

const router = Router();
router.use(requireAuth);

const upload = multer({ dest: path.join(config.uploadsDir, "tmp") });

function ean13(): string {
  let digits = "";
  for (let i = 0; i < 12; i++) digits += Math.floor(Math.random() * 10);
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(digits[i]) * (i % 2 === 0 ? 1 : 3);
  const check = (10 - (sum % 10)) % 10;
  return digits + check;
}

const productSchema = z.object({
  name: z.string().min(1),
  code: z.string().nullable().optional(),
  sku: z.string().nullable().optional(),
  barcode: z.string().nullable().optional(),
  categoryId: z.string().nullable().optional(),
  brandId: z.string().nullable().optional(),
  unitId: z.string().nullable().optional(),
  taxRateId: z.string().nullable().optional(),
  purchasePrice: z.number().default(0),
  sellingPrice: z.number().default(0),
  mrp: z.number().default(0),
  wholesalePrice: z.number().default(0),
  minStock: z.number().default(0),
  maxStock: z.number().default(0),
  supplierId: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  status: z.string().default("active"),
  trackSerial: z.boolean().default(false),
  trackBatch: z.boolean().default(false),
  image: z.string().nullable().optional(),
  variants: z
    .array(
      z.object({
        name: z.string().min(1),
        sku: z.string().nullable().optional(),
        barcode: z.string().nullable().optional(),
        sellingPrice: z.number(),
        purchasePrice: z.number().default(0),
        mrp: z.number().default(0),
      })
    )
    .default([]),
});

async function validateRefs(data: z.infer<typeof productSchema>) {
  if (data.categoryId) {
    const c = await prisma.category.findUnique({ where: { id: data.categoryId } });
    if (!c) throw new AppError(422, "Invalid category");
  }
  if (data.brandId) {
    const b = await prisma.brand.findUnique({ where: { id: data.brandId } });
    if (!b) throw new AppError(422, "Invalid brand");
  }
  if (data.taxRateId) {
    const t = await prisma.taxRate.findUnique({ where: { id: data.taxRateId } });
    if (!t) throw new AppError(422, "Invalid tax rate");
  }
}

async function productDetail(id: string) {
  return prisma.product.findUnique({
    where: { id },
    include: {
      category: true,
      brand: true,
      unit: true,
      taxRate: true,
      supplier: { select: { id: true, name: true } },
      variants: true,
      inventories: true,
      batches: true,
    },
  });
}

router.get(
  "/",
  requirePermission("products.view"),
  asyncHandler(async (req, res) => {
    const { search, page, pageSize, sortBy, sortOrder, status } = extractQuery(req.query);
    const categoryId = typeof req.query.categoryId === "string" ? req.query.categoryId : null;
    const brandId = typeof req.query.brandId === "string" ? req.query.brandId : null;
    const lowStock = req.query.lowStock === "true";
    const outOfStock = req.query.outOfStock === "true";
    const expiry = req.query.expiry === "true";
    const branchFilterQ = branchFilter(req);

    const searchWhere = search
      ? {
          OR: [
            { name: { contains: search } },
            { sku: { contains: search } },
            { barcode: { contains: search } },
            { code: { contains: search } },
          ],
        }
      : {};
    const where: any = {
      ...searchWhere,
      ...(status ? { status } : {}),
      ...(categoryId ? { categoryId } : {}),
      ...(brandId ? { brandId } : {}),
      ...(lowStock || outOfStock ? { inventories: { some: { quantity: outOfStock ? { lte: 0 } : { gt: 0 } } } } : {}),
      ...(expiry ? { batches: { some: { expiryDate: { lte: new Date(Date.now() + 30 * 86400000) } } } } : {}),
    };
    if (!branchFilterQ.branchId) delete where.branchId;
    const [total, rows] = await Promise.all([
      prisma.product.count({ where }),
      prisma.product.findMany({
        where,
        include: {
          category: true,
          brand: true,
          unit: true,
          taxRate: true,
          supplier: { select: { id: true, name: true } },
          inventories: true,
          variants: { include: { inventories: true } },
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
  "/export",
  requirePermission("products.export"),
  asyncHandler(async (req, res) => {
    const { search } = extractQuery(req.query);
    const rows = await prisma.product.findMany({
      where: search
        ? { OR: [{ name: { contains: search } }, { sku: { contains: search } }, { barcode: { contains: search } }] }
        : {},
      include: { category: true, brand: true, unit: true, taxRate: true, inventories: true },
    });
    const lines = [
      ["Name", "SKU", "Barcode", "Category", "Brand", "Unit", "Purchase Price", "Selling Price", "MRP", "Wholesale", "Stock", "Min Stock", "Max Stock", "GST %", "Status"],
      ...rows.map((p) => [
        p.name, p.sku, p.barcode || "", p.category?.name || "", p.brand?.name || "", p.unit?.shortName || "",
        p.purchasePrice, p.sellingPrice, p.mrp, p.wholesalePrice,
        p.inventories.reduce((s, i) => s + i.quantity, 0), p.minStock, p.maxStock, p.taxRate?.rate || 0, p.status,
      ]),
    ];
    const csv = lines.map((l) => l.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\r\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename=products-${Date.now()}.csv`);
    res.send("\uFEFF" + csv);
  })
);

router.post(
  "/import",
  requirePermission("products.import"),
  upload.single("file"),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new AppError(422, "CSV file required");
    const filePath = req.file.path;
    const content = fs.readFileSync(filePath, "utf-8").replace(/^\uFEFF/, "");
    fs.unlinkSync(filePath);
    const lines = content.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) throw new AppError(422, "CSV must have a header row and at least one product");
    const header = lines[0].split(",").map((h) => h.trim().replace(/^"|"$/g, ""));
    const idx = (name: string) => header.findIndex((h) => h.toLowerCase() === name.toLowerCase());
    const required = ["name"];
    for (const r of required) {
      if (idx(r) === -1) throw new AppError(422, `Missing required column: ${r}`);
    }
    const categories = await prisma.category.findMany();
    const brands = await prisma.brand.findMany();
    const units = await prisma.unit.findMany();
    const taxRates = await prisma.taxRate.findMany();
    const catByName = (n?: string) => (n ? categories.find((c) => c.name.toLowerCase() === n.toLowerCase())?.id : null);
    const brandByName = (n?: string) => (n ? brands.find((b) => b.name.toLowerCase() === n.toLowerCase())?.id : null);
    const unitByName = (n?: string) => (n ? units.find((u) => u.name.toLowerCase() === n.toLowerCase() || u.shortName.toLowerCase() === n.toLowerCase())?.id : null);
    const taxByRate = (n?: number) => (n !== undefined ? taxRates.find((t) => t.rate === n)?.id : null);

    let created = 0;
    let errors: string[] = [];
    for (let i = 1; i < lines.length; i++) {
      const cells: string[] = [];
      let cur = lines[i];
      const parts = cur.split(",");
      for (const p of parts) {
        const v = p.trim().replace(/^"|"$/g, "");
        cells.push(v);
      }
      const get = (name: string) => {
        const j = idx(name);
        return j === -1 || j >= cells.length ? "" : cells[j];
      };
      const name = get("name");
      if (!name) {
        errors.push(`Row ${i + 1}: name is required`);
        continue;
      }
      const sku = get("sku") || `SKU-${Date.now()}-${i}`;
      try {
        await prisma.product.create({
          data: {
            name,
            sku,
            barcode: get("barcode") || ean13(),
            code: get("code") || null,
            categoryId: catByName(get("category") || undefined),
            brandId: brandByName(get("brand") || undefined),
            unitId: unitByName(get("unit") || undefined),
            taxRateId: taxByRate(Number(get("gst") || undefined) || undefined),
            purchasePrice: Number(get("purchase_price") || 0),
            sellingPrice: Number(get("selling_price") || 0),
            mrp: Number(get("mrp") || 0),
            wholesalePrice: Number(get("wholesale_price") || 0),
            minStock: Number(get("min_stock") || 0),
            maxStock: Number(get("max_stock") || 0),
            description: get("description") || null,
            status: get("status") === "inactive" ? "inactive" : "active",
          },
        });
        created++;
      } catch (e: any) {
        errors.push(`Row ${i + 1} (${name}): ${e.message || "error"}`);
      }
    }
    await auditLog({ userId: req.authUserId, action: "IMPORT_PRODUCTS", module: "products", details: { created, errors: errors.length } });
    res.json({ ok: true, created, errors: errors.slice(0, 20) });
  })
);

router.post(
  "/bulk-delete",
  requirePermission("products.delete"),
  validate(z.object({ ids: z.array(z.string()).min(1) })),
  asyncHandler(async (req, res) => {
    const { ids } = getValidated<{ ids: string[] }>(req);
    await prisma.product.updateMany({ where: { id: { in: ids } }, data: { status: "inactive" } });
    await auditLog({ userId: req.authUserId, action: "BULK_DELETE_PRODUCTS", module: "products", details: { count: ids.length } });
    res.json({ ok: true, deleted: ids.length });
  })
);

router.post(
  "/bulk-price",
  requirePermission("products.price_update"),
  validate(
    z.object({
      ids: z.array(z.string()).min(1),
      field: z.enum(["sellingPrice", "purchasePrice", "mrp", "wholesalePrice"]),
      mode: z.enum(["percent", "fixed"]),
      value: z.number(),
    })
  ),
  asyncHandler(async (req, res) => {
    const data = getValidated<{ ids: string[]; field: string; mode: string; value: number }>(req);
    const products = await prisma.product.findMany({ where: { id: { in: data.ids } } });
    let updated = 0;
    for (const p of products) {
      const current = (p as any)[data.field] as number;
      const next = data.mode === "percent" ? current * (1 + data.value / 100) : Math.max(0, current + data.value);
      await prisma.product.update({ where: { id: p.id }, data: { [data.field]: Math.round(next * 100) / 100 } });
      updated++;
    }
    await auditLog({ userId: req.authUserId, action: "BULK_PRICE_UPDATE", module: "products", details: { count: updated, field: data.field, mode: data.mode, value: data.value } });
    res.json({ ok: true, updated });
  })
);

router.get(
  "/generate-barcodes",
  requirePermission("products.view"),
  asyncHandler(async (req, res) => {
    const ids = String(req.query.ids || "").split(",").filter(Boolean);
    const rows = await prisma.product.findMany({ where: { id: { in: ids } }, take: 100 });
    const html = rows
      .map(
        (p) => `<div style="display:inline-block;margin:12px;text-align:center;border:1px dashed #ccc;padding:8px">
        <div style="font-size:12px;font-family:monospace;letter-spacing:2px">${p.barcode || p.sku}</div>
        <div style="font-size:14px;font-weight:bold">${p.name}</div>
        <div style="font-size:12px">${p.sellingPrice.toFixed(2)}</div></div>`
      )
      .join("");
    res.setHeader("Content-Type", "text/html");
    res.send(
      `<html><head><title>Barcodes</title><style>body{font-family:Arial}</style></head><body onload="window.print()">${html}</body></html>`
    );
  })
);

router.get(
  "/:id",
  requirePermission("products.view"),
  asyncHandler(async (req, res) => {
    const product = await productDetail(req.params.id);
    if (!product) throw new AppError(404, "Product not found");
    res.json(product);
  })
);

router.post(
  "/",
  requirePermission("products.create"),
  validate(productSchema),
  asyncHandler(async (req, res) => {
    const data = getValidated<z.infer<typeof productSchema>>(req);
    await validateRefs(data);
    const sku = data.sku || `SKU-${Date.now()}`;
    const barcode = data.barcode || ean13();
    const product = await prisma.product.create({
      data: {
        name: data.name,
        code: data.code || null,
        sku,
        barcode,
        categoryId: data.categoryId || null,
        brandId: data.brandId || null,
        unitId: data.unitId || null,
        taxRateId: data.taxRateId || null,
        purchasePrice: data.purchasePrice,
        sellingPrice: data.sellingPrice,
        mrp: data.mrp,
        wholesalePrice: data.wholesalePrice,
        minStock: data.minStock,
        maxStock: data.maxStock,
        supplierId: data.supplierId || null,
        description: data.description || null,
        status: data.status,
        trackSerial: data.trackSerial,
        trackBatch: data.trackBatch,
        image: data.image || null,
        hasVariants: data.variants.length > 0,
        branchId: req.auth?.branchId || null,
        variants: {
          create: data.variants.map((v) => ({
            name: v.name,
            sku: v.sku || null,
            barcode: v.barcode || null,
            sellingPrice: v.sellingPrice,
            purchasePrice: v.purchasePrice,
            mrp: v.mrp,
          })),
        },
      },
    });
    await applyStockMovement(prisma, {
      productId: product.id,
      branchId: product.branchId,
      type: "opening",
      quantity: 0,
      userId: req.authUserId,
      note: "Product created",
    });
    await auditLog({ userId: req.authUserId, action: "CREATE_PRODUCT", module: "products", entityId: product.id, details: { name: product.name } });
    res.status(201).json({ ok: true, id: product.id, sku, barcode });
  })
);

const productUpdateSchema = productSchema.partial().extend({
  variants: z
    .array(
      z.object({
        id: z.string().optional(),
        name: z.string().min(1),
        sku: z.string().nullable().optional(),
        barcode: z.string().nullable().optional(),
        sellingPrice: z.number(),
        purchasePrice: z.number().default(0),
        mrp: z.number().default(0),
      })
    )
    .optional(),
});

router.put(
  "/:id",
  requirePermission("products.edit"),
  validate(productUpdateSchema),
  asyncHandler(async (req, res) => {
    const data = getValidated<z.infer<typeof productUpdateSchema>>(req);
    const existing = await prisma.product.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new AppError(404, "Product not found");
    await validateRefs(data as any);
    const updateData: any = {
      name: data.name,
      code: data.code ?? null,
      categoryId: data.categoryId ?? null,
      brandId: data.brandId ?? null,
      unitId: data.unitId ?? null,
      taxRateId: data.taxRateId ?? null,
      purchasePrice: data.purchasePrice,
      sellingPrice: data.sellingPrice,
      mrp: data.mrp,
      wholesalePrice: data.wholesalePrice,
      minStock: data.minStock,
      maxStock: data.maxStock,
      supplierId: data.supplierId ?? null,
      description: data.description ?? null,
      status: data.status,
      trackSerial: data.trackSerial,
      trackBatch: data.trackBatch,
      image: data.image ?? null,
    };
    if (data.sku && data.sku !== existing.sku) updateData.sku = data.sku;
    if (data.barcode && data.barcode !== existing.barcode) updateData.barcode = data.barcode;
    if (data.variants) {
      updateData.hasVariants = data.variants.length > 0;
      updateData.variants = {
        deleteMany: {},
        create: data.variants.map((v) => ({
          name: v.name,
          sku: v.sku || null,
          barcode: v.barcode || null,
          sellingPrice: v.sellingPrice,
          purchasePrice: v.purchasePrice,
          mrp: v.mrp,
        })),
      };
    }
    await prisma.product.update({ where: { id: req.params.id }, data: updateData });
    await auditLog({ userId: req.authUserId, action: "UPDATE_PRODUCT", module: "products", entityId: req.params.id });
    res.json({ ok: true });
  })
);

router.delete(
  "/:id",
  requirePermission("products.delete"),
  asyncHandler(async (req, res) => {
    await prisma.product.update({ where: { id: req.params.id }, data: { status: "inactive" } });
    await auditLog({ userId: req.authUserId, action: "DELETE_PRODUCT", module: "products", entityId: req.params.id });
    res.json({ ok: true });
  })
);

export default router;