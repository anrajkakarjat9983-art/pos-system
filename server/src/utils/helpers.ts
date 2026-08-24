import { prisma } from "../db.js";

export function extractQuery(query: Record<string, unknown>) {
  const search = typeof query.search === "string" ? query.search.trim() : "";
  const page = Number(query.page) || 1;
  const pageSize = Math.min(200, Math.max(1, Number(query.pageSize) || 20));
  const sortBy = typeof query.sortBy === "string" ? query.sortBy : "createdAt";
  const sortOrder = query.sortOrder === "asc" ? "asc" : "desc";
  const from = typeof query.from === "string" ? new Date(query.from) : null;
  const to = typeof query.to === "string" ? new Date(query.to) : null;
  const status = typeof query.status === "string" && query.status ? query.status : null;
  return { search, page, pageSize, sortBy, sortOrder, from, to, status };
}

export function hasRole(req: { auth?: { roleName?: string } }, names: string[]) {
  return req.auth?.roleName ? names.includes(req.auth.roleName) : false;
}

export function branchFilter(req: { auth?: { roleName?: string; branchId?: string | null } }) {
  if (req.auth?.roleName === "Super Admin") return {};
  return req.auth?.branchId ? { branchId: req.auth.branchId } : {};
}