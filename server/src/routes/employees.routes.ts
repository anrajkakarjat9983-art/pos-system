import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";
import { validate, getValidated } from "../middleware/validate.js";
import { asyncHandler, AppError } from "../middleware/error.js";
import { auditLog } from "../utils/audit.js";
import { extractQuery } from "../utils/helpers.js";
import { dateStart, dateEnd } from "../utils/numbers.js";

const router = Router();
router.use(requireAuth);

const employeeSchema = z.object({
  userId: z.string().nullable().optional(),
  name: z.string().min(1),
  phone: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  designation: z.string().nullable().optional(),
  salary: z.number().default(0),
  joiningDate: z.string().nullable().optional(),
  status: z.string().default("active"),
});

router.get(
  "/",
  requirePermission("employees.view"),
  asyncHandler(async (req, res) => {
    const { search, page, pageSize } = extractQuery(req.query);
    const where = search
      ? { OR: [{ name: { contains: search } }, { phone: { contains: search } }, { designation: { contains: search } }] }
      : {};
    const [total, rows] = await Promise.all([
      prisma.employee.count({ where }),
      prisma.employee.findMany({
        where,
        include: { user: { select: { name: true, email: true, role: { select: { name: true } } } } },
        orderBy: { name: "asc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    res.json({ data: rows, total, page, pageSize });
  })
);

router.post(
  "/",
  requirePermission("employees.manage"),
  validate(employeeSchema),
  asyncHandler(async (req, res) => {
    const data = getValidated<z.infer<typeof employeeSchema>>(req);
    const employee = await prisma.employee.create({
      data: {
        userId: data.userId || null,
        name: data.name,
        phone: data.phone || null,
        email: data.email || null,
        designation: data.designation || null,
        salary: data.salary,
        joiningDate: data.joiningDate ? new Date(data.joiningDate) : null,
        status: data.status,
      },
    });
    await auditLog({ userId: req.authUserId, action: "CREATE_EMPLOYEE", module: "employees", entityId: employee.id });
    res.status(201).json({ ok: true, id: employee.id });
  })
);

const employeeUpdateSchema = employeeSchema.partial();
router.put(
  "/:id",
  requirePermission("employees.manage"),
  validate(employeeUpdateSchema),
  asyncHandler(async (req, res) => {
    const data = getValidated<z.infer<typeof employeeUpdateSchema>>(req);
    await prisma.employee.update({
      where: { id: req.params.id },
      data: {
        ...data,
        joiningDate: data.joiningDate ? new Date(data.joiningDate) : undefined,
      },
    });
    await auditLog({ userId: req.authUserId, action: "UPDATE_EMPLOYEE", module: "employees", entityId: req.params.id });
    res.json({ ok: true });
  })
);

router.delete(
  "/:id",
  requirePermission("employees.manage"),
  asyncHandler(async (req, res) => {
    await prisma.employee.update({ where: { id: req.params.id }, data: { status: "inactive" } });
    await auditLog({ userId: req.authUserId, action: "DELETE_EMPLOYEE", module: "employees", entityId: req.params.id });
    res.json({ ok: true });
  })
);

// ---------- Attendance ----------

const attendanceSchema = z.object({
  employeeId: z.string().min(1),
  date: z.string().min(1),
  status: z.string().default("present"),
  checkIn: z.string().nullable().optional(),
  checkOut: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
});

router.get(
  "/attendance",
  requirePermission("employees.view"),
  asyncHandler(async (req, res) => {
    const { search, page, pageSize, from, to } = extractQuery(req.query);
    const dateFilter = from || to ? { date: { gte: from ? dateStart(from) : undefined, lte: to ? dateEnd(to) : undefined } } : {};
    const where = {
      ...dateFilter,
      ...(search ? { employee: { name: { contains: search } } } : {}),
    };
    const [total, rows] = await Promise.all([
      prisma.attendance.count({ where }),
      prisma.attendance.findMany({
        where,
        include: { employee: { select: { name: true, designation: true } } },
        orderBy: { date: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    res.json({ data: rows, total, page, pageSize });
  })
);

router.post(
  "/attendance",
  requirePermission("employees.manage"),
  validate(attendanceSchema),
  asyncHandler(async (req, res) => {
    const data = getValidated<z.infer<typeof attendanceSchema>>(req);
    const date = new Date(data.date);
    await prisma.attendance.upsert({
      where: { employeeId_date: { employeeId: data.employeeId, date } },
      update: {
        status: data.status,
        checkIn: data.checkIn ? new Date(data.checkIn) : null,
        checkOut: data.checkOut ? new Date(data.checkOut) : null,
        note: data.note || null,
      },
      create: {
        employeeId: data.employeeId,
        date,
        status: data.status,
        checkIn: data.checkIn ? new Date(data.checkIn) : null,
        checkOut: data.checkOut ? new Date(data.checkOut) : null,
        note: data.note || null,
      },
    });
    await auditLog({ userId: req.authUserId, action: "SAVE_ATTENDANCE", module: "employees", details: data });
    res.json({ ok: true });
  })
);

export default router;