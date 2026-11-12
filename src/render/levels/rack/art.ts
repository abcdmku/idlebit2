// Shared in-world art for the rack, room and global levels (mockup levels/rack/sprites.js):
// discs, fans whose angle is real duty, bezel ears and blanking plates.
// Static art only; motion comes in as arguments (fan angle, lit flags) from real state.
import { P, R, fanAngle, fanAnimation, createFanAnimation, mix, px } from '../../core';
import type { FanAnimation } from '../../core';

type G = CanvasRenderingContext2D;

export function disc(g: G, cx: number, cy: number, r: number, c: string): void {
  g.fillStyle = c;
  for (let dy = -r; dy <= r; dy++) { const hw = Math.floor(Math.sqrt(r * r - dy * dy + r * 0.5)); g.fillRect(cx - hw, cy + dy, hw * 2 + 1, 1); }
}

/** A fan seen from above. `angle` comes from FanBank (real duty × FAN_TOP_RPS); `on` false draws dim, still blades. */
export function fan(g: G, cx: number, cy: number, r: number, angle: number, on: boolean, blade: string = P.cool): void {
  disc(g, cx, cy, r + 1, P.ink); disc(g, cx, cy, r, P.steelLo); disc(g, cx, cy, r - 1, P.void);
  const col = on ? blade : mix(blade, P.ink, 0.45), shade = mix(col, P.ink, 0.45);
  for (let k = 0; k < 4; k++) {
    const a = angle + k * Math.PI / 2;
    const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(a + 0.4), sb = Math.sin(a + 0.4);
    for (let d = 2; d < r - 1 || d === 2; d++) {
      px(g, Math.round(cx + ca * d), Math.round(cy + sa * d), col);
      px(g, Math.round(cx + cb * d), Math.round(cy + sb * d), shade);
    }
  }
  R(g, cx - 1, cy - 1, 3, 3, P.steelHi); px(g, cx + 1, cy + 1, P.steel);
}

/** One FanAnimation per fan slot, preallocated. Angle integrates real duty over sim time (no jumps on duty changes). */
export interface FanBank { readonly fans: readonly FanAnimation[] }
export function createFanBank(count: number): FanBank {
  return { fans: Array.from({ length: count }, createFanAnimation) };
}
/** Blade angle for fan `i` of unit `key` at duty 0..1. Reduced motion or duty 0 holds still. */
export function fanAt(bank: FanBank, i: number, key: number, timeMs: number, duty: number, still: boolean): number {
  const f = bank.fans[i];
  if (!f) return 0;
  fanAnimation(key, timeMs, still ? 0 : duty, f);
  return fanAngle(f);
}

/** Dark grey for every unlit LED in these levels. */
export const OFF = mix(P.substrate, P.ink, 0.3);
/** Chassis bezel by grade: plainer is duller, upgraded is brighter metal. */
export const BEZEL: readonly string[] = [P.wafer, P.waferHi, P.steelLo, P.steel];
export interface RectLike { readonly x: number; readonly y: number; readonly w: number; readonly h: number }

export function ears(g: G, r: RectLike, bez: string, tier: number): void {
  const ear = mix(bez, P.ink, 0.18), h = r.h;
  R(g, r.x + 1, r.y + 1, 5, h - 2, ear); R(g, r.x + r.w - 6, r.y + 1, 5, h - 2, ear);
  px(g, r.x + 3, r.y + h - 4, P.steelHi); px(g, r.x + r.w - 4, r.y + h - 4, P.steelHi);
  if (tier >= 2) { const c = tier === 3 ? P.steelHi : P.steel; R(g, r.x + 1, r.y + 2, 1, h - 4, c); R(g, r.x + r.w - 2, r.y + 2, 1, h - 4, c); }
}
export function drawBlank(g: G, r: RectLike): void {
  R(g, r.x, r.y, r.w, r.h, P.ink);
  R(g, r.x + 1, r.y + 1, r.w - 2, r.h - 2, mix(P.substrate, P.wafer, 0.3));
  R(g, r.x + 1, r.y + 1, r.w - 2, 1, mix(P.substrate, P.wafer, 0.6));
  for (let x = r.x + 9; x < r.x + r.w - 10; x += 6) R(g, x, r.y + (r.h >> 1), 4, 1, P.substrate);
  px(g, r.x + 2, r.y + (r.h >> 1), P.waferHi); px(g, r.x + r.w - 3, r.y + (r.h >> 1), P.waferHi);
}

/** Link colour by speed unit: kHz copper, MHz green, GHz blue. */
export const cableOf = (hz: number): string => (hz >= 1e9 ? P.coolLo : hz >= 1e6 ? mix(P.net, P.ink, 0.45) : mix(P.copper, P.ink, 0.35));
/** Port jack colour by speed unit. */
export const unitCol = (hz: number): string => (hz >= 1e9 ? P.cool : hz >= 1e6 ? P.net : P.pad);
// ---------- static layers ----------
// A cached static layer, or null where Canvas2D is unavailable (tests); callers then draw directly.
const layers = new Map<string, HTMLCanvasElement | null>();
export function layer(key: string, w: number, h: number, draw: (g: G) => void): HTMLCanvasElement | null {
  if (layers.has(key)) return layers.get(key)!;
  let canvas: HTMLCanvasElement | null = null;
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    let g: G | null = null;
    try { g = c.getContext('2d'); } catch { g = null; }
    if (g) { g.imageSmoothingEnabled = false; draw(g); canvas = c; }
  }
  layers.set(key, canvas);
  return canvas;
}
/** Blit a static layer, or draw it directly when layers are unavailable. */
export function drawLayer(g: G, key: string, w: number, h: number, draw: (g: G) => void, x = 0, y = 0): void {
  const c = layer(key, w, h, draw);
  if (c) g.drawImage(c, x, y);
  else { g.save(); g.translate(x, y); draw(g); g.restore(); }
}

// ---------- labels ----------
const numCache = new Map<string, Map<string, Map<number, string>>>();
/** Cached strings for label numbers such as '72°F' or '100%'. `n` should be an integer. No per-frame strings once warm. */
export function label(prefix: string, n: number, suffix = ''): string {
  let bySuffix = numCache.get(prefix);
  if (!bySuffix) { bySuffix = new Map(); numCache.set(prefix, bySuffix); }
  let byN = bySuffix.get(suffix);
  if (!byN) { byN = new Map(); bySuffix.set(suffix, byN); }
  let text = byN.get(n);
  if (text === undefined) { text = `${prefix}${n}${suffix}`; if (byN.size < 2048) byN.set(n, text); }
  return text;
}
/** A temperature where four digits don't fit (a room's rack tile, its thermostat): "72°F", then "2.5k°F" from 1,000. */
export function degrees(f: number, unit: '' | '°' | '°F'): string {
  const n = Math.round(f);
  return n < 1000 ? label('', n, unit) : label('', n < 9950 ? Math.round(n / 100) / 10 : Math.round(n / 1000), unit === '°F' ? 'k°F' : unit === '°' ? 'k°' : 'k');
}
