// Room pieces over the approved floor (the room mockup): the network rack
// (room switch + built-in load balancer), thermostat, zone sign with save icon and lamp,
// the door to the next zone, UPS bank, cooling plumbing and the site data plane.
import { drawWells } from '../rack/flowkit';
import { P, R, drawSaveIcon, drawUnitLamp, glowBit, lampState, mix, pathAt, prism, px, rateAnimation, createRateAnimation, silk, silkWidth } from '../../core';
import type { Point, PrismStyle } from '../../core';
import type { RoomSnapshot, SupplyView } from '../../../game';
import { LB_SHORT, label, lcdText, lcdWidth, tempCol } from '../rack/art';
import { drawUps, overloadMark } from './sprites';
import {
  BOH, BUS_X, COLS, CRAC_FEET, DATA_PLANE, DOOR, FEED_X, IY, LAMP, NET_FOOT, SAVE_AT, SIGN, SPINE, THERMO, UPS_FEET, UPS_MAX, WALL, ZONE_LETTERS,
  exhaustY, hallOf, pairs, rackX, rowY, upsIndex,
} from './layout';

type G = CanvasRenderingContext2D;
const top = { x: 0, y: 0, w: 0, h: 0 };
const NET_STYLE: PrismStyle = { top: mix(P.steelLo, P.net, 0.12), front: mix(P.substrate, P.ink, 0.3) };
const decision = createRateAnimation();
const point: Point = { x: 0, y: 0 };

export { LB_SHORT };
const SIGNS = Array.from(ZONE_LETTERS, ch => `AZ ${ch}`), DOORS = Array.from(ZONE_LETTERS, ch => `AZ${ch}`);

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
  const f = NET_FOOT, z = SPINE.z, sw = s.network.switch, lb = s.network.lb;
  const t = prism(g, f.x, f.y, f.w, f.h, z, NET_STYLE, top);
  R(g, t.x + 1, t.y + 1, t.w - 2, 1, powered ? P.net : mix(P.net, P.ink, 0.6));
  const fy = t.y + t.h;
  R(g, t.x + 1, fy + 1, 14, 6, P.ink);
  if (powered) lcdText(g, t.x + 2, fy + 1, LB_SHORT[lb.strategy] ?? 'LB', P.cacheOn, t.x + 1, t.x + 15);
  rateAnimation(lb.routedPerSec, timeMs, 2, live, decision);
  px(g, t.x + t.w - 2, fy + 2, decision.active && (decision.saturated || decision.phase < 0.5) ? P.bit : P.ledOff);
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

/** The zone's real temperature on the back wall; HALT while crashed, a red bar while crash time builds. */
export function drawThermo(g: G, s: RoomSnapshot, quiet: boolean, powered: boolean): void {
  const r = THERMO;
  R(g, r.x, r.y, r.w, r.h, P.ink); R(g, r.x + 1, r.y + 1, r.w - 2, r.h - 2, powered ? mix(P.ledOff, P.ink, 0.45) : P.ink);
  if (quiet || !powered) return;
  const txt = s.crashed ? 'HALT' : label('', Math.round(s.tempF), '°F'), c = s.crashed ? P.fault : tempCol(s.tempF);
  lcdText(g, r.x + Math.max(1, (r.w - lcdWidth(txt)) >> 1), r.y + 2, txt, c);
  if (!s.crashed && s.crashS > 0) R(g, r.x + 1, r.y + r.h - 1, Math.max(1, Math.ceil((r.w - 2) * Math.min(1, s.crashS / 10))), 1, P.fault);
}

