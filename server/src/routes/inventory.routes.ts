import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";
import { validate, getValidated } from "../middleware/validate.js";
import { asyncHandler, AppError } from "../middleware/error.js";
import { auditLog } from "../utils/audit.js";
import { extractQuery, branchFilter } from "../utils/helpers.js";
import { applyStockMovement, getStock } from "../utils/inventory.js";
import { nextTransferNo } from "../utils/reference.js";

const router = Router();
router.use(requireAuth);

router.get(
  "/stock",
  requirePermission("inventory.view"),
  asyncHandler(async (req, res) => {
    const { search, page, pageSize, sortBy, sortOrder } = extractQuery(req.query);
    const categoryId = typeof req.query.categoryId === "string" && req.query.categoryId ? req.query.categoryId : null;
    const low = req.query.low === "true";
    const out = req.query.out === "true";
    const branchId = req.auth?.branchId || null;
    const where: any = {
      ...(search ? { OR: [{ name: { contains: search } }, { sku: { contains: search } }, { barcode: { contains: search } }] } : {}),
      ...(categoryId ? { categoryId } : {}),
      ...(low || out ? { inventories: { some: { quantity: out ? { lte: 0 } : { gt: 0 } } } } : {}),
    };
    const [total, rows] = await Promise.all([
      prisma.product.count({ where }),
      prisma.product.findMany({
        where,
        include: {
          category: true,
          unit: true,
          inventories: { where: { branchId } },
          variants: { include: { inventories: { where: { branchId } } } },
        },
        orderBy: { [sortBy]: sortOrder },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    const data = rows.map((p) => {
      const stock = p.inventories.reduce((s, i) => s + i.quantity, 0);
      return {
        id: p.id,
        name: p.name,
        sku: p.sku,
        barcode: p.barcode,
        category: p.category?.name || "",
        unit: p.unit?.shortName || "pcs",
        stock,
        minStock: p.minStock,
        maxStock: p.maxStock,
        purchasePrice: p.purchasePrice,
        sellingPrice: p.sellingPrice,
        value: stock * p.purchasePrice,
        status: stock <= 0 ? "out" : stock <= p.minStock ? "low" : "ok",
        variants: p.variants.map((v) => ({
          id: v.id,
          name: v.name,
          stock: v.inventories.reduce((s, i) => s + i.quantity, 0),
        })),
      };
    });
    res.json({ data, total, page, pageSize });
  })
);

router.get(
  "/movements",
  requirePermission("inventory.view"),
  asyncHandler(async (req, res) => {
    const { search, page, pageSize, from, to } = extractQuery(req.query);
    const type = typeof req.query.type === "string" && req.query.type ? req.query.type : null;
    const where: any = {
      ...branchFilter(req),
      ...(type ? { type } : {}),
      ...(from || to ? { createdAt: { gte: from ?? undefined, lte: to ?? undefined } } : {}),
      ...(search ? { product: { name: { contains: search } } } : {}),
    };
    const [total, rows] = await Promise.all([
      prisma.stockMovement.count({ where }),
      prisma.stockMovement.findMany({
        where,
        include: {
          product: { select: { id: true, name: true, sku: true } },
          variant: { select: { name: true } },
          user: { select: { name: true } },
          branch: { select: { name: true } },
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    res.json({ data: rows, total, page, pageSize });
  })
);

const adjustSchema = z.object({
  productId: z.string().min(1),
  variantId: z.string().nullable().optional(),
  type: z.enum(["adjustment", "damaged", "lost", "expired", "opening"]),
  quantity: z.number(), // signed
  note: z.string().nullable().optional(),
});

router.post(
  "/adjust",
  requirePermission("inventory.adjust"),
  validate(adjustSchema),
  asyncHandler(async (req, res) => {
    const data = getValidated<z.infer<typeof adjustSchema>>(req);
    const product = await prisma.product.findUnique({ where: { id: data.productId } });
    if (!product) throw new AppError(404, "Product not found");
    const branchId = req.auth?.branchId || null;
    const current = await getStock(data.productId, data.variantId || null, branchId);
    if (current + data.quantity < 0) throw new AppError(422, "Adjustment would make stock negative");
    await applyStockMovement(prisma, {
      productId: data.productId,
      variantId: data.variantId || null,
      branchId,
      type: data.type,
      quantity: data.quantity,
      userId: req.authUserId,
      referenceType: "adjustment",
      note: data.note || `Stock ${data.type}`,
    });
    await auditLog({
      userId: req.authUserId,
      action: "STOCK_ADJUST",
      module: "inventory",
      entityId: data.productId,
      details: { type: data.type, quantity: data.quantity },
    });
    res.json({ ok: true });
  })
);

const transferSchema = z.object({
  toBranchId: z.string().min(1),
  items: z.array(z.object({ productId: z.string().min(1), variantId: z.string().nullable().optional(), quantity: z.number().positive() })).min(1),
  note: z.string().nullable().optional(),
});

router.post(
  "/transfers",
  requirePermission("inventory.transfer"),
  validate(transferSchema),
  asyncHandler(async (req, res) => {
    const data = getValidated<z.infer<typeof transferSchema>>(req);
    const fromBranchId = req.auth?.branchId;
    if (!fromBranchId) throw new AppError(400, "Your account is not assigned to a branch");
    if (fromBranchId === data.toBranchId) throw new AppError(422, "Cannot transfer to the same branch");
    const transferNo = await nextTransferNo();
    const result = await prisma.$transaction(async (tx) => {
      const t = await tx.stockTransfer.create({
        data: {
          transferNo,
          fromBranchId,
          toBranchId: data.toBranchId,
          userId: req.authUserId,
          note: data.note || null,
          items: {
            create: data.items.map((it) => ({
              productId: it.productId,
              variantId: it.variantId || null,
              quantity: it.quantity,
            })),
          },
        },
      });
      for (const it of data.items) {
        await applyStockMovement(tx, {
          productId: it.productId,
          variantId: it.variantId || null,
          branchId: fromBranchId,
          type: "transfer_out",
          quantity: -it.quantity,
          userId: req.authUserId,
          referenceType: "stock_transfer",
          referenceId: t.id,
          note: `Transfer ${transferNo}`,
        });
      }
      await tx.auditLog.create({
        data: {
          userId: req.authUserId,
          action: "CREATE_TRANSFER",
          module: "inventory",
          entityType: "stockTransfer",
          entityId: t.id,
        },
      });
      return t;
    });
    res.status(201).json({ ok: true, id: result.id, transferNo });
  })
);

router.get(
  "/transfers",
  requirePermission("inventory.view"),
  asyncHandler(async (req, res) => {
    const { page, pageSize, status } = extractQuery(req.query);
    const where: any = {
      ...(status ? { status } : {}),
      ...(req.auth?.branchId ? { OR: [{ fromBranchId: req.auth.branchId }, { toBranchId: req.auth.branchId }] } : {}),
    };
    const [total, rows] = await Promise.all([
      prisma.stockTransfer.count({ where }),
      prisma.stockTransfer.findMany({
        where,
        include: {
          fromBranch: { select: { name: true } },
          toBranch: { select: { name: true } },
          items: { include: { product: { select: { name: true } }, variant: { select: { name: true } } } },
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    res.json({ data: rows, total, page, pageSize });
  })
);

router.post(
  "/transfers/:id/receive",
  requirePermission("inventory.transfer"),
  asyncHandler(async (req, res) => {
    const transfer = await prisma.stockTransfer.findUnique({
      where: { id: req.params.id },
      include: { items: true },
    });
    if (!transfer) throw new AppError(404, "Transfer not found");
    if (transfer.status !== "pending" && transfer.status !== "in_transit") throw new AppError(400, "Transfer already received");
    if (transfer.toBranchId !== req.auth?.branchId) throw new AppError(403, "This transfer is not addressed to your branch");
    await prisma.$transaction(async (tx) => {
      await tx.stockTransfer.update({
        where: { id: transfer.id },
        data: { status: "received", receivedAt: new Date() },
      });
      for (const it of transfer.items) {
        await applyStockMovement(tx, {
          productId: it.productId!,
          variantId: it.variantId,
          branchId: transfer.toBranchId,
          type: "transfer_in",
          quantity: it.quantity,
          userId: req.authUserId,
          referenceType: "stock_transfer",
          referenceId: transfer.id,
          note: `Receive ${transfer.transferNo}`,
        });
        await tx.stockTransferItem.update({
          where: { id: it.id },
          data: { receivedQuantity: it.quantity },
        });
      }
      await tx.auditLog.create({
        data: {
          userId: req.authUserId,
          action: "RECEIVE_TRANSFER",
          module: "inventory",
          entityType: "stockTransfer",
          entityId: transfer.id,
        },
      });
    });
    res.json({ ok: true });
  })
);

router.post(
  "/transfers/:id/cancel",
  requirePermission("inventory.transfer"),
  asyncHandler(async (req, res) => {
    const transfer = await prisma.stockTransfer.findUnique({ where: { id: req.params.id } });
    if (!transfer) throw new AppError(404, "Transfer not found");
    if (transfer.status !== "pending") throw new AppError(400, "Only pending transfers can be cancelled");
    await prisma.$transaction(async (tx) => {
      await tx.stockTransfer.update({ where: { id: transfer.id }, data: { status: "cancelled" } });
      const items = await tx.stockTransferItem.findMany({ where: { transferId: transfer.id } });
      for (const it of items) {
        await applyStockMovement(tx, {
          productId: it.productId!,
          variantId: it.variantId,
          branchId: transfer.fromBranchId,
          type: "adjustment",
          quantity: it.quantity,
          userId: req.authUserId,
          referenceType: "stock_transfer",
          referenceId: transfer.id,
          note: `Transfer ${transfer.transferNo} cancelled - stock restored`,
        });
      }
    });
    await auditLog({ userId: req.authUserId, action: "CANCEL_TRANSFER", module: "inventory", entityId: transfer.id });
    res.json({ ok: true });
  })
);

router.get(
  "/batches",
  requirePermission("inventory.view"),
  asyncHandler(async (req, res) => {
    const rows = await prisma.productBatch.findMany({
      where: { quantity: { gt: 0 } },
      include: { product: { select: { name: true, sku: true } } },
      orderBy: { expiryDate: "asc" },
      take: 200,
    });
    res.json(rows);
  })
);

export default router;