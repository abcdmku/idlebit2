// Room pieces over the approved floor (the room mockup): the network rack
// (room switch + built-in load balancer), thermostat, zone sign with save icon and lamp,
// the door to the next zone, UPS bank, cooling plumbing and the site data plane.
import { drawWells } from '../rack/flowkit';
import { P, R, frame as outline, drawSaveIcon, drawUnitLamp, glowBit, lampState, mix, pathAt, prism, px, rateAnimation, createRateAnimation, silk } from '../../core';
import type { Point, PrismStyle } from '../../core';
import type { RoomSnapshot, SupplyView } from '../../../game';
import { drawUps, overloadMark } from './sprites';
import { BOH, COLS, G, SPINE, UPS_MAX, WALL, ZONE_LETTERS, exhaustY, rackX, rowY, upsX } from './layout';

type G = CanvasRenderingContext2D;
const top = { x: 0, y: 0, w: 0, h: 0 }, foot = { x: 0, y: 0, w: 0, h: 0 };
/** UPS cabinet k of a bank of n: its foot. */
export function upsFoot(k: number, n: number, out: { x: number; y: number; w: number; h: number } = foot): typeof foot {
  out.x = upsX(G, k, n); out.y = G.upsY; out.w = G.upsW; out.h = BOH.d; return out;
}
const NET_STYLE: PrismStyle = { top: mix(P.steelLo, P.net, 0.12), front: mix(P.substrate, P.ink, 0.3) };
const decision = createRateAnimation();
const point: Point = { x: 0, y: 0 };

export const ZONE_SIGNS = Array.from(ZONE_LETTERS, ch => `Zone ${ch}`);
const DOORS = Array.from(ZONE_LETTERS, ch => `Z-${ch}`);

/** The next built zone of the site after this one, cyclic; -1 when this is the only one. */
export function nextZone(s: RoomSnapshot): number {
  const n = s.zones.length;
  for (let k = 1; k < n; k++) { const z = (s.zone + k) % n; if (s.zones[z] !== null) return z; }
  return -1;
}
export function builtZones(s: RoomSnapshot): number {
  let n = 0;
  for (let i = 0; i < s.zones.length; i++) if (s.zones[i] !== null) n++;
  return n;
}

/** Network rack: LB strategy display, one decision light at the real routing rate, one jack light per port. */
export function drawNetRack(g: G, s: RoomSnapshot, live: boolean, powered: boolean, timeMs: number): void {
  const f = G.net, z = SPINE.z, sw = s.network.switch, lb = s.network.lb;
  const t = prism(g, f.x, f.y, f.w, f.h, z, NET_STYLE, top);
  R(g, t.x + 1, t.y + 1, t.w - 2, 1, powered ? P.net : mix(P.net, P.ink, 0.6));
  const fy = t.y + t.h;
  // the LCD spans the face so a four-letter strategy (FIFO, PACK) fits whole (QA-20); the decision light sits by the port lights
  R(g, t.x + 1, fy + 1, t.w - 1, 6, P.ink);
  rateAnimation(lb.routedPerSec, timeMs, 2, live, decision);
  px(g, t.x + t.w - 2, fy + 8, decision.active && (decision.saturated || decision.phase < 0.5) ? P.bit : P.ledOff);
  const n = Math.min(sw.ports.length, 28);
  for (let i = 0; i < n; i++) {
    const p = sw.ports[i], x = t.x + 1 + (i % 7) * 2, y = fy + 8 + Math.floor(i / 7) * 2;
    px(g, x, y, live && p.active ? P.net : p.peer !== null && powered ? mix(P.net, P.ink, 0.7) : P.ink);
  }
  // D25.7: the room LB's queue wells, in the band under the port lights
  drawWells(g, lb.queue, t.x, fy + LB_WELLS_DY, t.w, z - 2 - LB_WELLS_DY, powered && !s.crashed);
  R(g, t.x + 1, fy + z - 2, t.w - 2, 1, P.ink);
}
/** The wells sit 15 px down the network rack's front: under its 4 rows of port lights. */
export const LB_WELLS_DY = 15;

