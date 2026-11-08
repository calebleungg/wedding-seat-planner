// Pixel wedding guests, drawn on the fly. Every guest has a `look` number that picks skin, hair,
// outfit and accessories through a seeded generator, so the same guest looks the same on every
// screen and after every reload. Frames are 32x64 (16x32 pixels drawn at 2x, like a 32x32-tile
// pack), laid out in rows of FRAMES columns:
//   rows 0-3  idle   right, up, left, down
//   rows 4-7  walk   right, up, left, down
//   rows 8-11 sit    right, up, left, down
// The sit rows draw the sitter from the thigh up, meant to overlap a chair.

export const FRAME_W = 32;
export const FRAME_H = 64;
export const FRAMES = 6;
export type Dir = 'right' | 'up' | 'left' | 'down';
export const DIRS: Dir[] = ['right', 'up', 'left', 'down'];
export type Anim = 'idle' | 'walk' | 'sit';
const ANIMS: Anim[] = ['idle', 'walk', 'sit'];

export interface Look {
  skin: string;
  hair: string;
  hairStyle: 'short' | 'long' | 'bun' | 'bald' | 'curly' | 'bob';
  outfit: 'suit' | 'dress' | 'shirt' | 'gown';
  cloth: string;
  cloth2: string;
  shoes: string;
  glasses: boolean;
  bowtie: boolean;
  flower: boolean;
}

const SKINS = ['#f6d3b3', '#e8b792', '#d29b6e', '#b57a4f', '#8d5a3a', '#5f3c25', '#ffe0c7'];
const HAIRS = ['#2a1a12', '#4a2c1a', '#8a5a2b', '#c98d4d', '#e7c27d', '#1b1b22', '#5a5a66', '#b23a3a', '#d9d4cc'];
const SUITS = ['#1e2233', '#2c2f3a', '#1f3350', '#3a2b3c', '#2b3a2f', '#4a4a52'];
const DRESSES = ['#c94c6b', '#e07a8f', '#f2b8c6', '#7b5cc9', '#3e8fb0', '#2f9e7a', '#e8a94a', '#d94f3d', '#6a7fd6', '#b86cc2', '#f0d58a', '#54b88d'];
const SHIRTS = ['#f4f1ea', '#dfe9f5', '#f8e5e5', '#e9f3e4', '#efe6f8'];

function rng(seed: number) {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function lookFor(seed: number): Look {
  const r = rng(seed * 2654435761 + 12345);
  const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)];
  const outfit = pick<Look['outfit']>(['suit', 'suit', 'dress', 'dress', 'shirt', 'gown']);
  const hairStyle = pick<Look['hairStyle']>(['short', 'short', 'long', 'bun', 'curly', 'bob', 'bald']);
  const cloth = outfit === 'suit' ? pick(SUITS) : outfit === 'shirt' ? pick(SHIRTS) : pick(DRESSES);
  return {
    skin: pick(SKINS),
    hair: pick(HAIRS),
    hairStyle,
    outfit,
    cloth,
    cloth2: outfit === 'suit' ? pick(SHIRTS) : outfit === 'shirt' ? pick(SUITS) : pick(DRESSES),
    shoes: outfit === 'suit' ? '#1a1410' : pick(['#1a1410', '#5b3a24', '#c9a44a', '#2b2b33']),
    glasses: r() < 0.22,
    bowtie: outfit === 'suit' && r() < 0.35,
    flower: outfit !== 'suit' && r() < 0.3,
  };
}

