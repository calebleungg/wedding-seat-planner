import test from 'node:test';
import assert from 'node:assert/strict';
import { facingFromAngle, isOneSided, isVertical, nearestSeat, nextSides, roundRadius, seatsFor, turned } from './tables';

test('a ten-seat round is about 100 px across, as on the plan', () => {
  assert.ok(Math.abs(roundRadius(10) * 2 - 100) <= 4);
  assert.ok(roundRadius(2) * 2 <= 46);
});

test('round tables get one seat per guest, spaced evenly, facing the centre', () => {
  const seats = seatsFor('round', 10);
  assert.equal(seats.length, 10);
  const r = roundRadius(10) + 14;
  for (const s of seats) assert.ok(Math.abs(Math.hypot(s.x, s.y) - r) < 1.5);
  assert.equal(seats[0].facing, 'down'); // top seat looks down at the table
  assert.equal(seats[5].facing, 'up');
});

test('rectangular tables split seats over both long sides, head tables use one', () => {
  const both = seatsFor('rect', 8, 0);
  assert.equal(both.length, 8);
  assert.equal(both.filter((s) => s.y < 0).length, 4);
  assert.equal(both.filter((s) => s.y > 0).length, 4);
  const odd = seatsFor('rect', 7, 0);
  assert.equal(odd.filter((s) => s.y < 0).length, 4);
  const head = seatsFor('rect', 6, 2);
  assert.ok(isOneSided(2));
  assert.ok(head.every((s) => s.y > 0 && s.facing === 'up'));
  const vertical = seatsFor('rect', 6, 1);
  assert.ok(isVertical(1));
  assert.ok(vertical.every((s) => Math.abs(s.x) > 20 && Math.abs(s.y) <= 45));
  const east = seatsFor('rect', 6, 3);
  assert.ok(east.every((s) => s.x > 0 && s.facing === 'left'));
  const west = seatsFor('rect', 6, 5);
  assert.ok(west.every((s) => s.x < 0 && s.facing === 'right'));
  assert.equal(turned(0), 1); assert.equal(turned(3), 2);
  assert.equal(nextSides(0), 2); assert.equal(nextSides(5), 1);
});

test('facing follows the dominant axis', () => {
  assert.equal(facingFromAngle(0), 'right');
  assert.equal(facingFromAngle(Math.PI), 'left');
  assert.equal(facingFromAngle(Math.PI / 2), 'down');
  assert.equal(facingFromAngle(-Math.PI / 2), 'up');
});

test('nearestSeat finds the chair under the cursor and nothing far away', () => {
  const s = seatsFor('round', 8)[2];
  assert.equal(nearestSeat('round', 8, 0, s.x + 4, s.y - 3), 2);
  assert.equal(nearestSeat('round', 8, 0, 0, 0), -1);
});
