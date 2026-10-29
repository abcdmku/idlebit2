// CPU art (control-deck/art.js): board weave, package and die, and the die blocks. Static parts are
// cached per form; per-frame blocks draw only what state changes.
import type { ChipQueueEntryView, FamilyId } from '../../../game';
import { P, R, SPR, bandColor, brackets, cached, dotted, drawFamilyIcon, frame, hash, mix, prism, px, shadow, stamp } from '../../core';
import type { Rect, WorldForm } from '../../core';
import type { Floor } from './layout';

type G = CanvasRenderingContext2D;
export const METAL = mix(P.pad, P.wafer, 0.35);
export const CLOCK_TRACE = mix(P.amber, P.wafer, 0.45);

function board(g: G, b: Rect): void {
  R(g, b.x, b.y, b.w, b.h, P.mask);
  g.fillStyle = P.maskLo;
  for (let y = b.y + 2; y < b.y + b.h - 1; y += 3) for (let x = b.x + ((y * 5) % 7); x < b.x + b.w - 1; x += 7) g.fillRect(x, y, 2, 1);
  g.fillStyle = mix(P.mask, P.ink, 0.35);
  for (let y = b.y + 6; y < b.y + b.h - 3; y += 8) for (let x = b.x + 6; x < b.x + b.w - 3; x += 8) if (hash(x * 31 + y) > 0.55) g.fillRect(x, y, 1, 1);
}
function cpuPackage(g: G, pkg: Rect, die: Rect): void {
  shadow(g, pkg.x - 3, pkg.y - 3, pkg.w + 6, pkg.h + 10, 3, 3);
  R(g, pkg.x - 3, pkg.y + pkg.h + 2, pkg.w + 6, 6, P.ink); R(g, pkg.x - 2, pkg.y + pkg.h + 3, pkg.w + 4, 4, P.steelLo);
  R(g, pkg.x - 2, pkg.y + pkg.h + 3, pkg.w + 4, 1, mix(P.steelLo, P.steel, 0.5));
  for (let x = pkg.x + 2; x < pkg.x + pkg.w - 2; x += 4) R(g, x, pkg.y + pkg.h + 5, 2, 1, P.padLo);
  R(g, pkg.x - 3, pkg.y - 3, pkg.w + 6, pkg.h + 6, P.ink);
  R(g, pkg.x - 2, pkg.y - 2, pkg.w + 4, pkg.h + 4, P.steelLo);
  R(g, pkg.x - 2, pkg.y - 2, pkg.w + 4, 1, P.steel); R(g, pkg.x - 2, pkg.y - 2, 1, pkg.h + 4, P.steel);
  R(g, pkg.x - 1, pkg.y - 1, pkg.w + 2, pkg.h + 2, P.ink);
  R(g, pkg.x, pkg.y, pkg.w, pkg.h, PKG);
  R(g, pkg.x, pkg.y, pkg.w, 1, PKG_HI); R(g, pkg.x, pkg.y, 1, pkg.h, PKG_HI);
  R(g, pkg.x + 2, pkg.y + 2, 3, 1, P.pad); R(g, pkg.x + 2, pkg.y + 3, 2, 1, P.pad); px(g, pkg.x + 2, pkg.y + 4, P.pad);
  for (let x = die.x + 4; x < die.x + die.w - 3; x += 4) { R(g, x, pkg.y + 4, 2, 2, P.padLo); R(g, x, pkg.y + pkg.h - 6, 2, 2, P.padLo); }
  for (let y = die.y + 4; y < die.y + die.h - 3; y += 4) { R(g, pkg.x + 4, y, 2, 2, P.padLo); R(g, pkg.x + pkg.w - 6, y, 2, 2, P.padLo); }
  R(g, die.x - 1, die.y - 1, die.w + 2, die.h + 2, P.ink);
  R(g, die.x, die.y, die.w, die.h, P.wafer);
  R(g, die.x, die.y, die.w, 1, P.waferHi); R(g, die.x, die.y, 1, die.h, P.waferHi);
  R(g, die.x + die.w - 1, die.y + 1, 1, die.h - 1, P.waferLo); R(g, die.x + 1, die.y + die.h - 1, die.w - 1, 1, P.waferLo);
  g.fillStyle = P.waferLo;
  for (let y = die.y + 3; y < die.y + die.h - 2; y += 2) for (let x = die.x + 2 + ((y >> 1) % 3); x < die.x + die.w - 2; x += 9) if (hash(x + y * 7) > 0.7) g.fillRect(x, y, 1, 1);
}
export const PKG = '#1d3a2e', PKG_HI = '#2c5440';

