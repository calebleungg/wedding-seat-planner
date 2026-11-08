# Wedding Seat Planner

A top-down pixel seating planner, in the style of a little tile game. Place round and rectangular tables on the venue's floor plan, give each its number of seats, and drag guests onto chairs: each guest is an animated pixel character who walks in through the entrance and sits down. Everything is saved live through [Convex](https://convex.dev), so the same link shows the same plan on every device as it changes.

The floor plan is The Calile's Grand Reception and Grand I / II / III, traced from the venue's room plan (`docs/floorplan.png`, the "FPV2" draft) at a scale where a ten-seat round is about 1.8 m across. **load Calile draft** places the venue's own draft: 13 rounds of ten, the long table on the Grand II wall, the cake table and six cocktail tables in the reception. Press **P** to see the venue's drawing under the floor.

## How it works

```
convex/schema.ts      plans ─┬─ tables (shape, seats, x, y, rotation)
                             └─ guests (name, look, tableId?, seat?)
convex/plans.ts       one query for the whole plan; mutations to add, move, resize, seat, unseat
client/store.ts       ConvexClient subscription + thin mutation wrappers, keyed by ?plan=<slug>
client/venue.ts       rooms, doors, pillars, partitions and the walk route in from the entrance
client/tables.ts      seat geometry: where the chairs go and which way sitters face
client/characters.ts  pixel guests drawn on a canvas from a seeded look: idle, walk and sit, 4 directions
client/scenes/PlanScene.ts   the Phaser scene: floor, walls, tables, chairs, characters, drag and drop
client/ui.ts          the HTML panels: guest list, table inspector, top bar
```

- A plan is addressed by `?plan=<slug>` in the URL. Open the page without one and you get the `default` plan; share the link and whoever opens it edits the same plan. **share link** copies it.
- Tables live in world pixels on the plan. Round tables grow with their seat count; rectangular tables are banquet tables with chairs along the long sides, and **one side** turns one into a head table with the chairs against the wall side. **turn** stands it on end. A table with 0 seats is a cake or gift table.
- Guests either have a table and seat or wait in the list. Dropping a guest on a chair takes that chair (swapping with whoever had it); dropping on the table takes the first free chair. Shrinking a table sends the guests on the removed chairs back to the list; removing a table sends them all back.
- Characters are generated, not loaded: skin, hair, outfit (suits, dresses, gowns, shirts), glasses, bow ties and flowers come from the guest's `look` number, so a guest looks the same everywhere. New sitters walk in from the entrance, through the corridor and the nearest hall door, then sit facing their table and sip now and then.

## Running

```
npm install
npx convex dev --once   # first time: log in, create a Convex project, writes .env.local
npm run dev             # convex dev (keeps functions in sync) + vite on http://localhost:5173
```

`npm test` runs the geometry and venue tests; `npm run typecheck` covers the client and the Convex functions.

## Deploying

The site is static (Vite) and talks to a Convex deployment, so it can be hosted anywhere. This repo deploys to GitHub Pages from `.github/workflows/pages.yml` on every push to `main`:

1. `npx convex deploy` pushes the functions to the production deployment (the URL it prints is the production `VITE_CONVEX_URL`).
2. The workflow builds the client with the repository variable `VITE_CONVEX_URL` and publishes `dist/` to Pages with `BASE_PATH=/<repo>/`.

Set the variable once with `gh variable set VITE_CONVEX_URL --body https://<your-prod>.convex.cloud`, then enable Pages with the GitHub Actions source.

There is no login: anyone with the link can edit a plan. Keep the slug unguessable if that matters.

## Controls

Drag the floor to pan, wheel to zoom. Drag a table to move it; click it for the inspector (name, shape, seats, layout, seat list). Drag a guest from the list onto a chair, or click a guest and then a table or a seat in the inspector. Drag a seated character to another chair, or onto the floor to send them back to the list. **F** fits the venue, **P** shows the plan drawing, **Esc** deselects, **Delete** removes the selected table.

## Credits

Built with [Phaser 3](https://phaser.io), [Vite](https://vite.dev) and [Convex](https://convex.dev). The layout and dark panels take after [agent-office](https://github.com/calebleungg/agent-office); the characters and furniture are drawn by the code, so there is no art to license.
