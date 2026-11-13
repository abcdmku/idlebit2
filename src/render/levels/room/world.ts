// Room floor at 1:1 (mockup datacenter/world.js). Back to front: yard and back wall,
// gateway and data plane, back of house (network rack, UPS, trunk), the v3 signs, then row by
// row the hot-aisle exhaust, fibre tray, racks (the rack level's own minis), cold aisle and
// CRACs; then the side and front walls and live overlays. Every light is real state.
import { BG, P, R, copyRect, createZoomLink, dither, drawGhost, frame as outline, hallDim, keyOf, smooth, zoomLink } from '../../core';
import type { GhostState, LevelRegistry, Rect, ViewPresentation, WorldFrame } from '../../core';
import type { RackSlotView, RoomSnapshot } from '../../../game';
import { fanAt } from '../rack/art';
import type { FanBank } from '../rack/art';
import { coolGrade } from './state';
import { drawBack, drawFront } from './static';
import { FIBRE, drawCrac, drawExhaust, drawGateway, drawPerf, drawTrayRun, drawTrunk } from './sprites';
import type { CracArt } from './sprites';
import { drawRoomFlows } from './flows';
import { cracCount, drawDataPlane, drawJob, drawNetRack, drawPlumbing, drawPowerPath, drawThermo, drawUpsBank, drawZoneSign } from './infra';
import { COLS, G, RACK_PITCH, RACK_W, WORLD_X, exhaustY, rackX, rowY, trayY } from './layout';

type G = CanvasRenderingContext2D;
const crac: CracArt = { grade: 1, angle: 0, duty: 0 }, site: Rect = { x: 0, y: 0, w: 0, h: 0 };

/** First empty slot in FIFO order (row-major), or -1 when the floor is full. */
export function nextFreeSlot(s: RoomSnapshot): number {
  const n = Math.min(s.racks.length, s.rows * COLS);
  for (let i = 0; i < n; i++) if (s.racks[i].rackId === null) return i;
  return -1;
}
function ghostState(view: ViewPresentation): GhostState {
  if (view.picked === 'rack') return 'picked';
  const q = view.quotes?.quotes;
  if (q) for (let i = 0; i < q.length; i++) if (q[i].action.type === 'addUnit' && q[i].affordable) return 'afford';
  return 'open';
}
/** The add site spans at most this many free slots. */
const SITE_SLOTS = 3;
/**
 * The add site on the next free slot: the slot and the free slots east of it in its row, three at most (46 × 30 art
 * px), so its control holds a name over a price with air between the text and the rack beside it; a narrow hall's
 * 22 px rack takes its floor tile too (46 × 31). The row's last slot stands alone, 16 px wide.
 */
