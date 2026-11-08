// The Convex connection. One subscription to the whole plan; mutations are thin wrappers that
// always pass the plan slug from the URL.
import { ConvexClient } from 'convex/browser';
import { api } from '../convex/_generated/api';
import type { Doc, Id } from '../convex/_generated/dataModel';

export type Table = Doc<'tables'>;
export type Guest = Doc<'guests'>;
export type Plan = Doc<'plans'>;
export type Shape = Table['shape'];

export interface PlanState {
  plan: Plan | null;
  tables: Table[];
  guests: Guest[];
}

export const EMPTY: PlanState = { plan: null, tables: [], guests: [] };

/** The plan slug comes from `?plan=` so a couple can share one link and keep several drafts. */
export function slugFromUrl(): string {
  const q = new URLSearchParams(location.search).get('plan');
  return (q ?? 'default').trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'default';
}

export class Store {
  state: PlanState = EMPTY;
  connected = false;
  error: string | null = null;
  private listeners = new Set<(s: PlanState) => void>();
  private client: ConvexClient;
  readonly slug: string;

  constructor(url: string, slug: string) {
    this.slug = slug;
    this.client = new ConvexClient(url);
    this.client.onUpdate(
      api.plans.get,
      { slug },
      (value) => {
        this.connected = true;
        this.error = null;
        this.state = value as PlanState;
        this.emit();
      },
      (err) => {
        this.error = err.message;
        this.emit();
      },
    );
    // make sure the plan row exists so the header can show its name
    void this.client.mutation(api.plans.open, { slug }).catch((e) => {
      this.error = String(e?.message ?? e);
      this.emit();
    });
  }

  subscribe(fn: (s: PlanState) => void): () => void {
    this.listeners.add(fn);
    fn(this.state);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    for (const fn of this.listeners) fn(this.state);
  }

  table(id: Id<'tables'> | string | undefined | null): Table | undefined {
    return id ? this.state.tables.find((t) => t._id === id) : undefined;
  }
  guest(id: Id<'guests'> | string | undefined | null): Guest | undefined {
    return id ? this.state.guests.find((g) => g._id === id) : undefined;
  }
  guestsAt(tableId: Id<'tables'>): Guest[] {
    return this.state.guests.filter((g) => g.tableId === tableId);
  }

  private run<T>(p: Promise<T>): Promise<T | undefined> {
    return p.catch((e) => {
      this.error = String(e?.message ?? e);
      this.emit();
      console.error(e);
      return undefined;
    });
  }

  addTable(shape: Shape, seats: number, x: number, y: number, rotation = 0, name?: string) {
    return this.run(this.client.mutation(api.plans.addTable, { slug: this.slug, shape, seats, x, y, rotation, name }));
  }
  moveTable(tableId: Id<'tables'>, x: number, y: number) {
    return this.run(this.client.mutation(api.plans.moveTable, { slug: this.slug, tableId, x, y }));
  }
  updateTable(tableId: Id<'tables'>, patch: { name?: string; shape?: Shape; seats?: number; rotation?: number }) {
    return this.run(this.client.mutation(api.plans.updateTable, { slug: this.slug, tableId, ...patch }));
  }
  removeTable(tableId: Id<'tables'>) {
    return this.run(this.client.mutation(api.plans.removeTable, { slug: this.slug, tableId }));
  }
  addGuest(name: string) {
    return this.run(this.client.mutation(api.plans.addGuest, { slug: this.slug, name }));
  }
  addGuests(names: string[]) {
    return this.run(this.client.mutation(api.plans.addGuests, { slug: this.slug, names }));
  }
  renameGuest(guestId: Id<'guests'>, name: string) {
    return this.run(this.client.mutation(api.plans.renameGuest, { slug: this.slug, guestId, name }));
  }
  removeGuest(guestId: Id<'guests'>) {
    return this.run(this.client.mutation(api.plans.removeGuest, { slug: this.slug, guestId }));
  }
  seatGuest(guestId: Id<'guests'>, tableId: Id<'tables'>, seat?: number) {
    return this.run(this.client.mutation(api.plans.seatGuest, { slug: this.slug, guestId, tableId, seat }));
  }
  unseatGuest(guestId: Id<'guests'>) {
    return this.run(this.client.mutation(api.plans.unseatGuest, { slug: this.slug, guestId }));
  }
  renamePlan(name: string) {
    return this.run(this.client.mutation(api.plans.renamePlan, { slug: this.slug, name }));
  }
}
