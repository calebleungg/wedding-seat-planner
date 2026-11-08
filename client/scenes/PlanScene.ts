import Phaser from 'phaser';
import type { Guest, PlanState, Store, Table } from '../store';
import type { Id } from '../../convex/_generated/dataModel';
import { FRAMES, FRAME_H, FRAME_W, dirBetween, lookFor, renderSheet, rowFor, type Anim, type Dir } from '../characters';
import { footprint, isOneSided, isVertical, nearestSeat, rectSize, roundRadius, seatsFor, tableBox } from '../tables';
import { DOORS, ENTRY, FEATURES, LABELS, PARTITIONS, PILLARS, ROOMS, WORLD, routeTo, type Pt } from '../venue';

export interface SceneEvents {
  selectTable(id: Id<'tables'> | null): void;
  selectGuest(id: Id<'guests'> | null): void;
  hover(text: string | null, x: number, y: number): void;
}

interface Character {
  id: Id<'guests'>;
  sprite: Phaser.GameObjects.Sprite;
  sheet: string;
  path: Pt[];
  /** where the character is heading to sit, if anywhere */
  seat: { tableId: Id<'tables'>; index: number } | null;
  sitting: boolean;
  facing: Dir;
  speed: number;
  leaving: boolean;
}

interface TableView {
  id: Id<'tables'>;
  container: Phaser.GameObjects.Container;
  top: Phaser.GameObjects.Graphics;
  chairs: Phaser.GameObjects.Graphics;
  label: Phaser.GameObjects.Text;
  count: Phaser.GameObjects.Text;
  zone: Phaser.GameObjects.Zone;
  shadow: Phaser.GameObjects.Graphics;
  signature: string;
  dragging: boolean;
  /** where the container was when the current drag began */
  dragFrom: { x: number; y: number };
}

const WALK = 110; // px/s
const BG = 0x1b1b22;

export class PlanScene extends Phaser.Scene {
  private store!: Store;
  private ui!: SceneEvents;
  private tables = new Map<string, TableView>();
  private characters = new Map<string, Character>();
  private selectedTable: string | null = null;
  private selectedGuest: string | null = null;
  private highlight!: Phaser.GameObjects.Graphics;
  private dragGhost!: Phaser.GameObjects.Graphics;
  private planImage?: Phaser.GameObjects.Image;
  private lastState: PlanState = { plan: null, tables: [], guests: [] };
  private pendingMoves = new Map<string, { x: number; y: number }>();
  private dragCharacter: Character | null = null;
  private justDragged = false;

  constructor() {
    super('plan');
  }

  init(data: { store: Store; events: SceneEvents }) {
    this.store = data.store;
    this.ui = data.events;
  }

  preload() {
    this.load.image('plan', `${import.meta.env.BASE_URL}floorplan.png`);
  }

  create() {
    this.makeFloor();
    this.drawVenue();
    this.highlight = this.add.graphics().setDepth(5);
    this.dragGhost = this.add.graphics().setDepth(100000);
    this.setupCamera();
    this.setupInput();
    this.store.subscribe((s) => this.apply(s));
    this.fit(false);
  }

  // ---------- venue ----------

  /** The floors as one canvas: each room's polygon clipped and filled with its tile pattern. */
  private makeFloor() {
    const tile = (size: number, draw: (ctx: CanvasRenderingContext2D) => void) => {
      const c = document.createElement('canvas');
      c.width = size; c.height = size;
      draw(c.getContext('2d')!);
      return c;
    };
    const tiles = {
      parquet: tile(64, (ctx) => {
        ctx.fillStyle = '#c9a070';
        ctx.fillRect(0, 0, 64, 64);
        const planks = ['#c69a68', '#cfa676', '#c29462', '#d1aa7c'];
        for (let row = 0; row < 8; row++) {
          const off = (row % 2) * 16;
          for (let i = -1; i < 3; i++) {
            ctx.fillStyle = planks[(row + i + 7) % planks.length];
            ctx.fillRect(i * 32 + off, row * 8, 31, 7);
          }
        }
        ctx.fillStyle = 'rgba(0,0,0,0.06)';
        for (let y = 0; y < 64; y += 8) ctx.fillRect(0, y + 7, 64, 1);
      }),
      carpet: tile(32, (ctx) => {
        ctx.fillStyle = '#7d6c8f';
        ctx.fillRect(0, 0, 32, 32);
        ctx.fillStyle = '#857496';
        for (let y = 0; y < 32; y += 4) for (let x = ((y / 4) % 2) * 2; x < 32; x += 4) ctx.fillRect(x, y, 2, 2);
        ctx.fillStyle = '#6f5f81';
        ctx.fillRect(0, 0, 32, 1); ctx.fillRect(0, 0, 1, 32);
      }),
      stone: tile(32, (ctx) => {
        ctx.fillStyle = '#b9b3a8';
        ctx.fillRect(0, 0, 32, 32);
        ctx.fillStyle = '#aaa398';
        ctx.fillRect(0, 15, 32, 1); ctx.fillRect(15, 0, 1, 16); ctx.fillRect(7, 16, 1, 16);
        ctx.fillStyle = '#c4beb3';
        ctx.fillRect(2, 2, 10, 10);
      }),
      outside: tile(32, (ctx) => {
        ctx.fillStyle = '#23232c';
        ctx.fillRect(0, 0, 32, 32);
        ctx.fillStyle = '#262630';
        ctx.fillRect(0, 0, 16, 16); ctx.fillRect(16, 16, 16, 16);
      }),
    };
    this.textures.addCanvas('outside', tiles.outside);
    const floor = document.createElement('canvas');
    floor.width = WORLD.w; floor.height = WORLD.h;
    const ctx = floor.getContext('2d')!;
    for (const room of ROOMS) {
      ctx.save();
      ctx.beginPath();
      room.polygon.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.closePath();
      ctx.clip();
      ctx.fillStyle = ctx.createPattern(tiles[room.floor], 'repeat')!;
      ctx.fillRect(0, 0, WORLD.w, WORLD.h);
      ctx.restore();
    }
    this.textures.addCanvas('floor', floor);
  }