export function addRackRect(s: RoomSnapshot, free: number, out: Rect): Rect {
  copyRect(G.racks[free]!, out);
  for (let k = 1; k < SITE_SLOTS && (free + k) % COLS !== 0 && s.racks[free + k]?.rackId === null; k++) out.w += RACK_PITCH;
  if (out.h < 30) out.h += G.tileH - 1;
  return out;
}
/** The floor is full and the room may grow: the next row is the build site. */
export const canAddRow = (s: RoomSnapshot): boolean => nextFreeSlot(s) < 0 && s.rows < s.maxRows;
/** A rack in trouble, at full strength: hot or PDU-loaded (amber, red past the limit). */
function rackMark(g: G, k: RackSlotView, rr: Rect): void {
  const h = rr.h - 1;
  if (k.tempF > 80) outline(g, rr.x, rr.y, 16, h, k.tempF >= 100 ? P.fault : P.amber);
  else if (k.pduUsage > 0.9 && k.powered !== false) outline(g, rr.x, rr.y, 16, h, P.amber);
}
function drawRow(g: G, s: RoomSnapshot, r: number, registry: LevelRegistry, frame: WorldFrame, lit: boolean, heat: number): void {
  let first = -1, last = -1, load = 0, n = 0;
  for (let c = 0; c < COLS; c++) {
    const k: RackSlotView | undefined = s.racks[r * COLS + c];
    if (!k || k.rackId === null) continue;
    if (first < 0) first = c;
    last = c; load += k.load; n++;
  }
  if (first < 0) return;
  const hot = heat > 1, x0 = rackX(first), x1 = rackX(last) + RACK_W, G0 = G, RACK_RECTS = G.racks;
  drawExhaust(g, x0, x1, exhaustY(r), (load / n) * (0.35 + 0.65 * Math.min(1.2, heat)), hot);
  drawTrayRun(g, G0.trunk + 2, x1, trayY(r), lit);
  const mini = registry.has('rack') ? registry.level('rack') : null;
  for (let c = first; c <= last; c++) {
    const k = s.racks[r * COLS + c];
    if (!k || k.rackId === null) continue;
    const rr = RACK_RECTS[r * COLS + c];
    // A plain cabinet first, so a rack is never invisible; the rack level draws its own mini over it.
    R(g, rr.x, rr.y, rr.w, rr.h - 1, P.ink); R(g, rr.x + 1, rr.y + 1, rr.w - 2, rr.h - 3, P.substrate);
    if (mini) mini.drawMini(g, k, rr, frame);
    if (hot) { const a = g.globalAlpha; g.globalAlpha = a * 0.16; R(g, rr.x + 1, rr.y + 4, 14, rr.h - 8, P.heat); g.globalAlpha = a; }
  }
  for (let c = first; c <= last; c++) {
    const k = s.racks[r * COLS + c];
    if (!k || k.rackId === null) continue;
    const x = rackX(c), y = rowY(r) + 1;
    drawPerf(g, x, y, G.tileH);
    if (hot || k.tempF > 80) { const a = g.globalAlpha; g.globalAlpha = a * 0.25; dither(g, x + 1, y, RACK_PITCH - 1, G.tileH - 1, P.heat); g.globalAlpha = a; }
  }
  // marks last, over the whole row, so the next cabinet never covers one
  for (let c = first; c <= last; c++) { const k = s.racks[r * COLS + c]; if (k && k.rackId !== null) rackMark(g, k, RACK_RECTS[r * COLS + c]!); }
}

export interface WorldContext { readonly registry: LevelRegistry; readonly fans: FanBank }
export function drawWorld(g: G, s: RoomSnapshot, view: ViewPresentation, frame: WorldFrame, ctx: WorldContext): void {
  const rows = Math.max(1, s.rows), G0 = G, H = G.worldH, IY = G.iy, WORLD_W = G.worldW, RACK_RECTS = G.racks, JOB_PATHS = G.jobPaths;
  const paused = frame.paused, live = !paused;
  let traffic = false;
  const ports = s.network.switch.ports;
  for (let i = 0; i < ports.length; i++) if (ports[i].active) { traffic = true; break; }
  let uplink = false;
  for (let i = 0; i < s.network.switch.uplinks.length; i++) if (s.network.switch.uplinks[i].active) { uplink = true; break; }
  const lit = live && traffic, heat = Math.max(0, (s.tempF - 62) / 30);

  R(g, WORLD_X, 0, WORLD_W, H, BG.room);
  drawBack(g);
  drawGateway(g, G.gateway, 1 + Math.min(3, s.network.switch.generation), live && (uplink || traffic));
  drawDataPlane(g, s, live);
  drawNetRack(g, s, live, frame.timeMs);
  drawPowerPath(g, s);
  drawUpsBank(g, s);
  if (G0.trunk > G0.net.x + G0.net.w) R(g, G0.ix + 17, IY - 15, 4, 1, FIBRE);
  drawTrunk(g, G0.trunk, G0.trunkY, trayY(rows - 1) + 2, rows, rowY, G0.pitch - 12, lit);
  drawThermo(g);
  drawZoneSign(g, s, paused);
  const cracs = cracCount();
  drawPlumbing(g, s, cracs);
  crac.grade = coolGrade(s);
  crac.duty = !paused ? Math.max(0, Math.min(1, s.cooler.duty)) : 0;
  crac.angle = fanAt(ctx.fans, 0, s.roomId, frame.timeMs, crac.duty, frame.reducedMotion);
  // back to front: each CRAC before the first row that stands in front of its foot
  let c = 0;
  for (let r = 0; r < rows; r++) {
    for (; c < cracs && G0.cracs[c]!.y < rowY(r) - G0.rackH; c++) drawCrac(g, G0.cracs[c]!, crac);
    drawRow(g, s, r, ctx.registry, frame, lit, heat);
  }
  for (; c < cracs; c++) drawCrac(g, G0.cracs[c]!, crac);
  drawFront(g);

  const free = nextFreeSlot(s);
  if (free >= 0 && !frame.zoom) {
    // the ghost brackets the whole site (targets.ts), where the UI prints the add's name and price
    const r = RACK_RECTS[free]!, a = addRackRect(s, free, site), cx = r.x + (r.w >> 1), cy = r.y + (r.h >> 1);
    drawGhost(g, a.x - 1, a.y - 1, a.w + 2, a.h + 2, ghostState(view));
    // the add mark, unless a DOM buy control sits on the site
    if (!view.sourceActions?.includes('add:rack')) { R(g, cx - 3, cy - 1, 7, 3, P.ink); R(g, cx - 1, cy - 3, 3, 7, P.ink); R(g, cx - 2, cy, 5, 1, P.paper); R(g, cx, cy - 2, 1, 5, P.paper); }
  }
  if (canAddRow(s) && !frame.zoom) {
    const r = G.rowSite;
    drawGhost(g, r.x, r.y, r.w, r.h, 'open');
    // its "+" unless the UI prints the add on it
    if (!view.sourceActions?.includes('row')) { R(g, r.x + 5, r.y + 4, 7, 3, P.ink); R(g, r.x + 7, r.y + 2, 3, 7, P.ink); R(g, r.x + 6, r.y + 5, 5, 1, P.paper); R(g, r.x + 8, r.y + 3, 1, 5, P.paper); }
  }
  // D25 shard flows; before the sim sends them, each port's own transfer progress
  if (live && !drawRoomFlows(g, s, frame)) for (let i = 0; i < ports.length; i++) {
    const p = ports[i], slot = p.peer;
    if (p.active && slot !== null && slot < JOB_PATHS.length && s.racks[slot]?.rackId != null) drawJob(g, JOB_PATHS[slot], p.progress);
  }
  drillDim(g, s, frame, H);
}