/** The board, the package and the die's bus metal: IN down to the queue, cache, then each core. */
export function staticCpu(f: Floor, form: WorldForm): HTMLCanvasElement {
  return cached(`v3-cpu:${form}:${f.pkg.h}`, f.world.w, f.world.h, g => {
    board(g, f.world); cpuPackage(g, f.pkg, f.die);
    const cx = f.inp.x;
    R(g, cx - 1, f.die.y, 2, f.cores.y - f.die.y - 4, METAL);
  });
}
/** Bus metal from the shared spine to each core in use (2 art wide). Work pays on its core. */
export function drawMetal(g: G, f: Floor, centres: readonly number[]): void {
  const cx = f.inp.x, joinY = f.cores.y - 4;
  let xa = cx, xb = cx;
  for (const x of centres) { xa = Math.min(xa, x); xb = Math.max(xb, x); }
  R(g, xa - 1, joinY - 1, xb - xa + 2, 2, METAL);
  for (const x of centres) R(g, x - 1, joinY, 2, 4, METAL);
}

export function pad(g: G, x: number, y: number, lit: boolean): void {
  R(g, x - 4, y - 2, 9, 5, P.ink); R(g, x - 3, y - 1, 7, 3, lit ? P.padHi : P.pad); R(g, x - 3, y + 1, 7, 1, P.padLo);
}
export function coreBlock(g: G, r: Rect, busy: boolean, lent: boolean): Rect {
  const top = lent ? mix(P.logic, P.rnd, 0.72) : busy ? P.logicHi : P.logic;
  const front = lent ? mix(P.logicLo, P.rndLo, 0.7) : busy ? P.logic : P.logicLo;
  return prism(g, r.x, r.y + 3, r.w, r.h - 3, 3, { top, front, sx: 2, sy: 2 });
}
/**
 * The next core's empty well. Its centered name and price are supplied by the UI or labels.
 */