  private drawVenue() {
    // ground outside the rooms
    this.add.tileSprite(-2000, -2000, WORLD.w + 4000, WORLD.h + 4000, 'outside').setOrigin(0, 0).setDepth(-10);
    // optional underlay of the real drawing, toggled with P
    if (this.textures.exists('plan')) {
      this.planImage = this.add.image(-50, -30, 'plan').setOrigin(0, 0).setDepth(-5).setAlpha(0.55).setVisible(false);
      const img = this.textures.get('plan').getSourceImage() as HTMLImageElement;
      this.planImage.setDisplaySize(img.width * (1560 / img.width) * (1 / 1), img.height * (1560 / img.width));
    }
    this.add.image(0, 0, 'floor').setOrigin(0, 0).setDepth(-8);
    // a soft inner shade along the walls
    for (const room of ROOMS) {
      const shade = this.add.graphics().setDepth(-7);
      shade.lineStyle(10, 0x000000, 0.08);
      shade.strokePoints(room.polygon.map((p) => new Phaser.Geom.Point(p.x, p.y)), true);
    }
    // walls: a thick cream line with a dark edge
    const walls = this.add.graphics().setDepth(-6);
    for (const room of ROOMS) {
      const pts = room.polygon.map((p) => new Phaser.Geom.Point(p.x, p.y));
      walls.lineStyle(9, 0x2a2622, 1);
      walls.strokePoints(pts, true);
      walls.lineStyle(5, 0xe9e2d2, 1);
      walls.strokePoints(pts, true);
    }
    // door openings and swing arcs
    for (const d of DOORS) {
      const horizontal = d.a.y === d.b.y;
      walls.lineStyle(11, horizontal ? 0x7d6c8f : 0xb9b3a8, 1);
      // cut the opening by drawing the floor colour over the wall
      const inHall = !horizontal && d.a.x > 500;
      walls.lineStyle(11, horizontal ? 0x7d6c8f : inHall ? 0xc9a070 : 0xb9b3a8, 1);
      walls.lineBetween(d.a.x, d.a.y, d.b.x, d.b.y);
      const len = Math.hypot(d.b.x - d.a.x, d.b.y - d.a.y);
      walls.lineStyle(2, 0x3a332c, 0.9);
      const start = horizontal ? (d.swing.y > d.a.y ? 0 : Math.PI) : d.swing.x > d.a.x ? -Math.PI / 2 : Math.PI / 2;
      walls.beginPath();
      walls.arc(d.a.x, d.a.y, len, start, start + Math.PI / 2, false);
      walls.strokePath();
      walls.lineStyle(4, 0x6b5537, 1);
      if (horizontal) walls.lineBetween(d.a.x, d.a.y, d.a.x, d.a.y + Math.sign(d.swing.y - d.a.y) * len);
      else walls.lineBetween(d.a.x, d.a.y, d.a.x + Math.sign(d.swing.x - d.a.x) * len, d.a.y);
    }
    // dashed partitions between Grand I, II and III
    walls.lineStyle(3, 0x4a4036, 0.9);
    for (const [a, b] of PARTITIONS) {
      const n = Math.floor(Math.hypot(b.x - a.x, b.y - a.y) / 16);
      for (let i = 0; i < n; i += 2) {
        const t0 = i / n, t1 = Math.min(1, (i + 1) / n);
        walls.lineBetween(a.x + (b.x - a.x) * t0, a.y + (b.y - a.y) * t0, a.x + (b.x - a.x) * t1, a.y + (b.y - a.y) * t1);
      }
    }
    // pillars
    const pillars = this.add.graphics().setDepth(-5);
    for (const p of PILLARS) {
      pillars.fillStyle(0x000000, 0.25); pillars.fillCircle(p.x + 2, p.y + 3, 10);
      pillars.fillStyle(0x2a2622, 1); pillars.fillCircle(p.x, p.y, 10);
      pillars.fillStyle(0x6e6358, 1); pillars.fillCircle(p.x - 2, p.y - 2, 5);
    }
    // labels
    for (const l of LABELS) {
      this.add
        .text(l.at.x, l.at.y, l.text, { fontFamily: 'ui-monospace, Menlo, monospace', fontSize: '15px', color: '#cfc7b6', fontStyle: 'bold' })
        .setOrigin(l.align === 'center' ? 0.5 : l.align === 'right' ? 1 : 0, 0.5)
        .setDepth(-4)
        .setAlpha(0.9);
    }
    // musician's corner and the welcome sign
    const deco = this.add.graphics().setDepth(-4);
    for (const f of FEATURES) {
      if (f.kind === 'musician') {
        deco.fillStyle(0x000000, 0.18); deco.fillEllipse(f.at.x + 2, f.at.y + 22, 70, 16);
        deco.fillStyle(0x3a2f28, 1); deco.fillRoundedRect(f.at.x - 32, f.at.y - 6, 64, 22, 6); // a small stage
        deco.fillStyle(0x2b2b33, 1); deco.fillRect(f.at.x - 6, f.at.y - 26, 3, 22); // mic stand
        deco.fillStyle(0x8d93a3, 1); deco.fillCircle(f.at.x - 4, f.at.y - 28, 4);
        deco.fillStyle(0xe8c170, 1); deco.fillRoundedRect(f.at.x + 6, f.at.y - 18, 16, 14, 3); // amp
      } else {
        deco.fillStyle(0x000000, 0.18); deco.fillEllipse(f.at.x + 2, f.at.y + 30, 30, 10);
        deco.fillStyle(0x6b4a2e, 1); deco.fillRect(f.at.x - 2, f.at.y - 10, 4, 40); // easel
        deco.fillStyle(0xf7f2e8, 1); deco.fillRoundedRect(f.at.x - 14, f.at.y - 30, 28, 40, 4);
        deco.lineStyle(2, 0xe8c170, 1); deco.strokeRoundedRect(f.at.x - 14, f.at.y - 30, 28, 40, 4);
        deco.fillStyle(0xf2a1b0, 1); deco.fillCircle(f.at.x, f.at.y - 18, 4);
      }
      this.add.text(f.at.x, f.at.y + 22, f.text, { fontFamily: 'ui-monospace, Menlo, monospace', fontSize: '11px', color: '#cfc7b6' }).setOrigin(0.5, 0).setDepth(-4);
    }
    // the entrance marker
    const e = this.add.graphics().setDepth(-4);
    e.fillStyle(0xffd166, 0.9);
    e.fillTriangle(ENTRY.x - 8, ENTRY.y - 22, ENTRY.x + 8, ENTRY.y - 22, ENTRY.x, ENTRY.y - 8);
    this.add.text(ENTRY.x, ENTRY.y - 34, 'entrance', { fontFamily: 'ui-monospace, Menlo, monospace', fontSize: '11px', color: '#ffd166' }).setOrigin(0.5, 1).setDepth(-4);
  }