function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v + amt)));
  const r = c(n >> 16), g = c((n >> 8) & 255), b = c(n & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

type Px = (x: number, y: number, w: number, h: number, color: string) => void;

/** Draws one 16x32 pose. `ox/oy` offset the frame origin (in pixels); legs are omitted when sitting. */
function drawPose(px: Px, look: Look, dir: Dir, pose: { bob: number; legPhase: number; sitting: boolean; blink: boolean; arm: number }) {
  const { bob, legPhase, sitting, blink, arm } = pose;
  const mirror = dir === 'left';
  const X = (x: number, w = 1) => (mirror ? 16 - x - w : x);
  // a sitter drops by the length of the hidden lower leg, so the figure settles onto the chair
  const drop = sitting ? 5 : 0;
  const p: Px = (x, y, w, h, c) => px(X(x, w), y + bob + drop, w, h, c);
  const side = dir === 'left' || dir === 'right';
  const back = dir === 'up';
  const hairDark = shade(look.hair, -30);
  const clothDark = shade(look.cloth, -26);

  // legs and shoes (standing) or thighs (sitting)
  const legC = look.outfit === 'suit' ? look.cloth : look.outfit === 'shirt' ? look.cloth2 : look.skin;
  if (!sitting) {
    const l = legPhase; // -1, 0, 1
    if (side) {
      p(6 + (l > 0 ? 1 : 0), 22, 3, 7 - (l < 0 ? 1 : 0), legC);
      p(8 - (l < 0 ? 1 : 0), 22, 3, 7 - (l > 0 ? 1 : 0), shade(legC, -12));
      p(5 + (l > 0 ? 2 : 0), 29, 4, 2, look.shoes);
      p(8 - (l < 0 ? 2 : 0), 29, 4, 2, shade(look.shoes, -20));
    } else {
      p(5, 22, 3, 7 - Math.max(0, l), legC);
      p(8, 22, 3, 7 - Math.max(0, -l), legC);
      p(4, 29 - Math.max(0, l), 4, 2, look.shoes);
      p(8, 29 - Math.max(0, -l), 4, 2, look.shoes);
    }
    // a skirt widens below the waist
    if (look.outfit === 'dress' || look.outfit === 'gown') {
      const hem = look.outfit === 'gown' ? 28 : 25;
      p(4, 20, 8, hem - 20, look.cloth);
      p(3, 23, 10, hem - 23, look.cloth);
      if (look.outfit === 'gown') p(2, 26, 12, 3, clothDark);
    }
  } else {
    // seated: thighs come forward, feet hidden by the chair
    const skirt = look.outfit === 'dress' || look.outfit === 'gown';
    p(4, 22, 8, 4, skirt ? look.cloth : legC);
    if (skirt) p(3, 24, 10, 2, clothDark);
  }

  // torso
  p(4, 12, 8, 10, look.cloth);
  p(4, 12, 1, 10, clothDark);
  if (look.outfit === 'suit' && !back) {
    // shirt front and lapels
    p(7, 12, 2, 6, look.cloth2);
    if (look.bowtie) p(6, 13, 4, 1, '#b02a3a'); else p(7, 14, 2, 4, '#7a2335');
  }
  if (look.outfit === 'shirt' && !back) p(7, 12, 2, 9, shade(look.cloth, -40));
  if (look.flower && !back) p(mirror ? 10 : 5, 13, 2, 2, '#ffd166');

  // arms (one may be raised, holding a glass)
  const armC = look.outfit === 'shirt' || look.outfit === 'suit' ? look.cloth : look.skin;
  const handC = look.skin;
  if (side) {
    if (arm > 0) {
      p(10, 11 - arm, 2, 5, armC);
      p(10, 9 - arm, 2, 2, handC);
      p(10, 6 - arm, 2, 3, '#cfe6f5'); // glass
    } else {
      p(10, 13, 2, 7, armC);
      p(10, 20, 2, 2, handC);
    }
  } else {
    p(2, 13, 2, 7, armC); p(12, 13, 2, 7, armC);
    p(2, 20, 2, 2, handC);
    if (arm > 0) { p(12, 13, 2, 7 - arm * 2, armC); p(12, 11 - arm, 2, 2, handC); p(12, 8 - arm, 2, 3, '#cfe6f5'); } else p(12, 20, 2, 2, handC);
  }

  // head
  p(4, 4, 8, 8, look.skin);
  p(4, 11, 8, 1, shade(look.skin, -24)); // chin shadow
  if (!back) {
    const ey = blink ? 1 : 2;
    if (side) {
      p(9, 7, 2, ey, '#1b1b22');
      if (look.glasses) { p(8, 6, 4, 1, '#2b2b33'); p(8, 9, 4, 1, '#2b2b33'); p(11, 6, 1, 4, '#2b2b33'); }
    } else {
      p(5, 7, 2, ey, '#1b1b22'); p(9, 7, 2, ey, '#1b1b22');
      if (look.glasses) { p(4, 6, 4, 1, '#2b2b33'); p(8, 6, 4, 1, '#2b2b33'); p(4, 9, 4, 1, '#2b2b33'); p(8, 9, 4, 1, '#2b2b33'); }
      p(7, 10, 2, 1, shade(look.skin, -48)); // mouth
    }
  }

  // hair
  if (look.hairStyle !== 'bald') {
    p(3, 2, 10, 3, look.hair);
    p(3, 4, 1, 4, look.hair); p(12, 4, 1, 4, look.hair);
    if (back) p(4, 5, 8, 5, look.hair);
    if (side) p(mirror ? 11 : 3, 4, 2, 5, look.hair);
    switch (look.hairStyle) {
      case 'long': p(3, 5, 1, 9, look.hair); p(12, 5, 1, 9, look.hair); if (back) p(4, 8, 8, 6, hairDark); break;
      case 'bob': p(3, 5, 1, 6, look.hair); p(12, 5, 1, 6, look.hair); if (back) p(4, 8, 8, 3, hairDark); break;
      case 'bun': p(6, 0, 4, 3, look.hair); p(7, 0, 2, 1, hairDark); break;
      case 'curly': p(2, 1, 12, 3, look.hair); p(2, 3, 2, 4, hairDark); p(12, 3, 2, 4, hairDark); p(5, 0, 6, 2, look.hair); break;
      case 'short': p(4, 1, 8, 2, look.hair); break;
    }
    if (look.flower) p(mirror ? 3 : 11, 2, 2, 2, '#f7b2c4');
  } else {
    p(5, 3, 6, 1, shade(look.skin, 18));
  }
}

/** Renders the full sheet for a look to a canvas. */
export function renderSheet(look: Look): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = FRAME_W * FRAMES;
  canvas.height = FRAME_H * ANIMS.length * DIRS.length;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ANIMS.forEach((anim, ai) => {
    DIRS.forEach((dir, di) => {
      const row = ai * DIRS.length + di;
      for (let f = 0; f < FRAMES; f++) {
        const fx = f * FRAME_W;
        const fy = row * FRAME_H;
        const px: Px = (x, y, w, h, color) => {
          ctx.fillStyle = color;
          ctx.fillRect(fx + x * 2, fy + y * 2, w * 2, h * 2);
        };
        const pose =
          anim === 'walk'
            ? { bob: f % 3 === 1 ? -1 : 0, legPhase: [1, 0, -1, 0, 1, 0][f] as number, sitting: false, blink: false, arm: 0 }
            : anim === 'sit'
              ? { bob: f === 2 || f === 3 ? -1 : 0, legPhase: 0, sitting: true, blink: f === 5, arm: f === 3 ? 2 : f === 2 || f === 4 ? 1 : 0 }
              : { bob: f === 2 || f === 3 ? -1 : 0, legPhase: 0, sitting: false, blink: f === 5, arm: 0 };
        // frames are drawn with the feet on the frame's bottom row, shifted so the figure's ground
        // point is at the bottom centre
        const shift: Px = (x, y, w, h, color) => px(x + 0, y + 1, w, h, color);
        drawPose(shift, look, dir, pose);
      }
    });
  });
  return canvas;
}

export function rowFor(anim: Anim, dir: Dir): number {
  return ANIMS.indexOf(anim) * DIRS.length + DIRS.indexOf(dir);
}

export function dirBetween(dx: number, dy: number): Dir {
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'right' : 'left';
  return dy >= 0 ? 'down' : 'up';
}
