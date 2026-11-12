// CPU floorplan (control-deck/layout.js `floorplan`, D17). Art px. Top to bottom: IN pad, queue, cache,
// cores + clock: a task falls through the die in the order it is handled; it pays on its core. Every block edge
// sits on the art lattice. The world is wider and taller than any viewport, so the board fills it.
import type { Point, Rect, RestArea, WorldForm } from '../../core';

export const MAX_CORES = 32;

export interface Floor {
  /** Variant and row count: the key of everything cached per floorplan. */
  readonly key: string;
  readonly world: Rect; readonly focus: Rect;
  readonly pkg: Rect; readonly die: Rect;
  readonly queue: Rect; readonly cache: Rect; readonly cores: Rect; readonly clock: Rect;
  /** IN pad (the pipe's entry) at the die top. */
  readonly inp: Point;
  /** The two big core sites' width and gap. */
  readonly coreW: number; readonly gapX: number;
  /** Grid columns past two sites (fixed per form; rows grow). */
  readonly cols: number;
  /** The Clock is a row above the cores (phone: the cores take the die's full width), not a block beside them. */
  readonly clockAbove: boolean;
}
interface Spec {
  pkgW: number; coreW: number; gapX: number; gapY: number; clockW: number; S: number; cw: number; w: number; h: number; top: number;
  cols: number; inset: number; clockAbove: boolean;
  /** A tighter rest margin (small). */
  margin?: number;
  /** A shorter grid tile (dense plans); TILE_H when absent. */
  tileH?: number;
  /** A lower Clock row (`cw` when absent). */
  clockH?: number;
}
/**
 * The floorplans. `desktop` and `phone` are the Control deck dies. The rest keep the die whole at rest (D15.2)
 * where those would be cut:
 * - wide: a desktop die past 8 sites, eight tiles a row, rested at 2;
 * - short: a short view, the Clock beside the cores;
 * - broad: a short, wide view (landscape) past 8 sites, six tiles a row, the Clock beside them;
 * - small: a narrow, short view (320 px phones), a narrower package with a 2 px rim and a 4 px rest margin.
 * Past those, the dense plans keep a bigger die whole on a shorter tile (DENSE): a tile under 26 art px
 * keeps its speed, its task's type and its progress, and drops the activity word (labels.ts).
 */
