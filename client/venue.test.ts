import test from 'node:test';
import assert from 'node:assert/strict';
import { CALILE_DRAFT, ROOMS, pointInPolygon, roomAt, routeTo } from './venue';

test('every preset table sits inside a room', () => {
  for (const t of CALILE_DRAFT) {
    const room = roomAt({ x: t.x, y: t.y });
    assert.ok(room, `${t.name} at ${t.x},${t.y} is outside the venue`);
    assert.equal(room!.name, t.name.startsWith('Cocktail') ? 'Grand Reception' : 'Grand I · II · III');
  }
});

test('routes start at the entrance and end at the target', () => {
  const t = CALILE_DRAFT[0];
  const path = routeTo({ x: t.x, y: t.y });
  assert.ok(path.length >= 3);
  assert.deepEqual(path[path.length - 1], { x: t.x, y: t.y });
  // every waypoint but the first is inside a room
  for (const p of path.slice(1)) assert.ok(ROOMS.some((r) => pointInPolygon(p, r.polygon)), `${p.x},${p.y} is in a wall`);
});