export function addSite(g: G, r: Rect, affordable: boolean): void {
  R(g, r.x, r.y, r.w, r.h, P.ink);
  R(g, r.x + 1, r.y + 1, r.w - 2, r.h - 2, mix(P.wafer, P.ink, 0.25));
  if (r.w >= 8) dotted(g, r.x + 1, r.y + 1, r.w - 2, r.h - 2, affordable ? P.silk : P.silkLo, 0, 1, 2);
}
/** A locked site (A25): bare die, one dim outline and the lock glyph, no text; the callout names it. */
export function lockedSite(g: G, r: Rect): void {
  R(g, r.x, r.y, r.w, r.h, P.wafer);
  frame(g, r.x, r.y, r.w, r.h, P.silkLo);
  if (r.w >= 11 && r.h >= 12) stamp(g, SPR.lock, r.x + (r.w >> 1) - 3, r.y + (r.h >> 1) - 4);
}
/** A progress bar 4 art tall: ink rim, dark well, the filled fraction in `c`. */
export function bar(g: G, x: number, y: number, w: number, f: number, c: string): void {
  R(g, x, y, w, 4, P.ink); R(g, x + 1, y + 1, w - 2, 2, P.logicLo);
  R(g, x + 1, y + 1, Math.round((w - 2) * Math.max(0, Math.min(1, f))), 2, c);
}
export function clockBlock(g: G, r: Rect, tick: boolean): void {
  const top = prism(g, r.x, r.y + 3, r.w, r.h - 3, 3, { top: P.waferHi, front: P.wafer });
  if (r.w > r.h * 2) {
    // a Clock row (phone): the crystal can at the right end, its tick lamp just left of it
    const cx = top.x + top.w - 14, cy = top.y + (top.h >> 1);
    R(g, cx - 9, cy - 5, 18, 11, P.ink); R(g, cx - 8, cy - 4, 16, 9, P.steel);
    R(g, cx - 8, cy - 4, 16, 1, P.steelHi); R(g, cx - 8, cy + 4, 16, 1, P.steelLo); R(g, cx - 6, cy - 2, 12, 5, mix(P.steel, P.steelHi, 0.4));
    const lx = cx - 16, ly = cy - 1;
    R(g, lx - 1, ly - 1, 4, 4, P.ink); R(g, lx, ly, 2, 2, tick ? P.amber : '#3b2a12');
    if (tick) { g.globalAlpha = 0.35; R(g, lx - 2, ly - 2, 6, 6, P.amber); g.globalAlpha = 1; }
    return;
  }
  const cx = top.x + (top.w >> 1), cy = top.y + top.h - 15;
  R(g, cx - 9, cy - 5, 18, 11, P.ink); R(g, cx - 8, cy - 4, 16, 9, P.steel);
  R(g, cx - 8, cy - 4, 16, 1, P.steelHi); R(g, cx - 8, cy + 4, 16, 1, P.steelLo);
  R(g, cx - 6, cy - 2, 12, 5, mix(P.steel, P.steelHi, 0.4));
  // The tick lamp lights on each real cycle a core executes; steady at the eye rate and up.
  const lx = top.x + top.w - 6, ly = top.y + 3;
  R(g, lx - 1, ly - 1, 4, 4, P.ink); R(g, lx, ly, 2, 2, tick ? P.amber : '#3b2a12');
  if (tick) { g.globalAlpha = 0.35; R(g, lx - 2, ly - 2, 6, 6, P.amber); g.globalAlpha = 1; }
}
/** Shared cache: each bit's light fills during its load; larger caches use one continuous bar. */
/**
 * `spilled` (D26 `cache.spilledOutBits`): bits of running shards that didn't fit and went on to RAM.
 * They show as a hatched overflow block in the RAM colour at the bar's right end, up to a third of it,
 * in proportion to the spill against the cache size.
 */
