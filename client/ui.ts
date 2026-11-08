// The HTML around the canvas: top bar, guest list, table inspector, hover label and toasts.
import type { Id } from '../convex/_generated/dataModel';
import { FRAME_H, FRAME_W, lookFor, renderSheet, rowFor, FRAMES } from './characters';
import type { PlanScene, SceneEvents } from './scenes/PlanScene';
import type { Guest, PlanState, Store, Table } from './store';
import { CALILE_DRAFT, WORLD } from './venue';
import { chairSide, nextSides, turned } from './tables';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export function bindUi(store: Store) {
  let scene: PlanScene | null = null;
  let selectedTable: string | null = null;
  let selectedGuest: string | null = null;
  let filter = '';
  let state: PlanState = store.state;

  const status = $('status');
  const toast = $('toast');
  const hover = $('hover');
  let toastTimer = 0;
  const say = (msg: string, ms = 2200) => {
    toast.textContent = msg;
    toast.style.display = 'block';
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => (toast.style.display = 'none'), ms);
  };

  // ---------- avatars for the list ----------
  const avatars = new Map<string, string>();
  const avatarFor = (g: Guest): string => {
    const k = `${g.look}:${g.style ?? ''}`;
    let url = avatars.get(k);
    if (!url) {
      const sheet = renderSheet(lookFor(g.look, g.style));
      const c = document.createElement('canvas');
      c.width = FRAME_W; c.height = FRAME_H;
      const ctx = c.getContext('2d')!;
      ctx.drawImage(sheet, 0, rowFor('idle', 'down') * FRAME_H, FRAME_W, FRAME_H, 0, 0, FRAME_W, FRAME_H);
      void FRAMES;
      url = c.toDataURL();
      avatars.set(k, url);
    }
    return url;
  };

  // ---------- scene events ----------
  const events: SceneEvents = {
    selectTable(id) {
      selectedTable = id;
      renderInspector();
    },
    selectGuest(id) {
      selectedGuest = id;
      scene?.setSelectedGuest(id);
      renderList();
      renderInspector();
      if (id) say('Now click a table or chair to seat them', 1800);
    },
    hover(text) {
      if (!text) { hover.style.display = 'none'; return; }
      hover.textContent = text;
      hover.style.display = 'block';
    },
    notify(text) {
      say(text);
    },
  };
  window.addEventListener('mousemove', (e) => {
    hover.style.left = `${e.clientX + 14}px`;
    hover.style.top = `${e.clientY + 16}px`;
  });

  // ---------- top bar ----------
  const planName = $<HTMLInputElement>('planName');
  planName.addEventListener('change', () => void store.renamePlan(planName.value));
  const viewCentre = (): { x: number; y: number } => {
    if (!scene) return { x: WORLD.w / 2, y: WORLD.h / 2 };
    const cam = scene.cameras.main;
    const p = cam.getWorldPoint(cam.width / 2 + 10, cam.height / 2 - 20);
    return { x: Math.round(p.x), y: Math.round(p.y) };
  };
  $('addRound').onclick = async () => {
    const c = viewCentre();
    const id = await store.addTable('round', 10, c.x, c.y);
    if (id) scene?.select(id as Id<'tables'>);
  };
  $('addRect').onclick = async () => {
    const c = viewCentre();
    const id = await store.addTable('rect', 8, c.x, c.y, 0);
    if (id) scene?.select(id as Id<'tables'>);
  };
  const loadDraft = $<HTMLButtonElement>('loadDraft');
  loadDraft.onclick = async () => {
    loadDraft.disabled = true;
    try {
      // one transaction; tables the plan already has (by name) are left alone
      const n = await store.addTables(CALILE_DRAFT.map((t) => ({ ...t })));
      say(n ? `Placed ${n} tables from the Calile draft` : 'The Calile draft is already on this plan');
      if (n) scene?.fit();
    } finally {
      loadDraft.disabled = false;
    }
  };
  $('fit').onclick = () => scene?.fit();
  $('plan').onclick = () => { scene?.togglePlan(); $('plan').classList.toggle('on'); };
  $('share').onclick = async () => {
    const url = new URL(location.href);
    url.searchParams.set('plan', store.slug);
    try { await navigator.clipboard.writeText(url.toString()); say('Link copied'); } catch { prompt('Copy this link', url.toString()); }
  };

  // ---------- guest list ----------
  const list = $('list');
  const counts = $('counts');
  const addForm = $<HTMLFormElement>('addForm');
  const guestName = $<HTMLInputElement>('guestName');
  addForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = guestName.value.trim();
    if (!name) return;
    guestName.value = '';
    await store.addGuest(name);
    guestName.focus();
  });
  $<HTMLInputElement>('filter').addEventListener('input', (e) => {
    filter = (e.target as HTMLInputElement).value.trim().toLowerCase();
    renderList();
  });
  const bulk = $('bulk');
  const bulkText = $<HTMLTextAreaElement>('bulkText');
  $('bulkToggle').onclick = () => { bulk.classList.toggle('open'); if (bulk.classList.contains('open')) bulkText.focus(); };
  $('bulkCancel').onclick = () => bulk.classList.remove('open');
  $('bulkAdd').onclick = async () => {
    const names = bulkText.value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    if (!names.length) return;
    const n = await store.addGuests(names);
    bulkText.value = '';
    bulk.classList.remove('open');
    say(`Added ${n ?? 0} guests`);
  };

  const tableName = (t: Table | undefined) => t?.name ?? '';

  function renderList() {
    const guests = state.guests.filter((g) => !filter || g.name.toLowerCase().includes(filter));
    const unseated = guests.filter((g) => !g.tableId);
    const seated = guests.filter((g) => g.tableId);
    const total = state.guests.length;
    const seatedN = state.guests.filter((g) => g.tableId).length;
    counts.textContent = total ? `${seatedN}/${total} seated` : '';
    list.replaceChildren();
    if (!guests.length) {
      const e = document.createElement('div');
      e.className = 'empty';
      e.textContent = total ? 'No guests match' : 'Add guests above, or paste a list. Then drag each onto a chair.';
      list.appendChild(e);
      return;
    }
    const group = (title: string, n: number) => {
      const h = document.createElement('div');
      h.className = 'group';
      h.innerHTML = `<span>${title}</span><span>${n}</span>`;
      list.appendChild(h);
    };
    if (unseated.length) {
      group('to seat', unseated.length);
      for (const g of unseated) list.appendChild(chip(g));
    }
    if (seated.length) {
      group('seated', seated.length);
      const byTable = new Map(state.tables.map((t) => [t._id, t] as const));
      seated
        .slice()
        .sort((a, b) => tableName(byTable.get(a.tableId!)).localeCompare(tableName(byTable.get(b.tableId!)), undefined, { numeric: true }) || (a.seat ?? 0) - (b.seat ?? 0))
        .forEach((g) => list.appendChild(chip(g, byTable.get(g.tableId!))));
    }
  }

  // the chip being pressed or dragged, shared by one pair of window listeners
  let chipDrag: { g: Guest; t?: Table; down: { x: number; y: number }; dragging: boolean } | null = null;
  const ghost = $('ghost');
  window.addEventListener('pointermove', (e) => {
    const d = chipDrag;
    if (!d) return;
    if (!d.dragging && Math.hypot(e.clientX - d.down.x, e.clientY - d.down.y) > 6) {
      d.dragging = true;
      ghost.textContent = d.g.name;
      ghost.style.display = 'block';
      document.body.style.cursor = 'grabbing';
    }
    if (d.dragging) {
      ghost.style.left = `${e.clientX}px`;
      ghost.style.top = `${e.clientY}px`;
      if (scene) {
        const w = scene.worldPoint(e.clientX, e.clientY);
        scene.showDropTargetAt(w.x, w.y);
      }
    }
  });
  window.addEventListener('pointerup', (e) => {
    const d = chipDrag;
    if (!d) return;
    chipDrag = null;
    ghost.style.display = 'none';
    document.body.style.cursor = '';
    scene?.clearDropTarget();
    const { g, t } = d;
    if (!d.dragging) {
      events.selectGuest(selectedGuest === g._id ? null : g._id);
      if (t && scene) scene.centerOn(t.x, t.y);
      return;
    }
    if (!scene) return;
    const over = document.elementFromPoint(e.clientX, e.clientY);
    if (over && over.closest('.panel')) return; // dropped back on a panel: nothing
    const w = scene.worldPoint(e.clientX, e.clientY);
    const hit = scene.seatAt(w.x, w.y);
    if (hit) void store.seatGuest(g._id, hit.tableId, hit.seat).then((ok) => { if (ok === false) say('That table is full'); });
    else if (t) void store.unseatGuest(g._id);
  });

  function chip(g: Guest, t?: Table): HTMLElement {
    const el = document.createElement('div');
    el.className = 'chip' + (selectedGuest === g._id ? ' selected' : '');
    const img = document.createElement('img');
    img.className = 'avatar';
    img.src = avatarFor(g);
    img.draggable = false;
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = g.name;
    name.title = 'Double-click to rename';
    const where = document.createElement('span');
    where.className = 'where';
    where.textContent = t ? `${t.name} · ${(g.seat ?? 0) + 1}` : '';
    const st = document.createElement('button');
    st.className = 'x style';
    st.textContent = g.style === 'fem' ? '♀' : g.style === 'masc' ? '♂' : '◐';
    st.title = `Look: ${g.style === 'fem' ? 'feminine' : g.style === 'masc' ? 'masculine' : 'auto'} · click to change`;
    st.onclick = (e) => {
      e.stopPropagation();
      const next = g.style === 'fem' ? 'masc' : g.style === 'masc' ? null : 'fem';
      void store.setGuestStyle(g._id, next);
    };
    const x = document.createElement('button');
    x.className = 'x';
    x.textContent = '×';
    x.title = t ? 'Back to the list' : 'Remove guest';
    x.onclick = (e) => {
      e.stopPropagation();
      if (t) void store.unseatGuest(g._id);
      else if (confirm(`Remove ${g.name} from the guest list?`)) void store.removeGuest(g._id);
    };
    el.append(img, name, where, st, x);
    name.ondblclick = (e) => {
      e.stopPropagation();
      const n = prompt('Rename guest', g.name);
      if (n && n.trim() && n.trim() !== g.name) void store.renameGuest(g._id, n.trim());
    };
    // click selects (then click a table); press-and-move drags onto the floor
    el.addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement).tagName === 'BUTTON') return;
      chipDrag = { g, t, down: { x: e.clientX, y: e.clientY }, dragging: false };
    });
    return el;
  }

  // ---------- inspector ----------
  const inspector = $('inspector');
  const tName = $<HTMLInputElement>('tableName');
  const seatsInput = $<HTMLInputElement>('seatsInput');
  const seatList = $('seatList');
  tName.addEventListener('change', () => { if (selectedTable) void store.updateTable(selectedTable as Id<'tables'>, { name: tName.value }); });
  const setSeats = (n: number) => { if (selectedTable) void store.updateTable(selectedTable as Id<'tables'>, { seats: n }); };
  seatsInput.addEventListener('change', () => setSeats(Number(seatsInput.value)));
  $('seatsMinus').onclick = () => setSeats(Number(seatsInput.value) - 1);
  $('seatsPlus').onclick = () => setSeats(Number(seatsInput.value) + 1);
  $('shapeRound').onclick = () => { if (selectedTable) void store.updateTable(selectedTable as Id<'tables'>, { shape: 'round' }); };
  $('shapeRect').onclick = () => { if (selectedTable) void store.updateTable(selectedTable as Id<'tables'>, { shape: 'rect' }); };
  $('rotTurn').onclick = () => {
    const t = store.table(selectedTable);
    if (t) void store.updateTable(t._id, { rotation: turned(t.rotation) });
  };
  $('rotSides').onclick = () => {
    const t = store.table(selectedTable);
    if (t) void store.updateTable(t._id, { rotation: nextSides(t.rotation) });
  };
  $('closeInspector').onclick = () => scene?.select(null);
  $('centerTable').onclick = () => { const t = store.table(selectedTable); if (t) scene?.centerOn(t.x, t.y); };
  $('clearTable').onclick = () => {
    const t = store.table(selectedTable);
    if (!t) return;
    for (const g of store.guestsAt(t._id)) void store.unseatGuest(g._id);
  };
  $('deleteTable').onclick = () => {
    const t = store.table(selectedTable);
    if (t && confirm(`Remove ${t.name}? Its guests go back to the list.`)) void store.removeTable(t._id);
  };

  function renderInspector() {
    const t = store.table(selectedTable);
    if (!t) { inspector.classList.remove('open'); return; }
    inspector.classList.add('open');
    $('tableKind').textContent = t.shape === 'round' ? (t.seats ? 'round table' : 'table, no seats') : chairSide(t.rotation) !== 'both' ? 'head table' : 'rectangular table';
    if (document.activeElement !== tName) tName.value = t.name;
    seatsInput.value = String(t.seats);
    $('shapeRound').classList.toggle('on', t.shape === 'round');
    $('shapeRect').classList.toggle('on', t.shape === 'rect');
    const rect = t.shape === 'rect';
    $('rotLabel').style.display = rect ? '' : 'none';
    $('rotRow').style.display = rect ? '' : 'none';
    const side = chairSide(t.rotation);
    $('rotSides').textContent = side === 'both' ? 'both sides' : side === 'near' ? 'one side ↓→' : 'one side ↑←';
    $('rotSides').classList.toggle('on', side !== 'both');
    const seated = new Map(store.guestsAt(t._id).map((g) => [g.seat, g] as const));
    seatList.replaceChildren();
    for (let i = 0; i < t.seats; i++) {
      const g = seated.get(i);
      const row = document.createElement('div');
      row.className = 'seat' + (selectedGuest && !g ? ' target' : '');
      const n = document.createElement('span'); n.className = 'n'; n.textContent = String(i + 1);
      const who = document.createElement('span');
      who.className = 'who' + (g ? '' : ' free');
      who.textContent = g ? g.name : selectedGuest ? 'seat here' : 'empty';
      row.append(n, who);
      if (g) {
        const x = document.createElement('button');
        x.className = 'x'; x.textContent = '×'; x.title = 'Back to the list';
        x.onclick = (e) => { e.stopPropagation(); void store.unseatGuest(g._id); };
        row.appendChild(x);
        row.onclick = () => events.selectGuest(g._id);
      } else {
        row.onclick = () => {
          if (selectedGuest) { void store.seatGuest(selectedGuest as Id<'guests'>, t._id, i); events.selectGuest(null); }
        };
      }
      seatList.appendChild(row);
    }
    const over = store.guestsAt(t._id).filter((g) => g.seat === undefined || g.seat >= t.seats);
    if (over.length) {
      const w = document.createElement('div');
      w.className = 'seat';
      w.textContent = `${over.length} without a chair`;
      seatList.appendChild(w);
    }
  }

  // ---------- store ----------
  store.subscribe((s) => {
    state = s;
    if (store.error) { status.textContent = store.error; status.classList.add('err'); }
    else { status.textContent = store.connected ? `plan: ${store.slug} · live` : 'connecting…'; status.classList.remove('err'); }
    if (s.plan && document.activeElement !== planName) planName.value = s.plan.name;
    if (selectedGuest && !s.guests.some((g) => g._id === selectedGuest)) selectedGuest = null;
    renderList();
    renderInspector();
  });

  return {
    events,
    attach(s: PlanScene) {
      scene = s;
    },
  };
}