/** The thermostat on the back wall: its °F is the core's crisp label (labels.ts); red-framed while crashed, a red bar while crash time builds. */
export function drawThermo(g: G, s: RoomSnapshot, quiet: boolean, powered: boolean): void {
  const r = G.thermo;
  R(g, r.x, r.y, r.w, r.h, P.ink); R(g, r.x + 1, r.y + 1, r.w - 2, r.h - 2, powered ? mix(P.ledOff, P.ink, 0.45) : P.ink);
  if (quiet || !powered) return;
  if (s.crashed) outline(g, r.x, r.y, r.w, r.h, P.fault);
  if (!s.crashed && s.crashS > 0) R(g, r.x + 1, r.y + r.h - 1, Math.max(1, Math.ceil((r.w - 2) * Math.min(1, s.crashS / 10))), 1, P.fault);
}

/** Zone sign, save icon, the room's lamp and, with another zone built, the lit corridor sign over the door. */
export function drawZoneSign(g: G, s: RoomSnapshot, paused: boolean): void {
  // the zone's name is the core's crisp label (labels.ts) on this plate
  const r = G.sign;
  R(g, r.x, r.y, r.w, r.h, P.ink); R(g, r.x + 1, r.y + 1, r.w - 2, r.h - 2, mix(P.silkLo, P.ink, 0.4));
  if (s.saveable) drawSaveIcon(g, G.save.x, G.save.y);
  drawUnitLamp(g, G.lamp.x, G.lamp.y, G.lamp.w, lampState(s.online), 0, 0, paused);
  const next = nextZone(s);
  if (next < 0) return;
  const d = G.doorHit, ax = d.x + d.w - 2;
  R(g, d.x, d.y, d.w, 7, P.ink); R(g, d.x + 1, d.y + 1, d.w - 2, 5, mix(P.net, P.ink, 0.6));
  silk(g, d.x + 2, d.y + 1, DOORS[next]!, P.led); px(g, ax, d.y + 3, P.led); px(g, ax - 1, d.y + 2, P.led); px(g, ax - 1, d.y + 4, P.led);
}

/** UPS cabinets per feed (more with grade); each gauge is its feed's real usage. */
export function upsCabinets(ups: readonly SupplyView[]): number {
  const u = ups[0];
  if (!u) return 0;
  const per = Math.max(2, Math.min(ups.length > 1 ? 3 : UPS_MAX, 2 + 2 * u.generation + (u.level >= 3 ? 1 : 0)));
  return Math.min(UPS_MAX, per * ups.length);
}
/** Power in the NE: the utility feed drops from the top onto the UPS bank; a busway runs from the bank
 * down the east side of the rows, with a tap into each row that holds racks. Copper, no motion. */