const link = createZoomLink();
/** Rack id inside a 'rack:<id>' path key, or -1. No allocation. */
export function rackKeyId(key: string): number {
  if (key.length < 6 || key.charCodeAt(0) !== 114 || key.charCodeAt(4) !== 58 || !key.startsWith('rack')) return -1;
  let id = 0;
  for (let i = 5; i < key.length; i++) { const d = key.charCodeAt(i) - 48; if (d < 0 || d > 9) return -1; id = id * 10 + d; }
  return id;
}
/** Room ↔ Rack (hallDim): the hall dims around the chosen rack and a work light comes up on its aisle. */
function drillDim(g: G, s: RoomSnapshot, frame: WorldFrame, H: number): void {
  const l = zoomLink(frame.zoom, keyOf(s), link);
  if (!l || !l.child) return;
  const id = rackKeyId(l.child);
  if (id < 0) return;
  let slot = -1;
  for (let i = 0; i < s.racks.length; i++) if (s.racks[i].rackId === id) { slot = i; break; }
  if (slot < 0) return;
  const fr: Rect = G.racks[slot]!, WORLD_W = G.worldW, a = 0.7 * smooth(0, 0.5, hallDim(l, frame.reducedMotion));
  if (a <= 0.01) return;
  const x0 = fr.x, y0 = fr.y + 1, x1 = fr.x + 16, y1 = fr.y + fr.h - 1, alpha = g.globalAlpha, W0 = WORLD_X, W1 = WORLD_X + WORLD_W;
  g.globalAlpha = alpha * a; g.fillStyle = P.ink;
  g.fillRect(W0, 0, W1 - W0, y0); g.fillRect(W0, y1, W1 - W0, H - y1);
  g.fillRect(W0, y0, x0 - W0, y1 - y0); g.fillRect(x1, y0, W1 - x1, y1 - y0);
  g.globalAlpha = alpha * 0.5 * a; R(g, x0 - 2, y1, 20, 4, P.coolHi);
  g.globalAlpha = alpha * 0.28 * a; R(g, x0 - 4, y1 + 4, 24, 3, P.coolHi);
  g.globalAlpha = alpha * 0.7 * a; outline(g, x0 - 1, y0 - 1, 18, y1 - y0 + 1, P.paper);
  g.globalAlpha = alpha;
}
