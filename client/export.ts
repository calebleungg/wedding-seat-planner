// Snapshots of a plan for download: a JSON file that holds everything, and a CSV of who sits where.
// Pure functions over the plan state so they can be tested without a browser.
import type { PlanState } from './store';

export const EXPORT_FORMAT = 'wedding-seat-planner/plan@1';

export interface PlanExport {
  format: typeof EXPORT_FORMAT;
  exportedAt: string;
  slug: string;
  plan: { name: string } | null;
  tables: { id: string; name: string; shape: string; seats: number; x: number; y: number; rotation: number }[];
  guests: { id: string; name: string; tableId?: string; seat?: number; look: number; style?: string }[];
}

/** The whole plan as plain data: the Convex ids are kept so guests can be matched back to tables. */
export function planToJson(state: PlanState, slug: string, now = new Date()): PlanExport {
  return {
    format: EXPORT_FORMAT,
    exportedAt: now.toISOString(),
    slug,
    plan: state.plan ? { name: state.plan.name } : null,
    tables: sortedTables(state).map((t) => ({ id: t._id, name: t.name, shape: t.shape, seats: t.seats, x: t.x, y: t.y, rotation: t.rotation })),
    guests: state.guests.map((g) => ({ id: g._id, name: g.name, tableId: g.tableId, seat: g.seat, look: g.look, style: g.style })),
  };
}

/**
 * One row per guest: name, table and seat (1-based). Seated guests come first, grouped by table in
 * the order of the table names, then the unseated in name order. Empty seats are not listed.
 */
export function planToCsv(state: PlanState): string {
  const tables = sortedTables(state);
  const order = new Map(tables.map((t, i) => [t._id as string, i]));
  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, undefined, { numeric: true });
  const guests = [...state.guests].sort((a, b) => {
    const ta = a.tableId ? order.get(a.tableId) ?? Infinity : Infinity;
    const tb = b.tableId ? order.get(b.tableId) ?? Infinity : Infinity;
    if (ta !== tb) return ta - tb;
    if (ta !== Infinity) return (a.seat ?? 0) - (b.seat ?? 0);
    return byName(a, b);
  });
  const name = (id: string | undefined) => tables.find((t) => t._id === id)?.name ?? '';
  const rows = [
    ['Guest', 'Table', 'Seat'],
    ...guests.map((g) => [g.name, name(g.tableId), g.tableId && g.seat !== undefined ? String(g.seat + 1) : '']),
  ];
  return rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

/** A file name like `our-wedding-2026-11-08-1432.json`, built from the plan's name or slug. */
export function exportFileName(state: PlanState, slug: string, ext: 'json' | 'csv', now = new Date()): string {
  const base = (state.plan?.name || slug).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'plan';
  const p = (n: number) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}`;
  return `${base}-${stamp}.${ext}`;
}

function sortedTables(state: PlanState) {
  return [...state.tables].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
}

function csvCell(s: string): string {
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
