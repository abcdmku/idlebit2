// Room power, north-east only (the room mockup's drawPowerPath and upsFoot).
// A copper utility feed drops from the north onto the UPS bank at the east end of the back
// wall; a busway runs from the bank down the east side of the rows with a tap into each
// built row. The world shows no power numbers: the HUD does. Each cabinet has one steady
// power light (amber while its feed is overloaded, red when it has failed).
// Every power drawing, rect and target of the room lives here; other modules call only these exports.
// Module top level is plain arithmetic: nothing here can throw at import.
import { P, R, copyRect, frame, mix, prism, px, resetHitTarget } from '../../core';
import type { HitTarget, NodeRef, PrismStyle, Rect } from '../../core';
import type { PartRef, RoomSnapshot, SupplyView } from '../../../game';
import { BOH, COLS, IY, RACK, WALL, hallOf, rackX, rowY } from './layout';

type G = CanvasRenderingContext2D;
const HALL = hallOf(1);
export const UPS_MAX = 6;
/** The busway runs one px east of the last rack column. */
export const BUS_X = rackX(COLS - 1) + RACK.w + 1;
const FEED_X = HALL.ix + HALL.iw - 7, WALL_TOP = IY - 4 - WALL.z;
const UPS_STYLE: PrismStyle = { top: P.steel, front: P.steelLo }, UPS_LI: PrismStyle = { top: P.steelHi, front: P.steel };
const COPPER_LO = P.copperLo, scratch: Rect = { x: 0, y: 0, w: 0, h: 0 };

/** Cabinet k of a bank of n, anchored at the east end of the back wall. */
function upsFoot(k: number, n: number, out: Rect): Rect {
  out.x = HALL.ix + HALL.iw - 4 - (n - k) * 11; out.y = IY + 2; out.w = 10; out.h = BOH.d; return out;
}
/** Cabinets in the bank: more with the UPS grade, split evenly between feeds. */
export function upsCount(ups: readonly SupplyView[]): number {
  const u = ups[0];
  if (!u) return 0;
  const per = Math.max(2, Math.min(ups.length > 1 ? 3 : UPS_MAX, 2 + 2 * u.generation + (u.level >= 3 ? 1 : 0)));
  return Math.min(UPS_MAX, per * ups.length);
}
function feedOf(s: RoomSnapshot, k: number, n: number): number {
  const feeds = Math.max(1, s.ups.length), per = Math.max(1, Math.floor(n / feeds));
  return Math.min(feeds - 1, Math.floor(k / per));
}
/** West x of the UPS bank. The corridor door sits just west of it. */
export function bankX(s: RoomSnapshot): number {
  const n = Math.max(1, upsCount(s.ups));
  return HALL.ix + HALL.iw - 4 - n * 11;
}

function drawUps(g: G, f: Rect, u: SupplyView | undefined): void {
  const z = BOH.z, li = !!u && u.generation >= 2, t = prism(g, f.x, f.y, f.w, f.h, z, li ? UPS_LI : UPS_STYLE, scratch);
  for (let x = t.x + 2; x < t.x + t.w - 2; x += 2) px(g, x, t.y + 3, P.steelLo);
  const fy = t.y + t.h, failed = !!u && u.failed;
  R(g, t.x + 2, fy + 3, 4, 3, P.ink);
  px(g, t.x + 3, fy + 4, failed ? P.fault : u && u.overloadS > 0 ? P.amber : li ? P.cool : P.led);
  R(g, t.x + 7, fy + 3, 1, z - 6, P.ink);
  if (failed) frame(g, t.x - 1, t.y - 1, t.w + 2, t.h + z + 2, P.fault);
}

/** Utility feed, busway with a tap into each built row, then the UPS bank over the busway's head. */
export function drawPower(g: G, s: RoomSnapshot): void {
  const rows = Math.max(1, s.rows), n = upsCount(s.ups), alpha = g.globalAlpha;
  const cu = s.ups.length && s.ups.every(u => u.failed) ? mix(P.copper, P.ink, 0.5) : P.copper;
  for (let y = 0; y < WALL_TOP; y++) {
    g.globalAlpha = alpha * Math.min(1, (y + 4) / 20);
    R(g, FEED_X - 1, y, 4, 1, P.ink); R(g, FEED_X, y, 2, 1, cu); px(g, FEED_X + 1, y, COPPER_LO);
  }
  g.globalAlpha = alpha;
  const bx = BUS_X, yb = IY + 4, ye = rowY(rows - 1) - 6;
  R(g, bx - 1, yb, 3, ye - yb, P.ink); R(g, bx, yb, 1, ye - yb, cu);
  if (n > 0) { const x0 = upsFoot(0, n, scratch).x; R(g, bx - 1, yb - 1, x0 - bx + 2, 3, P.ink); R(g, bx, yb, x0 - bx, 1, cu); }
  for (let r = 0; r < rows; r++) {
    let built = false;
    for (let c = 0; c < COLS; c++) if (s.racks[r * COLS + c]?.rackId != null) { built = true; break; }
    if (!built) continue;
    const y = rowY(r) - 10;
    R(g, bx - 3, y - 1, 4, 3, P.ink); R(g, bx - 2, y, 3, 1, cu);
  }
  for (let k = 0; k < n; k++) drawUps(g, upsFoot(k, n, scratch), s.ups[feedOf(s, k, n)]);
}

const UPS_IDS = ['ups0', 'ups1', 'ups2', 'ups3', 'ups4', 'ups5'];
/** One target per cabinet, each opening its feed's UPS plate. `parts[i]` is feed i's PartRef. Returns the new count. */
export function powerTargets(s: RoomSnapshot, out: HitTarget[], from: number, owner: NodeRef, parts: readonly PartRef[]): number {
  const n = upsCount(s.ups);
  let m = from;
  for (let k = 0; k < n && m < out.length; k++) {
    const t = resetHitTarget(out[m++], UPS_IDS[k], 'part', owner), f = upsFoot(k, n, scratch);
    t.rect.x = f.x; t.rect.y = f.y - BOH.z; t.rect.w = f.w; t.rect.h = f.h + BOH.z;
    t.part = parts[feedOf(s, k, n)] ?? parts[0];
  }
  return m;
}
/** Failed feeds' cabinets, for real smoke. Returns the new count. */
export function powerFaults(s: RoomSnapshot, out: Rect[], from: number): number {
  const n = upsCount(s.ups);
  let m = from;
  for (let k = 0; k < n && m < out.length; k++) {
    if (!s.ups[feedOf(s, k, n)]?.failed) continue;
    const f = upsFoot(k, n, scratch);
    copyRect(f, out[m]); out[m].y = f.y - BOH.z; out[m].h = f.h + BOH.z; m++;
  }
  return m;
}
/** The bank's footprint in the overhead mini (four cabinets). */
export function miniBankRect(out: Rect): Rect {
  out.x = HALL.ix + HALL.iw - 4 - 44; out.y = IY - 16; out.w = 43; out.h = 26; return out;
}
