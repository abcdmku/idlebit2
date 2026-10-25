// Room sprites in 3/4 view (mockup levels/datacenter/sprites.js). Each takes a ground
// footprint and rises z px. Lights and motion are arguments from real state: fan angle
// from the cooler's duty, gauges from supply usage, tray fibre lit only while traffic runs.
// The mockup's free-running shimmer, blinking breakers and pump flicker are gone (v2 §7).
import { P, R, frame, mix, prism, px, silk } from '../../core';
import { disc } from '../rack/art';
import { BOH, CRAC, RACK } from './layout';
import type { PrismStyle, Rect } from '../../core';

type G = CanvasRenderingContext2D;
export const FIBRE = mix(P.net, P.ink, 0.35), FIBRE_LO = mix(P.net, P.ink, 0.62);
const PERF = mix(P.wafer, P.coolLo, 0.5), PERF_HOLE = mix(P.coolLo, P.ink, 0.35);
const top = { x: 0, y: 0, w: 0, h: 0 };
// Prism styles, built once: drawing allocates nothing per frame.
const CRAC_STYLE: readonly PrismStyle[] = [1, 2, 3, 4].map(lvl => ({
  top: lvl >= 4 ? mix(P.steelHi, P.cool, 0.18) : lvl === 3 ? mix(P.steel, P.cool, 0.12) : P.steel,
  front: lvl >= 3 ? mix(P.steelLo, P.coolLo, 0.25) : P.steelLo,
}));
const UPS_STYLE: PrismStyle = { top: P.steel, front: P.steelLo }, UPS_LI: PrismStyle = { top: P.steelHi, front: P.steel };
const GATE_STYLE: PrismStyle = { top: P.steel, front: P.steelLo, shadow: false };

/** Room fan seen from above: ring, dark well, blades at `angle` (real duty); 2 blades when small. */
export function roomFan(g: G, cx: number, cy: number, r: number, angle: number, on: boolean, blade: string = P.cool): void {
  disc(g, cx, cy, r + 1, P.ink); disc(g, cx, cy, r, P.steelLo); disc(g, cx, cy, r - 1, P.void);
  const n = r > 3 ? 4 : 2, col = on ? blade : mix(blade, P.ink, 0.45);
  for (let k = 0; k < n; k++) {
    const a = angle + k * Math.PI * 2 / n, ca = Math.cos(a), sa = Math.sin(a);
    for (let d = 1; d < r; d++) px(g, Math.round(cx + ca * d), Math.round(cy + sa * d), col);
  }
  px(g, cx, cy, P.steelHi);
}

/** Visual CRAC grade: 1 fan unit, 2 twin fan, 3 chilled-water CRAH, 4 liquid (closed loop). */
export interface CracArt { grade: 1 | 2 | 3 | 4; angle: number; duty: number; powered: boolean }
export function drawCrac(g: G, f: Rect, s: CracArt): void {
  const z = CRAC.z, lvl = s.grade, on = s.powered && s.duty > 0;
  const t = prism(g, f.x, f.y, f.w, f.h, z, CRAC_STYLE[lvl - 1], top);
  const cx = t.x + (t.w >> 1), cy = t.y + (t.h >> 1), fy = t.y + t.h;
  if (lvl === 1) roomFan(g, cx, cy, 5, s.angle, on);
  else if (lvl <= 3) { roomFan(g, t.x + 4, cy, 3, s.angle, on); roomFan(g, t.x + t.w - 5, cy, 3, s.angle, on); }
  else {
    // liquid unit: two pumps on a coolant manifold; the manifold is lit while the pumps run
    R(g, t.x + 1, t.y + 1, t.w - 2, t.h - 2, mix(P.coolLo, P.ink, 0.3));
    for (let i = 0; i < 2; i++) { const x = i ? t.x + t.w - 5 : t.x + 4; disc(g, x, cy, 3, P.ink); disc(g, x, cy, 2, P.steel); px(g, x, cy, on ? P.coolHi : P.coolLo); }
    R(g, t.x + 7, cy, t.w - 14, 1, on ? P.coolHi : P.coolLo);
  }
  if (lvl <= 2) for (let y = fy + 3; y < fy + z - 3; y += 3) R(g, t.x + 2, y, t.w - 4, 1, P.ink);
  else if (lvl === 3) for (let x = t.x + 2; x < t.x + t.w - 2; x += 2) R(g, x, fy + 3, 1, z - 7, (x >> 1) % 2 ? P.cool : P.coolLo);
  else {
    // sight tubes: coolant level follows the real duty
    for (let i = 0; i < 2; i++) {
      const tx = t.x + 2 + i * 4, lv = Math.round((z - 9) * (0.6 + 0.2 * s.duty));
      R(g, tx, fy + 3, 3, z - 7, P.ink); R(g, tx + 1, fy + z - 5 - lv, 1, lv, on ? P.cool : P.coolLo); px(g, tx + 1, fy + z - 5 - lv, P.coolHi);
    }
    for (let y = fy + 4; y < fy + z - 4; y += 3) R(g, t.x + 11, y, t.w - 13, 1, P.ink);
  }
  if (lvl >= 3) { R(g, t.x - 1, fy + z - 2, 2, 2, P.coolLo); R(g, t.x + t.w - 1, fy + z - 2, 2, 2, P.coolLo); }
  R(g, t.x + t.w - 4, fy + 1, 3, 1, P.ink);
  px(g, t.x + t.w - 3, fy + 1, s.powered ? P.led : P.ledOff);
  if (!s.powered) { const a = g.globalAlpha; g.globalAlpha = a * 0.55; R(g, t.x, t.y, t.w, t.h + z, P.ink); g.globalAlpha = a; }
}

