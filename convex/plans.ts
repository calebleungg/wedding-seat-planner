import { mutation, query, type MutationCtx, type QueryCtx } from './_generated/server';
import { v } from 'convex/values';
import type { Id } from './_generated/dataModel';
import { shape, style } from './schema';

export const MIN_SEATS = 0;
export const MAX_SEATS = 20;

function normaliseSlug(slug: string): string {
  const s = slug.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  return s || 'default';
}

async function planBySlug(ctx: QueryCtx, slug: string) {
  return ctx.db
    .query('plans')
    .withIndex('by_slug', (q) => q.eq('slug', normaliseSlug(slug)))
    .unique();
}

/** Finds the plan for a slug, creating an empty one on first visit. */
async function ensurePlan(ctx: MutationCtx, slug: string): Promise<Id<'plans'>> {
  const existing = await planBySlug(ctx, slug);
  if (existing) return existing._id;
  const clean = normaliseSlug(slug);
  return ctx.db.insert('plans', { slug: clean, name: clean });
}

async function tableInPlan(ctx: MutationCtx, planId: Id<'plans'>, tableId: Id<'tables'>) {
  const table = await ctx.db.get(tableId);
  if (!table || table.planId !== planId) throw new Error('no such table in this plan');
  return table;
}

async function guestInPlan(ctx: MutationCtx, planId: Id<'plans'>, guestId: Id<'guests'>) {
  const guest = await ctx.db.get(guestId);
  if (!guest || guest.planId !== planId) throw new Error('no such guest in this plan');
  return guest;
}

/** The whole plan: tables and guests. The client subscribes to this once. */
export const get = query({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const plan = await planBySlug(ctx, slug);
    if (!plan) return { plan: null, tables: [], guests: [] };
    const [tables, guests] = await Promise.all([
      ctx.db.query('tables').withIndex('by_plan', (q) => q.eq('planId', plan._id)).collect(),
      ctx.db.query('guests').withIndex('by_plan', (q) => q.eq('planId', plan._id)).collect(),
    ]);
    return { plan, tables, guests };
  },
});

export const open = mutation({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => ensurePlan(ctx, slug),
});

export const addTable = mutation({
  args: { slug: v.string(), shape, seats: v.number(), x: v.number(), y: v.number(), rotation: v.optional(v.number()), name: v.optional(v.string()) },
  handler: async (ctx, { slug, shape, seats, x, y, rotation, name }) => {
    const planId = await ensurePlan(ctx, slug);
    const count = (await ctx.db.query('tables').withIndex('by_plan', (q) => q.eq('planId', planId)).collect()).length;
    return ctx.db.insert('tables', {
      planId,
      name: name?.trim() || `Table ${count + 1}`,
      shape,
      seats: clampSeats(seats),
      x,
      y,
      rotation: rotation ?? 0,
    });
  },
});

export const moveTable = mutation({
  args: { slug: v.string(), tableId: v.id('tables'), x: v.number(), y: v.number() },
  handler: async (ctx, { slug, tableId, x, y }) => {
    const planId = await ensurePlan(ctx, slug);
    await tableInPlan(ctx, planId, tableId);
    await ctx.db.patch(tableId, { x, y });
  },
});

export const updateTable = mutation({
  args: {
    slug: v.string(),
    tableId: v.id('tables'),
    name: v.optional(v.string()),
    shape: v.optional(shape),
    seats: v.optional(v.number()),
    rotation: v.optional(v.number()),
  },
  handler: async (ctx, { slug, tableId, name, shape, seats, rotation }) => {
    const planId = await ensurePlan(ctx, slug);
    const table = await tableInPlan(ctx, planId, tableId);
    const patch: Partial<typeof table> = {};
    if (name !== undefined && name.trim()) patch.name = name.trim();
    if (shape !== undefined) patch.shape = shape;
    if (rotation !== undefined) patch.rotation = rotation;
    if (seats !== undefined) {
      patch.seats = clampSeats(seats);
      // Seats that no longer exist send their guests back to the list.
      const seated = await ctx.db.query('guests').withIndex('by_table', (q) => q.eq('tableId', tableId)).collect();
      for (const g of seated) {
        if (g.seat !== undefined && g.seat >= patch.seats) await ctx.db.patch(g._id, { tableId: undefined, seat: undefined });
      }
    }
    await ctx.db.patch(tableId, patch);
  },
});

export const removeTable = mutation({
  args: { slug: v.string(), tableId: v.id('tables') },
  handler: async (ctx, { slug, tableId }) => {
    const planId = await ensurePlan(ctx, slug);
    await tableInPlan(ctx, planId, tableId);
    const seated = await ctx.db.query('guests').withIndex('by_table', (q) => q.eq('tableId', tableId)).collect();
    for (const g of seated) await ctx.db.patch(g._id, { tableId: undefined, seat: undefined });
    await ctx.db.delete(tableId);
  },
});

