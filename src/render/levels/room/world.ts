// Room floor at 1:1 (mockup datacenter/world.js). Back to front: yard and back wall,
// gateway and data plane, back of house (network rack, UPS, trunk), the v3 signs, then row by
// row the hot-aisle exhaust, fibre tray, racks (the rack level's own minis), cold aisle and
// CRACs; then the side and front walls and live overlays. Every light is real state.
import { BG, P, R, createZoomLink, dither, drawGhost, frame as outline, hallDim, keyOf, smooth, zoomLink } from '../../core';
import type { GhostState, LevelRegistry, Rect, ViewPresentation, WorldFrame } from '../../core';
import type { RackSlotView, RoomSnapshot } from '../../../game';
import { fanAt } from '../rack/art';
import type { FanBank } from '../rack/art';
import { coolGrade, roomPowered } from './state';
import { drawBack, drawFront } from './static';
import { FIBRE, drawCrac, drawExhaust, drawGateway, drawPerf, drawTrayRun, drawTrunk } from './sprites';
import type { CracArt } from './sprites';
import { cracCount, drawDataPlane, drawJob, drawNetRack, drawPlumbing, drawPowerPath, drawThermo, drawUpsBank, drawZoneSign } from './infra';
import { COLS, CRAC_FEET, GATEWAY, IY, JOB_PATHS, RACK, RACK_RECTS, WORLD_W, WORLD_X, exhaustY, hallOf, rackX, rowY, trayY, worldH } from './layout';

type G = CanvasRenderingContext2D;
const crac: CracArt = { grade: 1, angle: 0, duty: 0, powered: true };

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
function drawRow(g: G, s: RoomSnapshot, r: number, registry: LevelRegistry, frame: WorldFrame, lit: boolean, heat: number): void {
  let first = -1, last = -1, load = 0, n = 0;
  for (let c = 0; c < COLS; c++) {
    const k: RackSlotView | undefined = s.racks[r * COLS + c];
    if (!k || k.rackId === null) continue;
    if (first < 0) first = c;
    last = c; load += k.load; n++;
  }
  if (first < 0) return;
  const hot = heat > 1, x0 = rackX(first), x1 = rackX(last) + RACK.w, G0 = hallOf(s.rows);
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
    if (hot) { const a = g.globalAlpha; g.globalAlpha = a * 0.16; R(g, rr.x + 1, rr.y + 4, 14, 22, P.heat); g.globalAlpha = a; outline(g, rr.x, rr.y, 16, 28, P.heat); }
  }
  for (let c = first; c <= last; c++) {
    const k = s.racks[r * COLS + c];
    if (!k || k.rackId === null) continue;
    const x = rackX(c), y = rowY(r) + 1;
    drawPerf(g, x, y);
    if (hot) { const a = g.globalAlpha; g.globalAlpha = a * 0.25; dither(g, x + 1, y, RACK.pitch - 1, 10, P.heat); g.globalAlpha = a; }
  }
}

export interface WorldContext { readonly registry: LevelRegistry; readonly fans: FanBank }
export function drawWorld(g: G, s: RoomSnapshot, view: ViewPresentation, frame: WorldFrame, ctx: WorldContext): void {
  const rows = Math.max(1, s.rows), G0 = hallOf(rows), H = worldH(rows);
  const powered = roomPowered(s), paused = frame.paused, live = powered && !paused && !s.crashed;
  let traffic = false;
  const ports = s.network.switch.ports;
  for (let i = 0; i < ports.length; i++) if (ports[i].active) { traffic = true; break; }
  let uplink = false;
  for (let i = 0; i < s.network.switch.uplinks.length; i++) if (s.network.switch.uplinks[i].active) { uplink = true; break; }
  const lit = live && traffic, heat = Math.max(0, (s.tempF - 62) / 30);

  R(g, WORLD_X, 0, WORLD_W, H, BG.room);
  drawBack(g, rows);
  drawGateway(g, GATEWAY, 1 + Math.min(3, s.network.switch.generation), live && (uplink || traffic), powered);
  drawDataPlane(g, s, live);
  drawNetRack(g, s, live, powered, frame.timeMs);
  drawPowerPath(g, s, powered);
  drawUpsBank(g, s);
  R(g, G0.ix + 17, IY - 15, 4, 1, FIBRE);
  drawTrunk(g, G0.trunk, IY - 16, trayY(rows - 1) + 2, rows, rowY, lit);
  drawThermo(g, s, paused, powered);
  drawZoneSign(g, s, paused);
  const cracs = cracCount(rows);
  drawPlumbing(g, s, cracs);
  crac.grade = coolGrade(s); crac.powered = powered;
  crac.duty = powered && !paused ? Math.max(0, Math.min(1, s.cooler.duty)) : 0;
  crac.angle = fanAt(ctx.fans, 0, s.roomId, frame.timeMs, crac.duty, frame.reducedMotion);
  for (let r = 0; r < rows; r++) {
    drawRow(g, s, r, ctx.registry, frame, lit, heat);
    if (r % 2 === 0) { drawCrac(g, CRAC_FEET[r], crac); drawCrac(g, CRAC_FEET[r + 1], crac); }
  }
  drawFront(g, rows);

  const free = nextFreeSlot(s);
  if (free >= 0 && !frame.zoom) {
    const r = RACK_RECTS[free], cx = r.x + (r.w >> 1), cy = r.y + (r.h >> 1);
    drawGhost(g, r.x - 1, r.y - 1, r.w + 2, r.h + 2, ghostState(view));
    R(g, cx - 3, cy - 1, 7, 3, P.ink); R(g, cx - 1, cy - 3, 3, 7, P.ink); R(g, cx - 2, cy, 5, 1, P.paper); R(g, cx, cy - 2, 1, 5, P.paper);
  }
  if (live) for (let i = 0; i < ports.length; i++) {
    const p = ports[i], slot = p.peer;
    if (p.active && slot !== null && slot < JOB_PATHS.length && s.racks[slot]?.rackId != null) drawJob(g, JOB_PATHS[slot], p.progress);
  }
  if (!powered || s.crashed) {
    const a = g.globalAlpha; g.globalAlpha = a * (powered ? 0.35 : 0.55);
    R(g, G0.ix, IY - 4, G0.iw, G0.ib - IY + 4, P.ink); g.globalAlpha = a;
    if (s.crashed) outline(g, G0.ix - 1, IY - 5, G0.iw + 2, G0.ib - IY + 6, P.fault);
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
  const fr: Rect = RACK_RECTS[slot], a = 0.7 * smooth(0, 0.5, hallDim(l, frame.reducedMotion));
  if (a <= 0.01) return;
  const x0 = fr.x, y0 = fr.y + 1, x1 = fr.x + 16, y1 = fr.y + 29, alpha = g.globalAlpha, W0 = WORLD_X, W1 = WORLD_X + WORLD_W;
  g.globalAlpha = alpha * a; g.fillStyle = P.ink;
  g.fillRect(W0, 0, W1 - W0, y0); g.fillRect(W0, y1, W1 - W0, H - y1);
  g.fillRect(W0, y0, x0 - W0, y1 - y0); g.fillRect(x1, y0, W1 - x1, y1 - y0);
  g.globalAlpha = alpha * 0.5 * a; R(g, x0 - 2, y1, 20, 4, P.coolHi);
  g.globalAlpha = alpha * 0.28 * a; R(g, x0 - 4, y1 + 4, 24, 3, P.coolHi);
  g.globalAlpha = alpha * 0.7 * a; outline(g, x0 - 1, y0 - 1, 18, y1 - y0 + 1, P.paper);
  g.globalAlpha = alpha;
}