export function cacheBlock(g: G, r: Rect, bits: number, loaded: number, spilled = 0): void {
  const top = prism(g, r.x, r.y + 3, r.w, r.h - 3, 3, { top: P.sram, front: P.sramLo });
  const cy = top.y + top.h - 9, x0 = top.x + 4, w = top.w - 8;
  if (bits >= 1 && bits <= 32) {
    const cell = bits <= 4 ? 16 : bits <= 16 ? Math.min(8, Math.floor((w + 2) / bits) - 2) : Math.floor((w + 1) / bits) - 1;
    const step = cell + (bits <= 16 ? 2 : 1);
    for (let i = 0; i < bits; i++) {
      const x = x0 + i * step;
      const fill = Math.round(cell * Math.max(0, Math.min(1, loaded - i)));
      R(g, x - 1, cy - 1, cell + 2, 8, P.ink); R(g, x, cy, cell, 6, P.sramLo);
      if (fill > 0) { R(g, x, cy, fill, 6, P.cacheOn); R(g, x, cy, fill, 1, P.paper); }
    }
  } else {
    R(g, x0 - 1, cy - 1, w + 2, 8, P.ink); R(g, x0, cy, w, 6, P.sramLo);
    if (bits > 0) R(g, x0, cy, Math.round((w * Math.max(0, Math.min(loaded, bits))) / bits), 6, P.cacheOn);
  }
  if (spilled > 0) {
    const k = Math.max(3, Math.round((w / 3) * Math.min(1, spilled / Math.max(1, bits))));
    R(g, x0 + w - k - 1, cy - 1, k + 2, 8, P.ink); R(g, x0 + w - k, cy, k, 6, P.ram); hatch(g, x0 + w - k, cy, k, 6);
  }
}
/** Diagonal ink stripes: spilled bits (D26), the same hatch as the System board's tiers. */
function hatch(g: G, x: number, y: number, w: number, h: number): void {
  g.fillStyle = P.ink;
  for (let j = 0; j < h; j++) for (let i = j % 3; i < w; i += 3) g.fillRect(x + i, y + j, 1, 1);
}
export function queueGhost(g: G, r: Rect): void {
  R(g, r.x, r.y, r.w, r.h, mix(P.wafer, P.ink, 0.2));
  dotted(g, r.x, r.y, r.w, r.h, P.silkLo, 0, 1, 2); brackets(g, r.x, r.y, r.w, r.h, P.silk, 3);
}
/** The scheduler's queue: its wells, left to right; well i holds the i-th oldest waiting task, by its family icon. */
/** Wells reserved for tasks still on the pipe: how many, and the one landing now (its family and progress). */
export interface Incoming { count: number; family: FamilyId | null; progress: number }
/**
 * The scheduler's queue: landed tasks first, oldest left, each as its family icon. After them, the
 * wells reserved for tasks still in transit ("incoming"): the one on the pipe now shows its icon dimmed
 * with a thin bar at the transfer's real progress in its type colour; the rest wait as dim outlines.
 * Empty wells stay empty.
 */
export function queueBlock(g: G, r: Rect, wells: readonly Rect[], queue: readonly (ChipQueueEntryView | null)[], incoming: Incoming | null = null): void {
  prism(g, r.x, r.y + 3, r.w, r.h - 3, 3, { top: P.logicLo, front: mix(P.logicLo, P.ink, 0.4) });
  const reserved = incoming ? Math.min(incoming.count, Math.max(0, wells.length - queue.length)) : 0;
  for (let i = 0; i < wells.length; i++) {
    const w = wells[i]!, e = queue[i];
    R(g, w.x - 1, w.y - 1, w.w + 2, w.h + 2, P.ink); R(g, w.x, w.y, w.w, w.h, mix(P.logicLo, P.ink, 0.45));
    if (e) {
      if (w.w >= 16) drawFamilyIcon(g, e.family, w.x, w.y - 2); else R(g, w.x, w.y, w.w, w.h, e.preloading ? P.preload : P.bitLo);
      if (e.preloading) R(g, w.x, w.y + w.h - 2, Math.round(w.w * Math.max(0, Math.min(1, e.preloadProgress ?? 0))), 2, P.preload);
      continue;
    }
    const k = i - queue.length;
    if (k < 0 || k >= reserved) continue;
    // Incoming: the first reserved well is the task on the pipe now (its icon, dimmed, and its progress).
    const landing = k === 0 && incoming!.family !== null;
    brackets(g, w.x, w.y, w.w, w.h, mix(P.silk, P.ink, 0.35), 2);
    if (!landing) continue;
    const a = g.globalAlpha, colour = bandColor(incoming!.family!);
    // Its icon dimmed on a wide well; a narrow well (16 slots) is tinted in the task's type colour instead.
    g.globalAlpha = a * 0.35;
    if (w.w >= 16) drawFamilyIcon(g, incoming!.family!, w.x, w.y - 2); else R(g, w.x, w.y, w.w, w.h - 2, colour);
    g.globalAlpha = a;
    R(g, w.x, w.y + w.h - 2, Math.round(w.w * Math.max(0, Math.min(1, incoming!.progress))), 2, colour);
  }
}