/** UPS battery cabinet. The gauge is the feed's real usage: green, amber above 90%, red over capacity. */
export function drawUps(g: G, f: Rect, usage: number, failed: boolean, li: boolean): void {
  const z = BOH.z, t = prism(g, f.x, f.y, f.w, f.h, z, li ? UPS_LI : UPS_STYLE, top);
  for (let x = t.x + 2; x < t.x + t.w - 2; x += 2) px(g, x, t.y + 3, P.steelLo);
  const fy = t.y + t.h, segs = 5, lit = failed ? 0 : Math.min(segs, Math.round(segs * Math.max(0, usage)));
  R(g, t.x + 2, fy + 3, 4, segs * 2 + 1, P.ink);
  const c = usage > 1 ? P.fault : usage > 0.9 ? P.amber : li ? P.cool : P.led;
  for (let i = 0; i < segs; i++) R(g, t.x + 3, fy + 4 + (segs - 1 - i) * 2, 2, 1, i < lit ? c : P.ledOff);
  R(g, t.x + 7, fy + 3, 1, z - 6, P.ink);
  if (failed) frame(g, t.x - 1, t.y - 1, t.w + 2, t.h + z + 2, P.fault);
}
/** Overload readout over a supply: seconds accumulated toward the 10 s failure. */
export function overloadMark(g: G, x: number, y: number, overloadS: number): void {
  R(g, x - 1, y - 1, 12, 7, P.ink); R(g, x, y, Math.max(1, Math.ceil(10 * Math.min(1, overloadS / 10))), 5, P.amber);
  silk(g, x + 11, y, '!', P.amber);
}

/** Ladder tray on the rack tops: two rails with fibre, lit while traffic runs. */
export function drawTrayRun(g: G, x0: number, x1: number, y: number, lit: boolean): void {
  R(g, x0, y - 1, x1 - x0, 1, P.steelLo); R(g, x0, y + 1, x1 - x0, 1, P.steelLo);
  R(g, x0, y, x1 - x0, 1, lit ? FIBRE : FIBRE_LO);
  for (let x = x0 + 2; x < x1; x += 6) px(g, x, y + 1, P.steel);
}
/** Trunk tray from the network rack down the west gap, with posts in each cold aisle. */
export function drawTrunk(g: G, x: number, y0: number, y1: number, rows: number, rowGround: (r: number) => number, lit: boolean): void {
  for (let r = 0; r < rows; r++) { const gy = rowGround(r) + 7; R(g, x + 1, gy - 34, 1, 34, mix(P.steelLo, P.ink, 0.3)); px(g, x + 1, gy, P.steel); }
  R(g, x - 1, y0 - 1, 5, y1 - y0 + 2, P.ink);
  R(g, x, y0, 1, y1 - y0, P.steel); R(g, x + 2, y0, 1, y1 - y0, P.steelLo);
  R(g, x + 1, y0, 1, y1 - y0, lit ? FIBRE : FIBRE_LO);
  for (let y = y0 + 3; y < y1; y += 6) px(g, x + 1, y, P.steelLo);
}
/** Fibre entry on the back wall. Its jack lights are lit while the room switch's uplinks carry transfers. */
export function drawGateway(g: G, r: Rect, fibres: number, live: boolean, powered: boolean): void {
  const n = Math.max(1, Math.min(4, fibres)), cx = r.x + (r.w >> 1), a = g.globalAlpha;
  for (let i = 0; i < n; i++) {
    const x = cx - n + 1 + i * 2 - (n > 2 ? 1 : 0);
    for (let y = 0; y < r.y + 2; y += 4) {
      g.globalAlpha = a * Math.min(1, (y + 4) / 24);
      R(g, x - 1, y, 3, Math.min(4, r.y + 2 - y), P.ink); R(g, x, y, 1, Math.min(4, r.y + 2 - y), i % 2 ? P.net : FIBRE);
    }
    g.globalAlpha = a;
  }
  const t = prism(g, r.x, r.y + 4, r.w, 3, 8, GATE_STYLE, top);
  const fy = t.y + t.h;
  for (let i = 0; i < n; i++) px(g, t.x + 2 + i * 2, fy + 2, live ? P.net : P.ledOff);
  px(g, t.x + t.w - 3, fy + 2, powered ? P.led : P.ledOff);
  R(g, cx - 4, r.y - 26, 9, 5, P.ink); R(g, cx - 3, r.y - 25, 7, 3, P.steelLo); R(g, cx - 3, r.y - 25, 7, 1, P.steel);
}
/** Hot-aisle containment along the back of a row: glows with the row's real load and the room's heat. */
export function drawExhaust(g: G, x0: number, x1: number, y: number, glow: number, hot: boolean): void {
  R(g, x0 - 1, y - 1, x1 - x0 + 2, 5, P.ink);
  const base = mix(mix(P.copperLo, P.ink, 0.45), hot ? P.heat : P.heatHi, Math.round(Math.min(1, glow) * 20) / 20);
  R(g, x0, y, x1 - x0, 3, base); R(g, x0, y + 3, x1 - x0, 1, mix(base, P.ink, 0.45));
  const lo = mix(base, P.ink, 0.25);
  for (let x = x0 + 1; x < x1 - 1; x += 2) px(g, x, y + 1, lo);
}
/** Perforated cold-aisle tile in front of one rack. */
export function drawPerf(g: G, x: number, y: number): void {
  R(g, x, y, RACK.pitch, 11, PERF); R(g, x, y + 10, RACK.pitch, 1, mix(PERF, P.ink, 0.25)); R(g, x, y, 1, 11, mix(PERF, P.ink, 0.25));
  for (let j = 2; j < 10; j += 2) for (let i = 2 + ((j >> 1) & 1); i < RACK.pitch - 1; i += 2) px(g, x + i, y + j, PERF_HOLE);
}
