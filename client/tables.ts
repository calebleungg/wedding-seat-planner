// Table geometry in world pixels, shared by the scene (drawing, hit areas) and the inspector.
// Round tables grow with their seat count. Rectangular tables are banquet tables with seats along
// the long sides; their `rotation` (0..3) both turns the table (odd = on end) and picks whether both
// long sides are used (0, 1: a dining table) or only one (2, 3: a head table facing the room).

export type Shape = 'round' | 'rect';
export type Dir = 'right' | 'up' | 'left' | 'down';

export interface Seat {
  /** chair position, world px (origin at the table centre) */
  x: number;
  y: number;
  /** which way the sitter faces */
  facing: Dir;
  /** angle from the table centre to the chair, radians */
  angle: number;
}

// Sizes are read off the venue's plan, where a ten-seat round is about 100 px across (a 1.8 m
// round, so 1 px is roughly 1.8 cm), a cocktail table about 40 px, and the long table along the
// Grand II wall about 270 px for six chairs.
export const CHAIR_GAP = 14; // from table edge to chair centre
export const SEAT_PITCH = 45; // px between neighbouring chairs along a straight edge
export const RECT_SHORT = 44; // short side of a rectangular table

/** Radius of a round table top for a seat count: 2 seats is a cocktail table, 10 a 1.8 m round. */
export function roundRadius(seats: number): number {
  return Math.max(12, Math.min(96, Math.round(14 + seats * 3.6)));
}

/** Width and height (before rotation) of a rectangular table top for a seat count. */
export function rectSize(seats: number, oneSided: boolean): { w: number; h: number } {
  const perSide = oneSided ? seats : Math.ceil(seats / 2);
  return { w: Math.max(RECT_SHORT, perSide * SEAT_PITCH + 16), h: RECT_SHORT };
}

// A rectangular table's `rotation` is 0..5: even values lie along the room, odd ones stand on end.
//   0, 1  chairs on both long sides (a dining table)
//   2, 3  chairs on the near side only: below a horizontal table, east of a vertical one
//   4, 5  chairs on the far side only: above a horizontal table, west of a vertical one
// A one-sided table is a head table: the couple sits with the wall at their back, facing the room.
export const ROTATIONS = 6;
const norm = (r: number) => ((Math.round(r) % ROTATIONS) + ROTATIONS) % ROTATIONS;
export function isVertical(rotation: number): boolean {
  return norm(rotation) % 2 === 1;
}
export function isOneSided(rotation: number): boolean {
  return norm(rotation) >= 2;
}
export function chairSide(rotation: number): 'both' | 'near' | 'far' {
  const r = norm(rotation);
  return r < 2 ? 'both' : r < 4 ? 'near' : 'far';
}
/** The next orientation with the same chair arrangement. */
export function turned(rotation: number): number {
  const r = norm(rotation);
  return r % 2 === 0 ? r + 1 : r - 1;
}
/** Cycles both sides → near side → far side, keeping the orientation. */
export function nextSides(rotation: number): number {
  return (norm(rotation) + 2) % ROTATIONS;
}

export function facingFromAngle(angleToTable: number): Dir {
  const c = Math.cos(angleToTable);
  const s = Math.sin(angleToTable);
  if (Math.abs(c) >= Math.abs(s)) return c >= 0 ? 'right' : 'left';
  return s >= 0 ? 'down' : 'up';
}

/** Seat positions for a table, relative to its centre, in seat order. */
export function seatsFor(shape: Shape, seats: number, rotation = 0): Seat[] {
  const out: Seat[] = [];
  if (shape === 'round') {
    const r = roundRadius(seats) + CHAIR_GAP;
    for (let i = 0; i < seats; i++) {
      // seat 0 at the top, clockwise, so "seat 1" reads naturally
      const angle = -Math.PI / 2 + (i / seats) * Math.PI * 2;
      const x = Math.cos(angle) * r;
      const y = Math.sin(angle) * r;
      out.push({ x: Math.round(x), y: Math.round(y), facing: facingFromAngle(Math.atan2(-y, -x)), angle });
    }
    return out;
  }
  const oneSided = isOneSided(rotation);
  const vertical = isVertical(rotation);
  const side = chairSide(rotation);
  const { w, h } = rectSize(seats, oneSided);
  const perSide = oneSided ? seats : Math.ceil(seats / 2);
  const span = (perSide - 1) * SEAT_PITCH;
  const along = (i: number) => -span / 2 + i * SEAT_PITCH;
  const off = h / 2 + CHAIR_GAP;
  const local: { u: number; v: number }[] = [];
  // u runs along the long side, v across it: +v is below a horizontal table and east of a vertical one
  if (side === 'near') for (let i = 0; i < perSide; i++) local.push({ u: along(i), v: off });
  else if (side === 'far') for (let i = 0; i < perSide; i++) local.push({ u: along(i), v: -off });
  else {
    for (let i = 0; i < perSide; i++) local.push({ u: along(i), v: -off });
    for (let i = 0; i < seats - perSide; i++) local.push({ u: along(i), v: off });
  }
  for (const { u, v } of local) {
    // chairs along a straight edge all look straight across it, not at the centre
    let x: number, y: number, facing: Dir;
    if (!vertical) { x = u; y = v; facing = v < 0 ? 'down' : 'up'; } else { x = v; y = u; facing = v < 0 ? 'right' : 'left'; }
    void w;
    out.push({ x: Math.round(x), y: Math.round(y), facing, angle: Math.atan2(y, x) });
  }
  return out;
}

/** Axis-aligned extent of the table top (not the chairs), relative to its centre. */
export function tableBox(shape: Shape, seats: number, rotation = 0): { w: number; h: number } {
  if (shape === 'round') {
    const d = roundRadius(seats) * 2;
    return { w: d, h: d };
  }
  const { w, h } = rectSize(seats, isOneSided(rotation));
  return isVertical(rotation) ? { w: h, h: w } : { w, h };
}

/** Extent including chairs, for hit testing and fitting. */
export function footprint(shape: Shape, seats: number, rotation = 0): { w: number; h: number } {
  const box = tableBox(shape, seats, rotation);
  const pad = (CHAIR_GAP + 14) * 2;
  return { w: box.w + pad, h: box.h + pad };
}

/** Index of the nearest seat to a point (relative to the table centre), or -1 if none is close. */
export function nearestSeat(shape: Shape, seats: number, rotation: number, px: number, py: number, within = 30): number {
  let best = -1;
  let bestD = within * within;
  seatsFor(shape, seats, rotation).forEach((s, i) => {
    const d = (s.x - px) ** 2 + (s.y - py) ** 2;
    if (d < bestD) { bestD = d; best = i; }
  });
  return best;
}
