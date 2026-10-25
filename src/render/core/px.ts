// Pixel primitives. Static art only: nothing here reads a clock. Motion comes
// from activity.ts (real rates) and fx.ts (real events).
import { P, mix } from './palette';
import type { Point, Rect } from './geom';

type G = CanvasRenderingContext2D;
export type PixelPath = readonly (readonly [number, number])[];
let still = false;
/** The renderer supplies the preference; no listeners or browser globals at import. */
export function setReducedMotion(value: boolean): void { still = value; }
export function isReducedMotion(): boolean { return still; }

export function R(g: G, x: number, y: number, w: number, h: number, c: string): void {
  if (w <= 0 || h <= 0) return;
  g.fillStyle = c; g.fillRect(x | 0, y | 0, w | 0, h | 0);
}
export function px(g: G, x: number, y: number, c: string): void { R(g, x, y, 1, 1, c); }
export function frame(g: G, x: number, y: number, w: number, h: number, c: string): void {
  R(g, x, y, w, 1, c); R(g, x, y + h - 1, w, 1, c); R(g, x, y, 1, h, c); R(g, x + w - 1, y, 1, h, c);
}
const EMPTY = Object.freeze({});
export interface BlockStyle { top?: string; hi?: string; lo?: string; face?: string; lip?: number; ol?: string | null }
export function block(g: G, x: number, y: number, w: number, h: number, o: BlockStyle = EMPTY): void {
  const top = o.top ?? P.logic, lip = o.lip ?? 2;
  if (o.ol !== null) R(g, x - 1, y - 1, w + 2, h + lip + 2, o.ol ?? P.ink);
  R(g, x, y, w, h, top); R(g, x, y, w, 1, o.hi ?? mix(top, '#ffffff', 0.18));
  R(g, x, y, 1, h, o.hi ?? mix(top, '#ffffff', 0.18));
  R(g, x + w - 1, y + 1, 1, h - 1, o.lo ?? mix(top, '#000000', 0.28));
  R(g, x + 1, y + h - 1, w - 1, 1, o.lo ?? mix(top, '#000000', 0.28));
  R(g, x, y + h, w, lip, o.face ?? mix(top, '#000000', 0.45));
}
export function inset(g: G, x: number, y: number, w: number, h: number, fill = P.substrate, sh = P.ink, li = P.maskHi): void {
  R(g, x, y, w, h, fill); R(g, x, y, w, 1, sh); R(g, x, y, 1, h, sh);
  R(g, x + 1, y + h - 1, w - 1, 1, li); R(g, x + w - 1, y + 1, 1, h - 1, li);
}
/** A dotted outline. `phase` is static art, never a clock. */
export function dotted(g: G, x: number, y: number, w: number, h: number, c: string, phase = 0, on = 2, off = 2): void {
  const per = on + off;
  for (let i = 0; i < Math.max(w, h); i++) if (((i + phase) % per + per) % per < on) {
    if (i < w) { px(g, x + i, y, c); px(g, x + w - 1 - i, y + h - 1, c); }
    if (i < h) { px(g, x + w - 1, y + i, c); px(g, x, y + h - 1 - i, c); }
  }
}
export function brackets(g: G, x: number, y: number, w: number, h: number, c: string, len = 3): void {
  for (let i = 0; i < 4; i++) {
    const xx = i & 1 ? x + w - len : x, yy = i & 2 ? y + h - 1 : y;
    R(g, xx, yy, len, 1, c); R(g, i & 1 ? x + w - 1 : x, i & 2 ? y + h - len : y, 1, len, c);
  }
}
export function dither(g: G, x: number, y: number, w: number, h: number, c: string, phase = 0): void {
  for (let j = 0; j < h; j++) for (let i = (j + phase) & 1; i < w; i += 2) px(g, x + i, y + j, c);
}
export function hline(g: G, x0: number, x1: number, y: number, c: string): void { R(g, Math.min(x0, x1), y, Math.abs(x1 - x0) + 1, 1, c); }
export function vline(g: G, x: number, y0: number, y1: number, c: string): void { R(g, x, Math.min(y0, y1), 1, Math.abs(y1 - y0) + 1, c); }
/** Orthogonal trace through pixel points. */
export function trace(g: G, pts: PixelPath, c: string, w = 1): void {
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    R(g, Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(b[0] - a[0]) + w, Math.abs(b[1] - a[1]) + w, c);
  }
}
export function pathLen(pts: PixelPath): number {
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += Math.abs(pts[i][0] - pts[i - 1][0]) + Math.abs(pts[i][1] - pts[i - 1][1]);
  return len;
}
/** Point at fraction u of the path length. Feed u from a real transfer's progress. */
export function pathAt(pts: PixelPath, u: number, out: Point): Point {
  let len = pathLen(pts) * Math.max(0, Math.min(1, u));
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], d = Math.abs(b[0] - a[0]) + Math.abs(b[1] - a[1]);
    if (len <= d || i === pts.length - 1) {
      const k = d ? Math.min(1, len / d) : 0;
      out.x = Math.round(a[0] + (b[0] - a[0]) * k); out.y = Math.round(a[1] + (b[1] - a[1]) * k); return out;
    }
    len -= d;
  }
  out.x = pts[0]?.[0] ?? 0; out.y = pts[0]?.[1] ?? 0; return out;
}
/** Seeded static variation (terrain, wear). Never index it by time. */
export function hash(n: number): number { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); }
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

