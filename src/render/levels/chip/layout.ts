// CPU floorplan (layout-L2/layout.js `floorplan`, D17). Art px. Top to bottom: IN pad, queue, cache,
// cores + clock, OUT pad: a task falls through the die in the order it is handled. Every block edge
// sits on the art lattice. The world is wider and taller than any viewport, so the board fills it.
import type { Point, Rect, WorldForm } from '../../core';

export interface Floor {
  readonly world: Rect; readonly focus: Rect;
  readonly pkg: Rect; readonly die: Rect;
  readonly queue: Rect; readonly cache: Rect; readonly cores: Rect; readonly clock: Rect;
  /** IN pad (the pipe's entry) at the die top, OUT pad at its foot. */
  readonly inp: Point; readonly out: Point;
  /** The two big core sites' width and gap. */
  readonly coreW: number; readonly gapX: number;
}
interface Spec { pkgW: number; coreW: number; gapX: number; gapY: number; clockW: number; S: number; cw: number; w: number; h: number; top: number }
const SPEC: Readonly<Record<WorldForm, Spec>> = {
  desktop: { pkgW: 192, coreW: 56, gapX: 8, gapY: 8, clockW: 32, S: 56, cw: 24, w: 640, h: 400, top: 120 },
  phone: { pkgW: 160, coreW: 44, gapX: 4, gapY: 4, clockW: 32, S: 56, cw: 24, w: 320, h: 480, top: 144 },
};
const r = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h });
function floorplan(s: Spec): Floor {
  const cx = s.w / 2, pkgX = cx - s.pkgW / 2, dieY = s.top + 8;
  const x0 = pkgX + 16, inner = s.pkgW - 32;
  const queue = r(x0, dieY + 8, inner, s.cw);
  const cache = r(x0, queue.y + s.cw + s.gapY, inner, s.cw);
  const cores = r(x0, cache.y + s.cw + s.gapY, 2 * s.coreW + s.gapX, s.S);
  const clock = r(x0 + inner - s.clockW, cores.y, s.clockW, s.S);
  const dieH = cores.y + s.S + 8 - dieY, pkg = r(pkgX, s.top, s.pkgW, dieH + 16);
  return {
    world: r(0, 0, s.w, s.h), pkg, die: r(pkgX + 8, dieY, s.pkgW - 16, dieH), queue, cache, cores, clock,
    // The rest frame: the package, its socket lip and the OUT pad's first copper.
    focus: r(pkg.x - 8, pkg.y - 16, pkg.w + 16, pkg.h + 24),
    inp: { x: cx, y: dieY }, out: { x: cx, y: dieY + dieH }, coreW: s.coreW, gapX: s.gapX,
  };
}
const FLOORS: Readonly<Record<WorldForm, Floor>> = { desktop: floorplan(SPEC.desktop), phone: floorplan(SPEC.phone) };
export const floorOf = (form: WorldForm = 'desktop'): Floor => FLOORS[form];

export const MAX_CORES = 32;
const GRIDS: Readonly<Record<number, readonly [number, number]>> = { 2: [2, 1], 4: [2, 2], 8: [4, 2], 16: [4, 4], 32: [8, 4] };
const sites = new Map<string, readonly Rect[]>();
/** Core sites: two big sites (L2), or a grid once research opens more. Installing a core never moves its peers. */
export function coreSites(f: Floor, count: number): readonly Rect[] {
  const n = Math.min(MAX_CORES, Math.max(2, 2 ** Math.ceil(Math.log2(Math.max(1, count)))));
  const key = `${f.pkg.w}:${n}`, found = sites.get(key);
  if (found) return found;
  const [cols, rows] = GRIDS[n]!, z = f.cores, big = n === 2;
  const gx = big ? f.gapX : 2, gy = 2;
  const w = big ? f.coreW : Math.floor((z.w - gx * (cols - 1)) / cols);
  const h = big ? z.h : Math.floor((z.h - gy * (rows - 1)) / rows);
  const out = Array.from({ length: n }, (_, i) => r(z.x + (i % cols) * (w + gx), z.y + Math.floor(i / cols) * (h + gy), w, h));
  sites.set(key, out);
  return out;
}
/** Wide enough for per-core labels (the two big sites). */
export const labelledSites = (count: number): boolean => count <= 2;

const wells = new Map<string, readonly Rect[]>();
/** Queue slot wells, left to right after the block's label (L2). 13 art tall; the icon cell overhangs 2 art. */
export function queueWells(f: Floor, q: number, form: WorldForm = 'desktop'): readonly Rect[] {
  const n = Math.max(1, Math.min(32, q)), key = `${form}:${n}`, found = wells.get(key);
  if (found) return found;
  const r = f.queue, x0 = r.x + (form !== 'phone' ? 40 : 44), y = r.y + 7;
  const room = r.x + r.w - 4 - x0, gap = n > 16 ? 1 : 2, w = Math.max(1, Math.min(40, Math.floor((room - (n - 1) * gap) / n)));
  const out = Array.from({ length: n }, (_, i) => r_(x0 + i * (w + gap), y, w, 13));
  wells.set(key, out);
  return out;
}
const r_ = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h });
/** Inside a big core site (L2): the icon cell, the task number beside it, the line under that, the bar. */
export function coreText(r: Rect, form: WorldForm = 'desktop') {
  const desk = form !== 'phone', ix = r.x + (desk ? 8 : 4), iy = r.y + (desk ? 16 : 20);
  return { icon: { x: ix, y: iy }, id: { x: ix + (desk ? 19 : 18), y: iy }, line: desk ? { x: ix + 19, y: iy + 8 } : { x: ix, y: iy + 20 }, bar: r.y + (desk ? 40 : 48) };
}