type Variant = 'desktop' | 'phone' | 'wide' | 'short' | 'broad' | 'small' | 'land28' | 'phone22' | 'land21' | 'small27' | 'phone18' | 'land20' | 'land17' | 'small18' | 'tiny18';
const SPEC: Readonly<Record<Variant, Spec>> = {
  wide: { pkgW: 302, coreW: 139, gapX: 8, gapY: 4, clockW: 32, S: 56, cw: 24, w: 640, h: 400, top: 120, cols: 8, inset: 8, clockAbove: true },
  short: { pkgW: 192, coreW: 68, gapX: 4, gapY: 4, clockW: 32, S: 56, cw: 24, w: 480, h: 320, top: 96, cols: 4, inset: 8, clockAbove: false },
  broad: { pkgW: 224, coreW: 84, gapX: 4, gapY: 4, clockW: 32, S: 56, cw: 24, w: 480, h: 320, top: 96, cols: 6, inset: 8, clockAbove: false },
  small: { pkgW: 136, coreW: 62, gapX: 4, gapY: 4, clockW: 32, S: 56, cw: 24, w: 320, h: 480, top: 144, cols: 4, inset: 4, clockAbove: true, margin: 4 },
  // cols: 4 tiles a row, each wide enough for the widest speed label ("1.46 GHz") at the form's rest scale
  // (the CPU never drops it): 4 × 29 art px at 3× desktop; 4 × 36 at 2× phone, where the package widens to
  // the phone's whole free width (168 + its 8 px lip = 176 art = 352 CSS px), the blocks sit 8 art px in
  // (4 rim + 4 die) and the Clock moves to a row above the cores so they take the die's full width.
  desktop: { pkgW: 192, coreW: 56, gapX: 8, gapY: 8, clockW: 32, S: 56, cw: 24, w: 640, h: 400, top: 120, cols: 4, inset: 16, clockAbove: false },
  phone: { pkgW: 168, coreW: 74, gapX: 4, gapY: 4, clockW: 32, S: 56, cw: 24, w: 320, h: 480, top: 144, cols: 4, inset: 8, clockAbove: true },
  // DENSE. 390 px phones: 24 sites on 22 px tiles, then 32 on 18 px tiles with the small plan's rim and margin.
  phone22: { pkgW: 168, coreW: 74, gapX: 4, gapY: 4, clockW: 32, S: 56, cw: 24, w: 320, h: 480, top: 144, cols: 4, inset: 8, clockAbove: true, tileH: 22 },
  phone18: { pkgW: 168, coreW: 74, gapX: 4, gapY: 4, clockW: 32, S: 56, cw: 24, w: 320, h: 480, top: 144, cols: 4, inset: 4, clockAbove: true, margin: 4, tileH: 18 },
  // Landscape phones (844 × 390: 228 × 188 art px free), the Clock beside the cores: 15 sites five a row, 20 on
  // 21 px tiles, then six a row with a 2 px rim: 30 on 20 px tiles, 32 on 17 px tiles with a 2 px margin.
  land28: { pkgW: 220, coreW: 82, gapX: 4, gapY: 4, clockW: 32, S: 56, cw: 24, w: 480, h: 320, top: 96, cols: 5, inset: 8, clockAbove: false },
  land21: { pkgW: 220, coreW: 82, gapX: 4, gapY: 4, clockW: 32, S: 56, cw: 24, w: 480, h: 320, top: 96, cols: 5, inset: 8, clockAbove: false, tileH: 21 },
  land20: { pkgW: 220, coreW: 86, gapX: 4, gapY: 4, clockW: 32, S: 56, cw: 24, w: 480, h: 320, top: 96, cols: 6, inset: 4, clockAbove: false, margin: 4, tileH: 20 },
  land17: { pkgW: 220, coreW: 86, gapX: 4, gapY: 4, clockW: 32, S: 56, cw: 24, w: 480, h: 320, top: 96, cols: 6, inset: 4, clockAbove: false, margin: 2, tileH: 17 },
  // 320 px phones: 8 sites in two rows inside the two big sites' height, then 12 in three rows with a 2 px margin,
  // then 16 in four rows on a 1 px rim, the blocks 1 px apart and a lower Clock row (163 of the 164 art px a
  // 320 × 568 phone has). The tile rows stay on the 8 CSS px text grid, 18 px tiles on a 20 px pitch.
  small27: { pkgW: 136, coreW: 62, gapX: 4, gapY: 4, clockW: 32, S: 56, cw: 24, w: 320, h: 480, top: 144, cols: 4, inset: 4, clockAbove: true, margin: 4, tileH: 27 },
  small18: { pkgW: 136, coreW: 62, gapX: 4, gapY: 4, clockW: 32, S: 56, cw: 24, w: 320, h: 480, top: 144, cols: 4, inset: 4, clockAbove: true, margin: 2, tileH: 18 },
  tiny18: { pkgW: 136, coreW: 62, gapX: 4, gapY: 1, clockW: 32, S: 56, cw: 24, w: 320, h: 480, top: 144, cols: 4, inset: 2, clockAbove: true, margin: 2, tileH: 18, clockH: 18 },
};
const r = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h });
/** A grid tile reserves speed and activity lines above its task icon and progress bar. */
export const TILE_H = 28;
const TILE_GAP = 2;
/** Grid rows for `count` sites (0 for the two big sites). */
const rowsOf = (count: number, cols: number): number => (count <= 2 ? 0 : Math.ceil(Math.min(MAX_CORES, count) / cols));
function floorplan(s: Spec, rows: number, key: string): Floor {
  const cx = s.w / 2, pkgX = cx - s.pkgW / 2, rim = s.inset / 2, dieY = s.top + rim;
  const x0 = pkgX + s.inset, inner = s.pkgW - 2 * s.inset;
  const queue = r(x0, dieY + rim, inner, 32);
  const cache = r(x0, queue.y + queue.h + s.gapY, inner, s.cw);
  // phone: the Clock is a row of its own under the cache, so the cores span the die
  const clockRow = s.clockAbove ? r(x0, cache.y + s.cw + s.gapY, inner, s.clockH ?? s.cw) : null;
  const coresY = clockRow ? clockRow.y + clockRow.h + s.gapY : cache.y + s.cw + s.gapY;
  // The cores area keeps the Control deck height and grows downward a row at a time once tiles would be too short.
  const coresH = Math.max(s.S, rows * ((s.tileH ?? TILE_H) + TILE_GAP) - TILE_GAP);
  // desktop: the cores area runs to 4 art px short of the Clock beside it (its trace gap)
  const cores = r(x0, coresY, clockRow ? inner : inner - s.clockW - 4, coresH);
  const clock = clockRow ?? r(x0 + inner - s.clockW, cores.y, s.clockW, s.S);
  const dieH = cores.y + coresH + rim - dieY, pkg = r(pkgX, s.top, s.pkgW, dieH + 2 * rim), m = s.margin ?? 8;
  return {
    key, world: r(0, 0, s.w, Math.max(s.h, pkg.y + pkg.h + 48)), pkg, die: r(pkgX + rim, dieY, s.pkgW - 2 * rim, dieH), queue, cache, cores, clock,
    // The rest frame: the package, its shadow and its socket lip. The pipe runs in the gutter above.
    focus: r(pkg.x - 4, pkg.y - m, pkg.w + 8, pkg.h + 2 * m),
    inp: { x: cx, y: dieY }, coreW: s.coreW, gapX: s.gapX, cols: s.cols, clockAbove: s.clockAbove,
  };
}
const FLOORS = new Map<string, Floor>();
function floorFor(v: Variant, count: number): Floor {
  const s = SPEC[v], rows = rowsOf(count, s.cols), key = v + ':' + rows;
  let f = FLOORS.get(key);
  if (!f) { f = floorplan(s, rows, key); FLOORS.set(key, f); }
  return f;
}
/** The free world at rest (CSS px and the shell's N), set by the level's `focus()`; null before the first rest. */
let rest: RestArea | null = null;
export function setRestArea(area: RestArea | undefined): void { rest = area ?? null; }
const fits = (f: Floor, n: number): boolean => !!rest && f.focus.w * n <= rest.w && f.focus.h * n <= rest.h;
const PHONE_PLANS: readonly Variant[] = ['phone', 'short', 'broad', 'small', 'land28', 'phone22', 'land21', 'small27', 'phone18', 'land20', 'land17', 'small18', 'tiny18'];
/**
 * The floorplan for `count` drawn core sites (the installed cores plus the add site): the die grows with
 * the rows, and takes the first plan that rests whole in the free world (D15.2). Desktop: the Control
 * deck die at N, else eight tiles a row at 2. Phone: its own die, else the short, broad or small one,
 * else the first dense plan (shorter tiles). Where none fits whole (a 320 px phone past 16 sites), the
 * die takes the densest plan whose width fits and pans down from its top: the queue, the cache, the Clock
 * and the first cores (16 on a 320 px phone), where tasks run first.
 */