// ---------- 3/4 oblique projection ----------
// A footprint (x, y, w, h) rises z px: top face at (x, y - z), front face below it.
export function shadow(g: G, x: number, y: number, w: number, h: number, dx = 2, dy = 2): void {
  const alpha = g.globalAlpha; g.globalAlpha = alpha * 0.34; R(g, x + dx, y + dy, w, h, P.ink);
  g.globalAlpha = alpha * 0.16; R(g, x + dx + 1, y + dy + h, w - 1, 1, P.ink); R(g, x + dx + w, y + dy + 1, 1, h - 1, P.ink);
  g.globalAlpha = alpha;
}
export interface PrismStyle { top?: string; front?: string; hi?: string; lo?: string; edge?: string; shadow?: boolean; sx?: number; sy?: number }
const topRect: Rect = { x: 0, y: 0, w: 0, h: 0 };
/** Returns the top-face rect. Supply `out` to retain it; the default is borrowed. */
export function prism(g: G, x: number, y: number, w: number, h: number, z: number, o: PrismStyle = EMPTY, out: Rect = topRect): Rect {
  const top = o.top ?? P.logic, front = o.front ?? mix(top, '#000000', 0.4), ty = y - z;
  if (o.shadow !== false) shadow(g, x, y, w, h, o.sx, o.sy);
  R(g, x - 1, ty - 1, w + 2, h + z + 2, P.ink); R(g, x, ty, w, h, top);
  R(g, x, ty, w, 1, o.hi ?? mix(top, '#ffffff', 0.16)); R(g, x, ty, 1, h, o.hi ?? mix(top, '#ffffff', 0.16));
  R(g, x + w - 1, ty + 1, 1, h - 1, o.lo ?? mix(top, '#000000', 0.22));
  if (z > 0) {
    R(g, x, ty + h, w, z, front); R(g, x, ty + h, w, 1, o.edge ?? mix(front, '#ffffff', 0.12));
    if (z > 2) R(g, x, ty + h + z - 1, w, 1, mix(front, '#000000', 0.3));
  }
  out.x = x; out.y = ty; out.w = w; out.h = h; return out;
}
/** Glow = temperature. `heat` is the real 0..1 thermal fraction (see activity.heatFraction). */
export function bloom(g: G, x: number, y: number, w: number, h: number, c: string, heat: number): void {
  const a = Math.max(0, Math.min(1, heat)) * 0.35;
  if (a <= 0) return;
  const alpha = g.globalAlpha; g.globalAlpha = alpha * a; frame(g, x - 2, y - 2, w + 4, h + 4, c);
  g.globalAlpha = alpha * a * 0.45; frame(g, x - 3, y - 3, w + 6, h + 6, c); g.globalAlpha = alpha;
}
export function packetSize(bits: number): number { return bits <= 1 ? 2 : bits <= 16 ? 3 : bits <= 4096 ? 4 : 5; }
export function packet(g: G, cx: number, cy: number, bits: number, c = P.bit, ol = P.ink): void {
  const s = packetSize(bits), x = Math.round(cx - s / 2), y = Math.round(cy - s / 2);
  R(g, x - 1, y - 1, s + 2, s + 2, ol); R(g, x, y, s, s, c);
  if (s >= 4) px(g, x, y, '#ffffff');
  if (s >= 5) R(g, x + 1, y + 1, s - 2, s - 2, mix(c, '#000000', 0.25));
}
/** A packet with halo. Draw it only while a real transfer is in flight (PortView.active),
 * at the position its real progress gives. `trail` holds older real positions.
 */
export function glowBit(g: G, cx: number, cy: number, bits: number, c = P.bit, trail?: PixelPath): void {
  const s = packetSize(bits), x = Math.round(cx - s / 2), y = Math.round(cy - s / 2), alpha = g.globalAlpha;
  if (trail) for (let i = 0; i < trail.length; i++) { g.globalAlpha = alpha * (0.18 + 0.12 * i); R(g, Math.round(trail[i][0] - s / 2), Math.round(trail[i][1] - s / 2), s, s, c); }
  g.globalAlpha = alpha * 0.28; R(g, x - 2, y - 1, s + 4, s + 2, c); R(g, x - 1, y - 2, s + 2, s + 4, c);
  g.globalAlpha = alpha; packet(g, cx, cy, bits, c); px(g, x, y, '#ffffff');
}
