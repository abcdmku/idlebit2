// Rack world (mockup levels/rack/world.js), now the whole room row (D17.2): every rack of the
// row at its true column, the neighbours darkened, the active rack drawn in full on top.
// The active rack: cabinet, the five infrastructure slots (D31 Power control under the cooler), servers, patch cables and the
// uplink entering from the top, real transfers, the next-slot ghost, the save icon and lamp,
// and the sled that slides out on a drill into a server.
import { BG, P, R, createZoomLink, drawGhost, drawSaveIcon, drawUnitLamp, glowBit, keyOf, lampState, pathAt, sledOut, zoomLink } from '../../core';
import type { GhostState, LevelRegistry, Point, ViewPresentation, WorldFrame } from '../../core';
import type { RackSnapshot, SystemId } from '../../../game';
import { createRoute, patchRoute, CHILD, LAMP, NU, OPEN, ROW_COLS, ROW_W, SAVE_AT, SLED, U, U0, UPLINK_ROUTE, WORLD, CAB, colX, liftOf, serverRect, slotY, serverRow } from './layout';
import { fanAt } from './art';
import type { FanBank } from './art';
import { drawClips, drawPatch, drawUplink, shell, sledInterior } from './cabinet';
import { drawCooler, drawLB, drawPdu, drawSwitch } from './infra';
import { drawPowerCtl } from './powerCtl';
import { drawNeighbour } from './neighbour';
import { drawRackFlows } from './flows';
import { rackCol, rowViews } from './row';
import { drawServer, rackDark, serverLook } from './sprites';

type G = CanvasRenderingContext2D;
export interface RackContext { readonly registry: LevelRegistry; readonly fans: FanBank }
const route = createRoute(), point: Point = { x: 0, y: 0 }, sledRect = { x: 0, y: 0, w: 0, h: 0 };

/** First empty server slot, or -1 when all 12 hold a server. */
export function nextFreeServer(s: RackSnapshot): number {
  for (let i = 0; i < s.servers.length; i++) if (s.servers[i].systemId === null) return i;
  return -1;
}
/** Server slot running system `id`, or -1. */
export function slotOfSystem(s: RackSnapshot, id: number): number {
  for (let i = 0; i < s.servers.length; i++) if (s.servers[i].systemId === id) return i;
  return -1;
}
/** System id inside a 'system:<id>' path key, or -1. No allocation. */
export function systemKeyId(key: string): number {
  if (key.length < 8 || key.charCodeAt(6) !== 58 || !key.startsWith('system')) return -1;
  let id = 0;
  for (let i = 7; i < key.length; i++) { const d = key.charCodeAt(i) - 48; if (d < 0 || d > 9) return -1; id = id * 10 + d; }
  return id;
}
/** The drilled server's slot and how far its sled is out (0..1), from the core's choreography. */
export const drill = { slot: -1, out: 0 };
const link = createZoomLink();
export function drillOf(s: RackSnapshot, frame: WorldFrame): typeof drill {
  drill.slot = -1; drill.out = 0;
  const l = zoomLink(frame.zoom, keyOf(s), link);
  if (!l || !l.child) return drill;
  const id = systemKeyId(l.child), slot = id < 0 ? -1 : slotOfSystem(s, id);
  if (slot < 0) return drill;
  drill.slot = slot; drill.out = sledOut(l, frame.reducedMotion);
  return drill;
}

function ghostState(view: ViewPresentation): GhostState {
  if (view.picked === 'server') return 'picked';
  const q = view.quotes?.quotes;
  if (q) for (let i = 0; i < q.length; i++) if (q[i].action.type === 'addUnit' && q[i].affordable) return 'afford';
  return 'open';
}

/** The whole row: neighbours at their columns at 30% alpha, then the active rack on top. */
export function drawRow(g: G, s: RackSnapshot, view: ViewPresentation, frame: WorldFrame, ctx: RackContext): void {
  R(g, 0, 0, ROW_W, WORLD.h, BG.rack);
  const col = rackCol(s), row = rowViews(s);
  if (row) for (let c = 0; c < ROW_COLS; c++) {
    if (c === col) continue;
    const v = row[c];
    if (v && v.rackId !== null && v.rackId !== s.rackId) drawNeighbour(g, v, colX(c), frame.paused);
  }
  g.save(); g.translate(colX(col), 0);
  drawActive(g, s, view, frame, ctx);
  g.restore();
}