/** Zone sign, save icon, the room's lamp and, with another zone built, the lit corridor sign over the door. */
export function drawZoneSign(g: G, s: RoomSnapshot, paused: boolean): void {
  const r = SIGN, name = SIGNS[s.zone] ?? SIGNS[0];
  R(g, r.x, r.y, r.w, r.h, P.ink); R(g, r.x + 1, r.y + 1, r.w - 2, r.h - 2, mix(P.silkLo, P.ink, 0.4));
  silk(g, r.x + ((r.w - silkWidth(name)) >> 1), r.y + 2, name, P.paper);
  if (s.saveable) drawSaveIcon(g, SAVE_AT.x, SAVE_AT.y);
  drawUnitLamp(g, LAMP.x, LAMP.y, LAMP.w, lampState(s.online), 0, 0, paused);
  const next = nextZone(s);
  if (next < 0) return;
  const d = DOOR;
  R(g, d.x - 5, d.y - 1, 19, 7, P.ink); R(g, d.x - 4, d.y, 17, 5, mix(P.net, P.ink, 0.6));
  silk(g, d.x - 3, d.y, DOORS[next], P.led); px(g, d.x + 12, d.y + 2, P.led); px(g, d.x + 11, d.y + 1, P.led); px(g, d.x + 11, d.y + 3, P.led);
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
  const n = Math.max(1, upsCabinets(s.ups)), top = IY - 4 - WALL.z, cu = powered ? P.copper : P.copperLo, lo = P.copperLo, alpha = g.globalAlpha;
  for (let y = 0; y < top; y++) { g.globalAlpha = alpha * Math.min(1, (y + 4) / 20); R(g, FEED_X - 1, y, 4, 1, P.ink); R(g, FEED_X, y, 2, 1, cu); px(g, FEED_X + 1, y, lo); }
  g.globalAlpha = alpha;
  const rows = Math.max(1, s.rows), yb = IY + 4, ye = rowY(rows - 1) - 6, bank = UPS_FEET[upsIndex(0, n)].x;
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
    drawUps(g, UPS_FEET[upsIndex(k, n)], u.usage, u.failed, u.generation >= 2);
  }
  for (let i = 0; i < feeds; i++) {
    const u = s.ups[i], f = UPS_FEET[upsIndex(i * per, n)];
    if (u && f && !u.failed && u.overloadS > 0) overloadMark(g, f.x, f.y - BOH.z - 9, u.overloadS);
  }
}

/** Room cooling plumbing by technology: water drops to each CRAH, closed loop runs along every built row. */
export function drawPlumbing(g: G, s: RoomSnapshot, crahs: number): void {
  const tech = s.cooler.tech;
  if (tech === 'air') return;
  const G0 = hallOf(s.rows), y0 = IY + 12, x0 = G0.ix + 22, x1 = tech === 'closedLoop' ? BUS_X - 3 : G0.ix + G0.iw - 4;
  R(g, x0, y0 - 1, x1 - x0, 3, P.ink); R(g, x0, y0, x1 - x0, 1, P.cool);
  R(g, x0, y0 + 2, x1 - x0, 3, P.ink); R(g, x0, y0 + 3, x1 - x0, 1, mix(P.cool, P.heatHi, 0.45));
  if (tech === 'water') {
    for (let i = 0; i < crahs; i++) {
      const f = CRAC_FEET[i], x = f.x + (f.w >> 1), h = f.y - 24 - y0;
      R(g, x - 1, y0, 3, h, P.ink); R(g, x, y0, 1, h, P.coolLo);
    }
    return;
  }
  for (let r = 0; r < s.rows; r++) {
    let any = false;
    for (let c = 0; c < 8; c++) if (s.racks[r * 8 + c]?.rackId != null) { any = true; break; }
    if (!any) continue;
    const y = exhaustY(r) - 2, xa = rackX(0), xb = rackX(7) + 16;
    R(g, xa, y - 1, xb - xa, 3, P.ink); R(g, xa, y, xb - xa, 1, P.cool);
    R(g, G0.trunk - 1, y0, 3, y - y0, P.ink); R(g, G0.trunk, y0, 1, y - y0, P.coolLo);
  }
}
export const cracCount = (rows: number): number => Math.min(CRAC_FEET.length, pairs(rows) * 2);

/** The site data plane leaving the gateway east. A pip rides it only while a room uplink carries a real transfer. */
export function drawDataPlane(g: G, s: RoomSnapshot, live: boolean): void {
  if (builtZones(s) < 2) return;
  const { x0, x1, y } = DATA_PLANE;
  R(g, x0, y - 1, x1 - x0, 3, P.ink); R(g, x0, y, x1 - x0, 1, mix(P.net, P.ink, 0.45));
  if (!live) return;
  const up = s.network.switch.uplinks;
  for (let i = 0; i < up.length; i++) if (up[i].active) glowBit(g, Math.round(x0 + (x1 - x0) * up[i].progress), y, 64, P.net);
}
/** A task riding the fibre to rack slot `slot` at its port's real transfer progress. */
export function drawJob(g: G, path: Parameters<typeof pathAt>[0], progress: number): void {
  pathAt(path, progress, point); glowBit(g, point.x, point.y, 64, P.bit);
}
