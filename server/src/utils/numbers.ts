export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function roundOff(n: number): { value: number; roundOff: number } {
  const rounded = Math.round(n);
  return { value: rounded, roundOff: round2(rounded - n) };
}

export function todayStart(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export function todayEnd(): Date {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d;
}

export function dateStart(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function dateEnd(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

export function rangeFor(period: string, from?: string, to?: string): { from: Date; to: Date } {
  const now = new Date();
  switch (period) {
    case "today":
      return { from: todayStart(), to: todayEnd() };
    case "yesterday": {
      const y = new Date(now);
      y.setDate(y.getDate() - 1);
      return { from: dateStart(y), to: dateEnd(y) };
    }
    case "7d": {
      const f = new Date(now);
      f.setDate(f.getDate() - 6);
      return { from: dateStart(f), to: todayEnd() };
    }
    case "30d": {
      const f = new Date(now);
      f.setDate(f.getDate() - 29);
      return { from: dateStart(f), to: todayEnd() };
    }
    case "month": {
      const f = new Date(now.getFullYear(), now.getMonth(), 1);
      return { from: f, to: todayEnd() };
    }
    case "custom": {
      const f = from ? new Date(from) : dateStart(new Date(now.getTime() - 30 * 86400000));
      const t = to ? new Date(to) : todayEnd();
      return { from: dateStart(f), to: dateEnd(t) };
    }
    default:
      return { from: dateStart(now), to: todayEnd() };
  }
}

export function paginate(page = 1, pageSize = 20) {
  const p = Math.max(1, Number(page) || 1);
  const ps = Math.min(200, Math.max(1, Number(pageSize) || 20));
  return { skip: (p - 1) * ps, take: ps, page: p, pageSize: ps };
}

export function toISO(date?: Date | string | null): string | null {
  if (!date) return null;
  const d = typeof date === "string" ? new Date(date) : date;
  return isNaN(d.getTime()) ? null : d.toISOString();
}