  togglePlan() {
    if (this.planImage) this.planImage.setVisible(!this.planImage.visible);
  }

  // ---------- camera ----------

  private setupCamera() {
    const cam = this.cameras.main;
    cam.setBackgroundColor(BG);
    cam.setBounds(-1500, -1500, WORLD.w + 3000, WORLD.h + 3000);
    this.input.on('wheel', (pointer: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => {
      const before = cam.getWorldPoint(pointer.x, pointer.y);
      const zoom = Phaser.Math.Clamp(cam.zoom * (dy > 0 ? 0.9 : 1.1), 0.25, 3);
      cam.setZoom(zoom);
      const after = cam.getWorldPoint(pointer.x, pointer.y);
      cam.scrollX += before.x - after.x;
      cam.scrollY += before.y - after.y;
    });
    this.scale.on('resize', () => this.fit(false));
  }

  fit(animate = true) {
    const cam = this.cameras.main;
    const w = this.scale.width, h = this.scale.height;
    // leave room for the side panels
    const pad = { l: 300, r: 320, t: 70, b: 40 };
    const zoom = Phaser.Math.Clamp(Math.min((w - pad.l - pad.r) / WORLD.w, (h - pad.t - pad.b) / WORLD.h), 0.25, 2);
    const cx = WORLD.w / 2 - ((pad.r - pad.l) / 2) / zoom;
    const cy = WORLD.h / 2 - ((pad.b - pad.t) / 2) / zoom;
    if (animate) {
      const from = { zoom: cam.zoom, x: cam.midPoint.x, y: cam.midPoint.y };
      this.tweens.addCounter({
        from: 0, to: 1, duration: 260, ease: 'Sine.easeInOut',
        onUpdate: (tw) => {
          const t = tw.getValue() ?? 1;
          cam.setZoom(from.zoom + (zoom - from.zoom) * t);
          cam.centerOn(from.x + (cx - from.x) * t, from.y + (cy - from.y) * t);
        },
      });
    } else {
      cam.setZoom(zoom);
      cam.centerOn(cx, cy);
    }
  }

  centerOn(x: number, y: number) {
    this.cameras.main.pan(x, y, 300);
  }

  worldPoint(clientX: number, clientY: number): Pt {
    const rect = this.game.canvas.getBoundingClientRect();
    const p = this.cameras.main.getWorldPoint(clientX - rect.left, clientY - rect.top);
    return { x: p.x, y: p.y };
  }

  // ---------- input ----------

  private setupInput() {
    const cam = this.cameras.main;
    let panning = false;
    let last = { x: 0, y: 0 };
    this.input.on('pointerdown', (p: Phaser.Input.Pointer, over: unknown[]) => {
      if (over.length === 0) {
        panning = true;
        last = { x: p.x, y: p.y };
      }
    });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (panning && p.isDown) {
        cam.scrollX -= (p.x - last.x) / cam.zoom;
        cam.scrollY -= (p.y - last.y) / cam.zoom;
        last = { x: p.x, y: p.y };
      }
    });
    this.input.on('pointerup', (p: Phaser.Input.Pointer) => {
      const moved = Math.hypot(p.x - p.downX, p.y - p.downY) > 4;
      if (panning && !moved && !this.justDragged) {
        this.select(null);
        this.ui.selectGuest(null);
      }
      panning = false;
      this.justDragged = false;
    });
    this.input.on('gameout', () => { panning = false; });

