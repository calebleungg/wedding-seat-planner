// The Calile's Grand Reception and Grand I / II / III, traced from the venue's room plan
// (docs/floorplan.png) at about 1 px = 1.6 cm. Coordinates are world pixels with the plan's
// top-left near the origin.

export interface Pt { x: number; y: number }
export interface Room {
  name: string;
  polygon: Pt[];
  floor: 'parquet' | 'carpet' | 'stone';
  label: Pt;
}
export interface Door {
  /** the opening, as two endpoints on a wall */
  a: Pt;
  b: Pt;
  /** the side the leaf swings to: a point inside the room it opens into */
  swing: Pt;
}

const OX = 50;
const OY = 30;
const P = (x: number, y: number): Pt => ({ x: x - OX, y: y - OY });

export const WORLD = { w: 1260, h: 1470 };

export const ROOMS: Room[] = [
  {
    name: 'Grand Reception',
    floor: 'carpet',
    polygon: [P(70, 320), P(330, 320), P(330, 390), P(460, 390), P(460, 1160), P(70, 1160)],
    label: P(265, 290),
  },
  {
    name: 'Corridor',
    floor: 'stone',
    polygon: [P(460, 390), P(520, 390), P(520, 1330), P(460, 1330)],
    label: P(490, 380),
  },
  {
    name: 'Grand I · II · III',
    floor: 'parquet',
    polygon: [
      P(520, 460), P(610, 460), P(610, 140), P(650, 140), P(650, 80), P(710, 80), P(710, 50), P(1290, 50),
      P(1255, 300), P(1165, 300), P(1165, 720), P(1180, 720), P(1180, 1480), P(610, 1480), P(610, 1420), P(520, 1420),
    ],
    label: P(1230, 470),
  },
];

/** Room name labels drawn beside the plan, as on the venue's drawing. */
export const LABELS: { text: string; at: Pt; align: 'left' | 'center' | 'right' }[] = [
  { text: 'Grand Reception', at: P(265, 292), align: 'center' },
  { text: 'Grand I', at: P(1215, 470), align: 'left' },
  { text: 'Grand II', at: P(1215, 965), align: 'left' },
  { text: 'Grand III', at: P(1215, 1335), align: 'left' },
];

/** The dashed air-wall lines that split the ballroom into Grand I, II and III. */
export const PARTITIONS: [Pt, Pt][] = [
  [P(610, 745), P(1100, 745)],
  [P(610, 1165), P(1100, 1165)],
];

/** Openings, with the arc on the side the door swings. */
export const DOORS: Door[] = [
  // reception entrance, top-left (where guests arrive)
  { a: P(80, 320), b: P(140, 320), swing: P(110, 350) },
  // reception to the hall corridor, top right
  { a: P(460, 400), b: P(460, 470), swing: P(500, 435) },
  // hall doors on its west wall
  { a: P(520, 470), b: P(520, 560), swing: P(560, 515) },
  { a: P(520, 790), b: P(520, 880), swing: P(560, 835) },
  { a: P(520, 1225), b: P(520, 1300), swing: P(560, 1262) },
];

/** Columns along the reception's west wall. */
export const PILLARS: Pt[] = [P(90, 350), P(90, 560), P(90, 770), P(90, 960), P(90, 1145)];

/** Where arriving guests appear, and the waypoints into the ballroom. */
export const ENTRY = P(110, 300);
export const ROUTE_TO_HALL: Pt[] = [P(110, 440), P(420, 440), P(490, 435), P(490, 515), P(575, 515)];

export function pointInPolygon(p: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export function roomAt(p: Pt): Room | undefined {
  return ROOMS.find((r) => pointInPolygon(p, r.polygon));
}

/** The walk from the entrance to a point: through the corridor and a hall door when needed. */
export function routeTo(target: Pt): Pt[] {
  const room = roomAt(target);
  if (!room || room.name === 'Grand Reception') return [ENTRY, target];
  // pick the hall door closest to the target
  const doors = [ROUTE_TO_HALL[4], P(575, 835), P(575, 1262)];
  const corridor = [P(490, 515), P(490, 835), P(490, 1262)];
  let best = 0;
  let bestD = Infinity;
  doors.forEach((d, i) => {
    const dd = Math.hypot(d.x - target.x, d.y - target.y);
    if (dd < bestD) { bestD = dd; best = i; }
  });
  const path = [ENTRY, ROUTE_TO_HALL[0], ROUTE_TO_HALL[1], ROUTE_TO_HALL[2], corridor[best]];
  path.push(doors[best], target);
  return path;
}

/** Decorations drawn on the floor that are not tables. */
export const FEATURES: { kind: 'musician' | 'sign'; at: Pt; text: string }[] = [
  { kind: 'musician', at: P(960, 150), text: 'Musician' },
  { kind: 'sign', at: P(1130, 400), text: 'welcome sign' },
];

/** The venue's draft (FPV2): 13 rounds of 10, a six-seat long table on the Grand II wall, a cake table and six cocktail tables. */
export interface PresetTable { name: string; shape: 'round' | 'rect'; seats: number; x: number; y: number; rotation: number }
export const CALILE_DRAFT: PresetTable[] = (() => {
  const rounds: [number, number][] = [
    // Grand I
    [780, 520], [958, 540], [665, 660], [845, 665],
    // Grand II
    [680, 850], [880, 845], [685, 1020], [885, 1020],
    // Grand III
    [715, 1190], [925, 1190], [660, 1345], [835, 1325], [1025, 1345],
  ];
  const out: PresetTable[] = rounds.map(([x, y], i) => ({ name: `Table ${i + 1}`, shape: 'round', seats: 10, ...P(x, y), rotation: 0 }));
  // the long table against the east wall of Grand II, chairs on the wall side facing the room
  out.push({ name: 'Head table', shape: 'rect', seats: 6, ...P(1065, 950), rotation: 3 });
  out.push({ name: 'Cake', shape: 'round', seats: 0, ...P(1050, 695), rotation: 0 });
  const cocktails: [number, number][] = [[200, 510], [305, 610], [200, 700], [310, 810], [205, 905], [305, 1005]];
  cocktails.forEach(([x, y], i) => out.push({ name: `Cocktail ${i + 1}`, shape: 'round', seats: 2, ...P(x, y), rotation: 0 }));
  return out;
})();