function drawActive(g: G, s: RackSnapshot, view: ViewPresentation, frame: WorldFrame, ctx: RackContext): void {
  shell(g);
  const off = rackDark(s), quiet = off || frame.paused, heat = Math.max(0, Math.min(1, (s.tempF - 70) / 30));
  drawCooler(g, s, ctx.fans, frame.timeMs, quiet, frame.reducedMotion);
  drawPowerCtl(g, s, off, frame.paused);
  drawSwitch(g, s, quiet);
  drawLB(g, s, quiet);
  const d = drillOf(s, frame);
  for (let i = 0; i < s.servers.length; i++) {
    const v = s.servers[i];
    if (v.systemId === null) continue;
    const y = slotY(serverRow(i));
    if (i === d.slot && d.out > 0) { R(g, OPEN.x, y, OPEN.w, U, P.ink); R(g, OPEN.x + 2, y + 1, OPEN.w - 4, U - 2, P.void); continue; }
    drawServer(g, OPEN.x, y, OPEN.w, U, v, serverLook(s, v, frame.paused), heat, frame.paused);
  }
  const up = s.switch.uplinks[0];
  drawUplink(g, up ? up.speedHz : 1e3, !quiet && !!up && up.active);
  // each sled's link runs at its own switch port's speed
  const ports = s.switch.ports;
  for (let i = 0; i < ports.length && i < 12; i++) {
    const p = ports[i];
    if (p.peer === null || s.servers[p.peer]?.systemId == null) continue;
    drawPatch(g, patchRoute(i, p.peer, route), p.speedHz, !quiet && p.active);
  }
  drawClips(g);
  drawPdu(g, s, quiet);

  // the next free slot: one quiet affordance; the price lives on the configuration plate
  const free = nextFreeServer(s);
  if (free >= 0 && d.slot < 0) {
    const r = serverRect(free, sledRect), cx = r.x + (r.w >> 1), cy = r.y + (r.h >> 1);
    drawGhost(g, r.x + 1, r.y + 1, r.w - 2, r.h - 2, ghostState(view));
    R(g, cx - 3, cy - 1, 7, 3, P.ink); R(g, cx - 1, cy - 3, 3, 7, P.ink); R(g, cx - 2, cy, 5, 1, P.paper); R(g, cx, cy - 2, 1, 5, P.paper);
  }
  // real transfers: the D25 shard flows; before the sim sends them, each link's own transfer
  // progress down the uplink, then along a patch cable to the server's NIC
  if (!quiet && !drawRackFlows(g, s, frame)) {
    if (up && up.active) { pathAt(UPLINK_ROUTE, up.progress, point); glowBit(g, point.x, point.y, 64, P.bit); }
    for (let i = 0; i < ports.length && i < 12; i++) {
      const p = ports[i];
      if (!p.active || p.peer === null || s.servers[p.peer]?.systemId == null) continue;
      pathAt(patchRoute(i, p.peer, route), p.progress, point); glowBit(g, point.x, point.y, 64, P.bit);
    }
  }
  // dark rack: the supply failed, so nothing below it has power
  if (off) {
    const a = g.globalAlpha; g.globalAlpha = a * 0.5;
    R(g, OPEN.x, U0, OPEN.w, NU * U, P.ink); R(g, CAB.x + 1, CAB.roofY + 1, CAB.w - 32, CAB.roofH - 2, P.ink); g.globalAlpha = a;
  }
  if (s.saveable) drawSaveIcon(g, SAVE_AT.x, SAVE_AT.y);
  drawUnitLamp(g, LAMP.x, LAMP.y, LAMP.w, lampState(s.online), (s.timerS ?? 0) * 1000, 10_000, frame.paused);
  if (d.slot >= 0 && d.out > 0) drawSled(g, s, d.slot, d.out, frame, ctx);
}

/** Rack ↔ System: the server's sled slides out on its rails; the board on it is the system's mini. */
function drawSled(g: G, s: RackSnapshot, slot: number, out: number, frame: WorldFrame, ctx: RackContext): void {
  const v = s.servers[slot], y = slotY(serverRow(slot)), lift = liftOf(y), d = SLED.d;
  const top = Math.round(y - lift * out), front = Math.round(top + d * out), alpha = g.globalAlpha;
  g.globalAlpha = alpha * 0.4; R(g, SLED.x + 3, top + 3, SLED.w, front - top + U, P.ink); g.globalAlpha = alpha;
  R(g, SLED.x - 1, top, 1, front - top + 2, P.steel); R(g, SLED.x + SLED.w, top, 1, front - top + 2, P.steelLo);
  const look = serverLook(s, v, frame.paused);
  if (front > top) {
    g.save(); g.beginPath(); g.rect(SLED.x, top, SLED.w, front - top); g.clip();
    const iy = front - d, on = look === 'live';
    sledInterior(g, iy, fanAt(ctx.fans, 6, (v.systemId as SystemId) * 16 + 7, frame.timeMs, on ? Math.max(0.2, v.load) : 0, frame.reducedMotion), on);
    if (ctx.registry.has('system')) {
      sledRect.x = CHILD.x; sledRect.y = iy + CHILD.dy; sledRect.w = CHILD.w; sledRect.h = CHILD.h;
      ctx.registry.level('system').drawMini(g, v, sledRect, frame);
    }
    g.restore();
  }
  drawServer(g, OPEN.x, front, OPEN.w, U, v, look, 0, frame.paused);
}