    // tables and characters are dragged
    this.input.on('dragstart', (_p: Phaser.Input.Pointer, obj: Phaser.GameObjects.GameObject) => {
      const t = this.tableOf(obj);
      if (t) {
        t.dragging = true;
        t.dragFrom = { x: t.container.x, y: t.container.y };
        t.container.setDepth(90000);
        this.select(t.id);
        return;
      }
      const c = this.characterOf(obj);
      if (c) { this.dragCharacter = c; c.sprite.setDepth(90001); this.ui.selectGuest(c.id); }
    });
    this.input.on('drag', (p: Phaser.Input.Pointer, obj: Phaser.GameObjects.GameObject, dx: number, dy: number) => {
      const t = this.tableOf(obj);
      if (t) {
        // the zone is a container child, so Phaser's dragX/dragY are its local position: an offset
        // from where the drag started (the zone sits at the container's origin)
        t.container.setPosition(Math.round(t.dragFrom.x + dx), Math.round(t.dragFrom.y + dy));
        this.drawHighlight();
        return;
      }
      const c = this.characterOf(obj);
      if (c) {
        c.sprite.setPosition(dx, dy + 20);
        this.showDropTarget(p);
      }
    });
    this.input.on('dragend', (p: Phaser.Input.Pointer, obj: Phaser.GameObjects.GameObject) => {
      this.justDragged = true;
      const t = this.tableOf(obj);
      if (t) {
        t.dragging = false;
        const x = Math.round(t.container.x), y = Math.round(t.container.y);
        this.pendingMoves.set(t.id, { x, y });
        void this.store.moveTable(t.id, x, y).finally(() => {
          this.pendingMoves.delete(t.id);
          this.apply(this.store.state);
        });
        t.container.setDepth(y);
        return;
      }
      const c = this.characterOf(obj);
      if (c) {
        this.dragCharacter = null;
        this.dragGhost.clear();
        const w = cam.getWorldPoint(p.x, p.y);
        const hit = this.seatAt(w.x, w.y);
        if (hit) void this.store.seatGuest(c.id, hit.tableId, hit.seat);
        else void this.store.unseatGuest(c.id);
        // snap back meanwhile; the next state update settles it
        const g = this.store.guest(c.id);
        if (g) this.placeCharacter(c, g, true);
      }
    });