export function drawPowerPath(g: G, s: RoomSnapshot, powered: boolean): void {
  const n = Math.max(1, upsCabinets(s.ups)), IY = G.iy, FEED_X = G.feedX, BUS_X = G.busX, top = IY - 4 - WALL.z, cu = powered ? P.copper : P.copperLo, lo = P.copperLo, alpha = g.globalAlpha;
  for (let y = 0; y < top; y++) { g.globalAlpha = alpha * Math.min(1, (y + 4) / 20); R(g, FEED_X - 1, y, 4, 1, P.ink); R(g, FEED_X, y, 2, 1, cu); px(g, FEED_X + 1, y, lo); }
  g.globalAlpha = alpha;
  const rows = Math.max(1, s.rows), yb = IY + 4, ye = rowY(rows - 1) - 6, bank = upsX(G, 0, n);
  R(g, BUS_X - 1, yb, 3, ye - yb, P.ink); R(g, BUS_X, yb, 1, ye - yb, cu);
  R(g, BUS_X - 1, yb - 1, bank - BUS_X + 2, 3, P.ink); R(g, BUS_X, yb, bank - BUS_X, 1, cu);
  for (let r = 0; r < rows; r++) {
    let any = false;
    for (let c = 0; c < COLS; c++) if (s.racks[r * COLS + c]?.rackId != null) { any = true; break; }
    if (!any) continue;
    const y = rowY(r) - 10; R(g, BUS_X - 3, y - 1, 4, 3, P.ink); R(g, BUS_X - 2, y, 3, 1, cu);
  }
}
export function drawUpsBank(g: G, s: RoomSnapshot): void {
  const n = upsCabinets(s.ups), feeds = Math.max(1, s.ups.length), per = Math.max(1, Math.floor(n / feeds));
  for (let k = 0; k < n; k++) {
    const u = s.ups[Math.min(feeds - 1, Math.floor(k / per))];
    drawUps(g, upsFoot(k, n), u.usage, u.failed, u.generation >= 2);
  }
  for (let i = 0; i < feeds; i++) {
    const u = s.ups[i], f = upsFoot(i * per, n);
    if (u && f && !u.failed && u.overloadS > 0) overloadMark(g, f.x, f.y - BOH.z - 9, u.overloadS);
  }
}

/** Room cooling plumbing by technology: water drops to each CRAH, closed loop runs along every built row. */
export function drawPlumbing(g: G, s: RoomSnapshot, crahs: number): void {
  const tech = s.cooler.tech;
  if (tech === 'air') return;
  const G0 = G, y0 = G.iy + 12, x0 = G0.ix + 22, x1 = tech === 'closedLoop' ? G.busX - 3 : G0.ix + G0.iw - 4;
  R(g, x0, y0 - 1, x1 - x0, 3, P.ink); R(g, x0, y0, x1 - x0, 1, P.cool);
  R(g, x0, y0 + 2, x1 - x0, 3, P.ink); R(g, x0, y0 + 3, x1 - x0, 1, mix(P.cool, P.heatHi, 0.45));
  if (tech === 'water') {
    for (let i = 0; i < crahs; i++) {
      const f = G.cracs[i]!, x = f.x + (f.w >> 1), h = f.y - 24 - y0;
      if (h > 0) { R(g, x - 1, y0, 3, h, P.ink); R(g, x, y0, 1, h, P.coolLo); }
    }
    return;
  }
  for (let r = 0; r < s.rows; r++) {
    let any = false;
    for (let c = 0; c < 8; c++) if (s.racks[r * 8 + c]?.rackId != null) { any = true; break; }
    if (!any) continue;
    const y = exhaustY(r) - 2, xa = rackX(0), xb = rackX(7) + 16;
    R(g, xa, y - 1, xb - xa, 3, P.ink); R(g, xa, y, xb - xa, 1, P.cool);
    if (y > y0) { R(g, G0.trunk - 1, y0, 3, y - y0, P.ink); R(g, G0.trunk, y0, 1, y - y0, P.coolLo); }
  }
}
/** CRACs of the live hall. */
export const cracCount = (): number => G.cracs.length;

/** The site data plane leaving the gateway east. A pip rides it only while a room uplink carries a real transfer. */
export function drawDataPlane(g: G, s: RoomSnapshot, live: boolean): void {
  if (builtZones(s) < 2) return;
  const { x0, x1, y } = G.dataPlane;
  R(g, x0, y - 1, x1 - x0, 3, P.ink); R(g, x0, y, x1 - x0, 1, mix(P.net, P.ink, 0.45));
  if (!live) return;
  const up = s.network.switch.uplinks;
  for (let i = 0; i < up.length; i++) if (up[i].active) glowBit(g, Math.round(x0 + (x1 - x0) * up[i].progress), y, 64, P.net);
}
/** A task riding the fibre to rack slot `slot` at its port's real transfer progress. */
export function drawJob(g: G, path: Parameters<typeof pathAt>[0], progress: number): void {
  pathAt(path, progress, point); glowBit(g, point.x, point.y, 64, P.bit);
}
