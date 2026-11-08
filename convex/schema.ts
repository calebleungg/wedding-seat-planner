import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

// A plan is one seating chart, addressed by a slug in the page URL. Tables sit on the venue floor in
// world pixels; guests either have a table and seat index or are waiting in the guest list.
export const shape = v.union(v.literal('round'), v.literal('rect'));
/** How a guest's character dresses: feminine, masculine, or whatever the look number gives. */
export const style = v.union(v.literal('fem'), v.literal('masc'));

export default defineSchema({
  plans: defineTable({
    slug: v.string(),
    name: v.string(),
  }).index('by_slug', ['slug']),

  tables: defineTable({
    planId: v.id('plans'),
    name: v.string(),
    shape,
    seats: v.number(),
    x: v.number(),
    y: v.number(),
    // rectangular tables only: 0 = long side horizontal, 1 = vertical
    rotation: v.number(),
  }).index('by_plan', ['planId']),

  guests: defineTable({
    planId: v.id('plans'),
    name: v.string(),
    tableId: v.optional(v.id('tables')),
    seat: v.optional(v.number()),
    // picks the character's look, fixed for the guest's lifetime
    look: v.number(),
    style: v.optional(style),
  })
    .index('by_plan', ['planId'])
    .index('by_table', ['tableId']),
});