export function floorOf(form: WorldForm = 'desktop', count = 2): Floor {
  if (form !== 'phone') {
    const classic = floorFor('desktop', count);
    if (!rest || count <= 8 || fits(classic, rest.scale)) return classic;
    const wide = floorFor('wide', count);
    return fits(wide, 2) || !fits(classic, 2) ? wide : classic;
  }
  if (!rest) return floorFor('phone', count);
  for (const v of PHONE_PLANS) { const f = floorFor(v, count); if (fits(f, 2)) return f; }
  for (let i = PHONE_PLANS.length - 1; i >= 0; i--) { const f = floorFor(PHONE_PLANS[i]!, count); if (f.focus.w * 2 <= rest.w) return f; }
  return floorFor('small', count);
}

const cells = new Map<string, readonly Rect[]>(), sites = new Map<string, readonly Rect[]>();
/**
 * D34: the drawn core sites, `count` of them (the installed cores plus the one add site), in the
 * first cells of the grid shape for that count (gridCells). Core i is always cell i, row-major.
 */
export function coreSites(f: Floor, count: number): readonly Rect[] {
  const c = Math.min(MAX_CORES, Math.max(1, count)), key = `${f.key}:${c}`, found = sites.get(key);
  if (found) return found;
  const out = gridCells(f, c).slice(0, c);
  sites.set(key, out);
  return out;
}
/**
 * Every cell of the grid that holds `count` sites: two big sites (Control deck), or `f.cols` columns and as many
 * rows as the sites need, filling the cores area (`f` is the floor for that count). Cells past the sites are bare floor.
 */