    this.input.keyboard?.on('keydown', (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      if (e.key === 'f' || e.key === 'F') this.fit();
      if (e.key === 'p' || e.key === 'P') this.togglePlan();
      if (e.key === 'Escape') { this.select(null); this.ui.selectGuest(null); }
      if ((e.key === 'Delete' || e.key === 'Backspace') && this.selectedTable) {
        const t = this.store.table(this.selectedTable);
        if (t && confirm(`Remove ${t.name}? Its guests go back to the list.`)) void this.store.removeTable(t._id);
      }
    });
  }

  private tableOf(obj: Phaser.GameObjects.GameObject): TableView | undefined {
    const id = obj.getData('tableId') as string | undefined;
    return id ? this.tables.get(id) : undefined;
  }
  private characterOf(obj: Phaser.GameObjects.GameObject): Character | undefined {
    const id = obj.getData('guestId') as string | undefined;
    return id ? this.characters.get(id) : undefined;
  }

  /** The table and seat under a world point, or just the table (seat -1 → first free). */
  seatAt(x: number, y: number): { tableId: Id<'tables'>; seat: number | undefined } | null {
    for (const t of this.lastState.tables) {
      const fp = footprint(t.shape, t.seats, t.rotation);
      if (Math.abs(x - t.x) > fp.w / 2 + 10 || Math.abs(y - t.y) > fp.h / 2 + 10) continue;
      const seat = nearestSeat(t.shape, t.seats, t.rotation, x - t.x, y - t.y, 26);
      return { tableId: t._id, seat: seat >= 0 ? seat : undefined };
    }
    return null;
  }

  private showDropTarget(p: Phaser.Input.Pointer) {
    const w = this.cameras.main.getWorldPoint(p.x, p.y);
    this.showDropTargetAt(w.x, w.y);
  }

  /** Called by the HTML guest list while a chip is dragged over the canvas. */
  showDropTargetAt(x: number, y: number) {
    this.dragGhost.clear();
    const hit = this.seatAt(x, y);
    if (!hit) return;
    const t = this.store.table(hit.tableId);
    if (!t) return;
    const fp = footprint(t.shape, t.seats, t.rotation);
    this.dragGhost.lineStyle(3, 0xffd166, 0.9);
    this.dragGhost.strokeRoundedRect(t.x - fp.w / 2, t.y - fp.h / 2, fp.w, fp.h, 12);
    if (hit.seat !== undefined) {
      const s = seatsFor(t.shape, t.seats, t.rotation)[hit.seat];
      this.dragGhost.fillStyle(0xffd166, 0.5);
      this.dragGhost.fillCircle(t.x + s.x, t.y + s.y, 16);
    }
  }
  clearDropTarget() {
    this.dragGhost.clear();
  }

  // ---------- selection ----------

  select(id: Id<'tables'> | string | null) {
    this.selectedTable = id;
    this.ui.selectTable((id as Id<'tables'>) ?? null);
    this.drawHighlight();
  }

  setSelectedGuest(id: string | null) {
    this.selectedGuest = id;
    this.drawHighlight();
  }

  private drawHighlight() {
    this.highlight.clear();
    const t = this.selectedTable ? this.tables.get(this.selectedTable) : undefined;
    const st = this.selectedTable ? this.store.table(this.selectedTable) : undefined;
    if (t && st) {
      const fp = footprint(st.shape, st.seats, st.rotation);
      this.highlight.lineStyle(3, 0xffffff, 0.95);
      this.highlight.strokeRoundedRect(t.container.x - fp.w / 2, t.container.y - fp.h / 2, fp.w, fp.h, 14);
    }
    const g = this.selectedGuest ? this.characters.get(this.selectedGuest) : undefined;
    if (g) {
      this.highlight.lineStyle(2, 0xffd166, 1);
      this.highlight.strokeCircle(g.sprite.x, g.sprite.y - 24, 24);
    }
  }

  // ---------- state → scene ----------

  private apply(state: PlanState) {
    this.lastState = state;
    const seen = new Set<string>();
    for (const t of state.tables) {
      seen.add(t._id);
      this.upsertTable(t);
    }
    for (const [id, view] of this.tables) {
      if (!seen.has(id)) {
        view.container.destroy();
        this.tables.delete(id);
        if (this.selectedTable === id) this.select(null);
      }
    }
    const seenGuests = new Set<string>();
    for (const g of state.guests) {
      seenGuests.add(g._id);
      this.upsertGuest(g);
    }
    for (const [id, ch] of this.characters) {
      if (!seenGuests.has(id)) {
        ch.sprite.destroy();
        this.characters.delete(id);
      }
    }
    this.redrawCounts();
    this.drawHighlight();
  }

  private upsertTable(t: Table) {
    const pending = this.pendingMoves.get(t._id);
    const x = pending ? pending.x : t.x;
    const y = pending ? pending.y : t.y;
    const signature = `${t.shape}:${t.seats}:${t.rotation}:${t.name}`;
    let view = this.tables.get(t._id);
    if (!view) {
      const container = this.add.container(x, y);
      const shadow = this.add.graphics();
      const chairs = this.add.graphics();
      const top = this.add.graphics();
      const label = this.add.text(0, 0, t.name, { fontFamily: 'ui-sans-serif, system-ui, sans-serif', fontSize: '13px', fontStyle: 'bold', color: '#3a2f28', align: 'center' }).setOrigin(0.5, 0.5);
      const count = this.add.text(0, 0, '', { fontFamily: 'ui-monospace, Menlo, monospace', fontSize: '11px', color: '#6e5f54' }).setOrigin(0.5, 0.5);
      const zone = this.add.zone(0, 0, 10, 10).setOrigin(0.5);
      zone.setData('tableId', t._id);
      container.add([shadow, chairs, top, label, count, zone]);
      view = { id: t._id, container, top, chairs, label, count, zone, shadow, signature: '', dragging: false, dragFrom: { x, y } };
      this.tables.set(t._id, view);
      zone.on('pointerover', () => this.ui.hover(`${t.name} · ${this.store.guestsAt(t._id).length}/${this.store.table(t._id)?.seats ?? t.seats} seated`, 0, 0));
      zone.on('pointerout', () => this.ui.hover(null, 0, 0));
      zone.on('pointerup', (p: Phaser.Input.Pointer) => {
        if (Math.hypot(p.x - p.downX, p.y - p.downY) > 4) return;
        // click with a guest selected seats them here (at the clicked chair if any)
        if (this.selectedGuest) {
          const w = this.cameras.main.getWorldPoint(p.x, p.y);
          const seat = nearestSeat(t.shape, t.seats, t.rotation, w.x - view!.container.x, w.y - view!.container.y, 26);
          void this.store.seatGuest(this.selectedGuest as Id<'guests'>, t._id, seat >= 0 ? seat : undefined);
          this.ui.selectGuest(null);
          return;
        }
        this.select(t._id);
      });
    }
    if (!view.dragging) {
      view.container.setPosition(x, y);
      view.container.setDepth(y);
    }
    if (view.signature !== signature) {
      view.signature = signature;
      this.drawTable(view, t);
    }
  }

  private drawTable(view: TableView, t: Table) {
    const { top, chairs, shadow, label, count, zone } = view;
    top.clear(); chairs.clear(); shadow.clear();
    const box = tableBox(t.shape, t.seats, t.rotation);
    // chairs
    for (const s of seatsFor(t.shape, t.seats, t.rotation)) {
      const a = s.angle;
      const w = 22, h = 20;
      shadow.fillStyle(0x000000, 0.18);
      shadow.fillEllipse(s.x + 2, s.y + 4, w + 4, h);
      chairs.fillStyle(0x6b4a2e, 1);
      chairs.fillRoundedRect(s.x - w / 2, s.y - h / 2, w, h, 5);
      chairs.fillStyle(0x8a6240, 1);
      chairs.fillRoundedRect(s.x - w / 2 + 3, s.y - h / 2 + 3, w - 6, h - 6, 4);
      // a gold bow on the back of the chair, away from the table
      const bx = s.x - Math.cos(a) * -1 * 0 + Math.cos(a) * 11, by = s.y + Math.sin(a) * 11;
      chairs.fillStyle(0xe8c170, 1);
      chairs.fillCircle(bx, by, 3);
    }
    shadow.fillStyle(0x000000, 0.22);
    if (t.shape === 'round') {
      const r = roundRadius(t.seats);
      shadow.fillCircle(3, 6, r + 2);
      top.fillStyle(0xf7f2e8, 1); top.fillCircle(0, 0, r);
      top.lineStyle(3, 0xe3d9c6, 1); top.strokeCircle(0, 0, r);
      top.fillStyle(0xffffff, 0.6); top.fillCircle(-r * 0.25, -r * 0.3, r * 0.45);
      // centrepiece
      top.fillStyle(0x6fa36b, 1); top.fillCircle(0, 0, 7);
      top.fillStyle(0xf2a1b0, 1); top.fillCircle(-3, -3, 3); top.fillCircle(4, -1, 3); top.fillCircle(-1, 4, 3);
      label.setPosition(0, r * 0.45);
      count.setPosition(0, r * 0.45 + 14);
      zone.setSize(r * 2 + 24, r * 2 + 24);
      zone.setInteractive(new Phaser.Geom.Circle((r * 2 + 24) / 2, (r * 2 + 24) / 2, r + 12), Phaser.Geom.Circle.Contains, { draggable: true, useHandCursor: true } as never);
    } else {
      const one = isOneSided(t.rotation);
      const size = rectSize(t.seats, one);
      const w = box.w, h = box.h;
      shadow.fillRoundedRect(-w / 2 + 3, -h / 2 + 6, w, h, 8);
      top.fillStyle(0xf7f2e8, 1); top.fillRoundedRect(-w / 2, -h / 2, w, h, 8);
      top.lineStyle(3, 0xe3d9c6, 1); top.strokeRoundedRect(-w / 2, -h / 2, w, h, 8);
      top.fillStyle(0xffffff, 0.55); top.fillRoundedRect(-w / 2 + 6, -h / 2 + 5, w - 12, 10, 5);
      // runner and candles
      const vertical = isVertical(t.rotation);
      top.fillStyle(0xe8c170, 0.55);
      if (vertical) top.fillRect(-6, -h / 2 + 8, 12, h - 16); else top.fillRect(-w / 2 + 8, -6, w - 16, 12);
      const n = Math.max(1, Math.floor(size.w / 80));
      for (let i = 0; i < n; i++) {
        const u = -size.w / 2 + (size.w / n) * (i + 0.5);
        const cx = vertical ? 0 : u, cy = vertical ? u : 0;
        top.fillStyle(0x6fa36b, 1); top.fillCircle(cx, cy, 6);
        top.fillStyle(0xf2a1b0, 1); top.fillCircle(cx - 2, cy - 2, 2.5); top.fillCircle(cx + 3, cy, 2.5);
      }
      label.setPosition(0, vertical ? -h / 2 - 12 : h / 2 - 1 + 12 * 0);
      if (!vertical) label.setPosition(0, h / 2 + (one ? 12 : -14) + (one ? 0 : 0));
      count.setPosition(label.x, label.y + 14);
      zone.setSize(w + 28, h + 28);
      zone.setInteractive(new Phaser.Geom.Rectangle(0, 0, w + 28, h + 28), Phaser.Geom.Rectangle.Contains, { draggable: true, useHandCursor: true } as never);
    }
    this.input.setDraggable(zone, true);
    label.setText(t.name);
    if (t.shape === 'rect' && !isVertical(t.rotation) && !isOneSided(t.rotation)) {
      // on a two-sided table the name sits on the cloth
      label.setPosition(0, box.h / 2 - 10);
      count.setPosition(0, label.y + 13);
    }
    // seats of a seated guest that no longer exist are handled by the server; refresh the sitters
    for (const g of this.store.guestsAt(t._id)) {
      const ch = this.characters.get(g._id);
      if (ch) this.placeCharacter(ch, g, true);
    }
  }

  private redrawCounts() {
    for (const [id, view] of this.tables) {
      const t = this.store.table(id);
      if (!t) continue;
      const n = this.store.guestsAt(t._id).length;
      view.count.setText(t.seats ? `${n}/${t.seats}` : '');
      view.count.setColor(n > t.seats ? '#c0392b' : n === t.seats ? '#2f7d4f' : '#6e5f54');
    }
  }

  // ---------- characters ----------

  private sheetFor(g: Guest): string {
    const key = `guest_${g.look}_${g.style ?? 'auto'}`;
    if (!this.textures.exists(key)) {
      const canvas = renderSheet(lookFor(g.look, g.style));
      const tex = this.textures.addCanvas(key, canvas)!;
      const cols = FRAMES, rows = canvas.height / FRAME_H;
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) tex.add(r * cols + c, 0, c * FRAME_W, r * FRAME_H, FRAME_W, FRAME_H);
      for (const anim of ['idle', 'walk', 'sit'] as Anim[]) {
        for (const dir of ['right', 'up', 'left', 'down'] as Dir[]) {
          const row = rowFor(anim, dir);
          this.anims.create({
            key: `${key}:${anim}:${dir}`,
            frames: Array.from({ length: FRAMES }, (_, i) => ({ key, frame: row * FRAMES + i })),
            frameRate: anim === 'walk' ? 9 : 4,
            repeat: -1,
          });
        }
      }
    }
    return key;
  }

  private upsertGuest(g: Guest) {
    let ch = this.characters.get(g._id);
    if (ch && ch.sheet !== this.sheetFor(g)) {
      // a new look: swap the sheet in place
      ch.sheet = this.sheetFor(g);
      ch.sprite.setTexture(ch.sheet);
      if (ch.sitting) this.sit(ch, ch.facing);
    }
    if (!ch) {
      const sheet = this.sheetFor(g);
      if (!g.tableId) return; // unseated guests live in the list, not on the floor
      const sprite = this.add.sprite(ENTRY.x, ENTRY.y, sheet).setOrigin(0.5, 1);
      sprite.setData('guestId', g._id);
      sprite.setInteractive({ useHandCursor: true, draggable: true });
      ch = { id: g._id, sprite, sheet, path: [], seat: null, sitting: false, facing: 'down', speed: WALK, leaving: false };
      this.characters.set(g._id, ch);
      sprite.on('pointerover', () => this.ui.hover(this.hoverText(g._id), 0, 0));
      sprite.on('pointerout', () => this.ui.hover(null, 0, 0));
      sprite.on('pointerup', (p: Phaser.Input.Pointer) => {
        if (Math.hypot(p.x - p.downX, p.y - p.downY) > 4) return;
        this.ui.selectGuest(g._id);
      });
      this.placeCharacter(ch, g, false);
      return;
    }
    if (!g.tableId) {
      // walked out: head for the door and vanish
      if (!ch.leaving) {
        ch.leaving = true;
        ch.seat = null;
        ch.sitting = false;
        ch.path = routeTo({ x: ch.sprite.x, y: ch.sprite.y }).reverse().slice(1);
        ch.sprite.setDepth(ch.sprite.y);
      }
      return;
    }
    const target = this.seatPoint(g);
    const same = ch.seat && ch.seat.tableId === g.tableId && ch.seat.index === g.seat;
    if (same && !ch.leaving) {
      // the table may have moved or been resized: sitters follow instantly
      if (ch.sitting && target && (ch.sprite.x !== target.x || ch.sprite.y !== target.y)) this.placeCharacter(ch, g, true);
      return;
    }
    ch.leaving = false;
    this.placeCharacter(ch, g, false);
  }

  private hoverText(id: string): string {
    const g = this.store.guest(id);
    if (!g) return '';
    const t = g.tableId ? this.store.table(g.tableId) : undefined;
    return t ? `${g.name} · ${t.name}, seat ${(g.seat ?? 0) + 1}` : g.name;
  }

  private seatPoint(g: Guest): (Pt & { facing: Dir }) | null {
    const t = g.tableId ? this.store.table(g.tableId) : undefined;
    if (!t || g.seat === undefined) return null;
    const s = seatsFor(t.shape, t.seats, t.rotation)[g.seat];
    if (!s) return null;
    const view = this.tables.get(t._id);
    const tx = view ? view.container.x : t.x;
    const ty = view ? view.container.y : t.y;
    // the sprite's origin is at its feet; a sitter's lap sits just below the chair centre
    return { x: tx + s.x, y: ty + s.y + 6, facing: s.facing };
  }

  /** Sends a character to its seat: walking from where it is, or snapped there instantly. */
  private placeCharacter(ch: Character, g: Guest, instant: boolean) {
    const target = this.seatPoint(g);
    if (!target || !g.tableId || g.seat === undefined) return;
    ch.seat = { tableId: g.tableId, index: g.seat };
    if (instant) {
      ch.path = [];
      ch.sitting = true;
      ch.sprite.setPosition(target.x, target.y);
      this.sit(ch, target.facing);
      return;
    }
    const from = ch.sitting || ch.path.length ? { x: ch.sprite.x, y: ch.sprite.y } : ENTRY;
    ch.sitting = false;
    // from a seat, walk directly; from the door, follow the route
    ch.path = ch.sprite.x === ENTRY.x && ch.sprite.y === ENTRY.y && from === ENTRY ? routeTo(target).slice(1) : [target];
    if (from === ENTRY) ch.sprite.setPosition(ENTRY.x, ENTRY.y);
    ch.sprite.setDepth(ch.sprite.y);
  }

  private sit(ch: Character, facing: Dir) {
    ch.facing = facing;
    ch.sprite.play(`${ch.sheet}:sit:${facing}`, true);
    // sitters behind the table (facing down) draw under the table top, the rest over it
    const t = ch.seat ? this.store.table(ch.seat.tableId) : undefined;
    const ty = t ? (this.tables.get(t._id)?.container.y ?? t.y) : ch.sprite.y;
    ch.sprite.setDepth(ch.sprite.y < ty ? ty - 1 : ch.sprite.y);
    // stagger the loop so a table of ten doesn't move in lockstep
    ch.sprite.anims.setProgress(Math.random());
  }

  update(_time: number, delta: number) {
    const dt = delta / 1000;
    for (const ch of this.characters.values()) {
      if (ch === this.dragCharacter) continue;
      if (ch.path.length === 0) {
        if (ch.leaving) { ch.sprite.destroy(); this.characters.delete(ch.id); continue; }
        if (!ch.sitting) {
          const g = this.store.guest(ch.id);
          if (g) this.placeCharacter(ch, g, true);
        }
        continue;
      }
      const next = ch.path[0];
      const dx = next.x - ch.sprite.x, dy = next.y - ch.sprite.y;
      const dist = Math.hypot(dx, dy);
      const step = ch.speed * dt;
      if (dist <= step) {
        ch.sprite.setPosition(next.x, next.y);
        ch.path.shift();
        if (ch.path.length === 0 && !ch.leaving) {
          const g = this.store.guest(ch.id);
          if (g) this.placeCharacter(ch, g, true);
        }
        continue;
      }
      ch.sprite.x += (dx / dist) * step;
      ch.sprite.y += (dy / dist) * step;
      ch.sprite.setDepth(ch.sprite.y);
      const dir = dirBetween(dx, dy);
      const key = `${ch.sheet}:walk:${dir}`;
      if (ch.sprite.anims.currentAnim?.key !== key) ch.sprite.play(key, true);
      ch.facing = dir;
    }
  }
}