export const addGuest = mutation({
  args: { slug: v.string(), name: v.string(), style: v.optional(style) },
  handler: async (ctx, { slug, name, style }) => {
    const planId = await ensurePlan(ctx, slug);
    const clean = name.trim();
    if (!clean) throw new Error('a guest needs a name');
    return ctx.db.insert('guests', { planId, name: clean, look: Math.floor(Math.random() * 1_000_000), style });
  },
});

/** Sets how a guest's character dresses; null goes back to the look number's own choice. */
export const setGuestStyle = mutation({
  args: { slug: v.string(), guestId: v.id('guests'), style: v.union(style, v.null()) },
  handler: async (ctx, { slug, guestId, style }) => {
    const planId = await ensurePlan(ctx, slug);
    await guestInPlan(ctx, planId, guestId);
    await ctx.db.patch(guestId, { style: style ?? undefined });
  },
});

/** The same for many guests at once, matched by exact name. Returns the names not found. */
export const setGuestStyles = mutation({
  args: { slug: v.string(), items: v.array(v.object({ name: v.string(), style: v.union(style, v.null()) })) },
  handler: async (ctx, { slug, items }) => {
    const planId = await ensurePlan(ctx, slug);
    const guests = await ctx.db.query('guests').withIndex('by_plan', (q) => q.eq('planId', planId)).collect();
    const missing: string[] = [];
    for (const item of items) {
      const g = guests.find((x) => x.name === item.name);
      if (!g) { missing.push(item.name); continue; }
      await ctx.db.patch(g._id, { style: item.style ?? undefined });
    }
    return missing;
  },
});

/** Adds many guests at once, one per line of text. Blank lines are skipped. */
export const addGuests = mutation({
  args: { slug: v.string(), names: v.array(v.string()) },
  handler: async (ctx, { slug, names }) => {
    const planId = await ensurePlan(ctx, slug);
    let n = 0;
    for (const raw of names) {
      const name = raw.trim();
      if (!name) continue;
      await ctx.db.insert('guests', { planId, name, look: Math.floor(Math.random() * 1_000_000) });
      n++;
    }
    return n;
  },
});

export const renameGuest = mutation({
  args: { slug: v.string(), guestId: v.id('guests'), name: v.string() },
  handler: async (ctx, { slug, guestId, name }) => {
    const planId = await ensurePlan(ctx, slug);
    await guestInPlan(ctx, planId, guestId);
    if (name.trim()) await ctx.db.patch(guestId, { name: name.trim() });
  },
});

export const removeGuest = mutation({
  args: { slug: v.string(), guestId: v.id('guests') },
  handler: async (ctx, { slug, guestId }) => {
    const planId = await ensurePlan(ctx, slug);
    await guestInPlan(ctx, planId, guestId);
    await ctx.db.delete(guestId);
  },
});

/**
 * Seats a guest at a table. With a seat index, that seat is taken (swapping with whoever had it);
 * without one, the first free seat. Returns false when the table is full.
 */
export const seatGuest = mutation({
  args: { slug: v.string(), guestId: v.id('guests'), tableId: v.id('tables'), seat: v.optional(v.number()) },
  handler: async (ctx, { slug, guestId, tableId, seat }) => {
    const planId = await ensurePlan(ctx, slug);
    const guest = await guestInPlan(ctx, planId, guestId);
    const table = await tableInPlan(ctx, planId, tableId);
    const seated = await ctx.db.query('guests').withIndex('by_table', (q) => q.eq('tableId', tableId)).collect();
    const taken = new Map(seated.map((g) => [g.seat, g] as const));
    let target = seat;
    if (target === undefined || target < 0 || target >= table.seats) {
      target = undefined;
      for (let i = 0; i < table.seats; i++) if (!taken.has(i)) { target = i; break; }
      if (target === undefined) return false;
    }
    const occupant = taken.get(target);
    if (occupant && occupant._id !== guestId) {
      // swap: the occupant takes the incoming guest's old place (or the list)
      await ctx.db.patch(occupant._id, { tableId: guest.tableId, seat: guest.seat });
    }
    await ctx.db.patch(guestId, { tableId, seat: target });
    return true;
  },
});

export const unseatGuest = mutation({
  args: { slug: v.string(), guestId: v.id('guests') },
  handler: async (ctx, { slug, guestId }) => {
    const planId = await ensurePlan(ctx, slug);
    await guestInPlan(ctx, planId, guestId);
    await ctx.db.patch(guestId, { tableId: undefined, seat: undefined });
  },
});

export const renamePlan = mutation({
  args: { slug: v.string(), name: v.string() },
  handler: async (ctx, { slug, name }) => {
    const planId = await ensurePlan(ctx, slug);
    if (name.trim()) await ctx.db.patch(planId, { name: name.trim() });
  },
});

function clampSeats(n: number): number {
  return Math.max(MIN_SEATS, Math.min(MAX_SEATS, Math.round(n)));
}