export function gridCells(f: Floor, count: number): readonly Rect[] {
  const big = count <= 2, cols = big ? 2 : f.cols, rows = big ? 1 : Math.ceil(Math.min(MAX_CORES, count) / cols), n = cols * rows;
  const key = `${f.key}:${n}`, found = cells.get(key);
  if (found) return found;
  const z = f.cores, gx = big ? f.gapX : TILE_GAP, gy = TILE_GAP;
  const w = big ? f.coreW : Math.floor((z.w - gx * (cols - 1)) / cols);
  const h = big ? z.h : Math.floor((z.h - gy * (rows - 1)) / rows);
  const out = Array.from({ length: n }, (_, i) => r(z.x + (i % cols) * (w + gx), z.y + Math.floor(i / cols) * (h + gy), w, h));
  cells.set(key, out);
  return out;
}
/** Wide enough for per-core labels (the two big sites). */
export const labelledSites = (count: number): boolean => count <= 2;

const wells = new Map<string, readonly Rect[]>();
/** Eight readable family icons below the queue label, on the native art grid. */
export function queueWells(f: Floor, q: number, _form: WorldForm = 'desktop'): readonly Rect[] {
  const n = Math.max(1, Math.min(8, q)), key = `${f.key}:${n}`, found = wells.get(key);
  if (found) return found;
  const r = f.queue, x0 = r.x + 4, y = r.y + 14;
  // 16 px icon cells 2 apart; a narrow die closes the gap and lets the icons' outlines share a pixel
  const room = r.w - 8, gap = n * 16 + (n - 1) * 2 <= room ? 2 : 0, w = Math.max(14, Math.min(40, Math.floor((room - (n - 1) * gap) / n)));
  const out = Array.from({ length: n }, (_, i) => r_(x0 + i * (w + gap), y, w, 13));
  wells.set(key, out);
  return out;
}
const r_ = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h });
/**
 * How a big core site arranges its text, by the art scale the world rests at (A01), not by form:
 * 'wide' at N >= 3 (name and Hz on one line, the task beside its icon); 'stacked' at N <= 2
 * (name / Hz / icon / task / bar, one 8 art px text line each). No scale: desktop 3, phone 2.
 */
export type CoreArrangement = 'wide' | 'stacked';
export const arrangementOf = (scale: number | undefined, form: WorldForm = 'desktop'): CoreArrangement =>
  (scale ?? (form === 'phone' ? 2 : 3)) >= 3 ? 'wide' : 'stacked';
/** Inside a big core site (Control deck): the icon cell, the task name beside it (wide), the line under that, the bar. */
export function coreText(r: Rect, a: CoreArrangement = 'wide') {
  const wide = a === 'wide', ix = r.x + (wide ? 8 : 4), iy = r.y + (wide ? 16 : 20);
  return { pad: ix - r.x, icon: { x: ix, y: iy }, id: { x: ix + 19, y: iy }, line: wide ? { x: ix + 19, y: iy + 8 } : { x: ix, y: iy + 20 }, bar: r.y + (wide ? 40 : 48) };
}
