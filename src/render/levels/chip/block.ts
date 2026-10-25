// The CPU grid's empty sites as blocks (lead ruling on A25): on a grid (more than 2 sites) the open
// sites draw as one dim block and the locked sites as one block with a single lock, not one dashed
// cell each. A block is the union of its row spans; one outline goes around the whole of it.
import { P, R, SPR, mix, stamp } from '../../core';
import type { Rect } from '../../core';
import { overlaps } from './tag';

type G = CanvasRenderingContext2D;
export interface Block { readonly rows: Rect[]; n: number; readonly box: Rect }
const rect = (): Rect => ({ x: 0, y: 0, w: 0, h: 0 });
export const createBlock = (): Block => ({ rows: Array.from({ length: 8 }, rect), n: 0, box: rect() });

/** The row spans of sites [from, to) on the grid `sites` (row-major), merged down through the row gaps. */
export function blockOf(sites: readonly Rect[], from: number, to: number, out: Block): Block {
  out.n = 0;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = from; i < to; i++) {
    const s = sites[i]!, last = out.n ? out.rows[out.n - 1]! : null;
    if (last && last.y === s.y) { last.w = s.x + s.w - last.x; }
    else if (out.n < out.rows.length) { const r = out.rows[out.n++]!; r.x = s.x; r.y = s.y; r.w = s.w; r.h = s.h; }
    x0 = Math.min(x0, s.x); y0 = Math.min(y0, s.y); x1 = Math.max(x1, s.x + s.w); y1 = Math.max(y1, s.y + s.h);
  }
  // Each row reaches down to the next, so the fill closes the gaps between them.
  for (let k = 0; k + 1 < out.n; k++) out.rows[k]!.h = out.rows[k + 1]!.y - out.rows[k]!.y;
  out.box.x = x0; out.box.y = y0; out.box.w = x1 - x0; out.box.h = y1 - y0;
  if (!out.n) { out.box.w = 0; out.box.h = 0; }
  return out;
}
const LOCK_W = 7, LOCK_H = 8; // SPR.lock
const lockAt: Rect = { x: 0, y: 0, w: LOCK_W, h: LOCK_H };
/**
 * Where the single lock goes: the centre of the widest row, else the far (right) end of a row,
 * widest first, else the bottom-right corner; the first spot clear of `avoid` (the busy tag's text).
 * Null when the block is too small for it or no spot is clear.
 */
export function lockSpot(b: Block, avoid: Rect | null): Rect | null {
  if (!b.n || b.box.h < 10) return null;
  let best = b.rows[0]!;
  for (let k = 1; k < b.n; k++) if (b.rows[k]!.w > best.w) best = b.rows[k]!;
  if (best.w < 11) return null;
  const clear = (x: number, y: number): boolean => { lockAt.x = x; lockAt.y = y; return !avoid || !overlaps(lockAt, avoid); };
  const y = b.n > 1 ? b.box.y + (b.box.h >> 1) : best.y + (best.h >> 1);
  if (clear(best.x + (best.w >> 1) - 3, y - 4)) return lockAt;
  for (const r of [best, ...b.rows.slice(0, b.n)]) {
    if (r.w < 11) continue;
    const ry = r === best ? y : r.y + (r.h >> 1);
    if (clear(r.x + r.w - 2 - LOCK_W, ry - 4)) return lockAt;
    if (r.h >= LOCK_H + 4 && clear(r.x + r.w - 2 - LOCK_W, r.y + r.h - 2 - LOCK_H)) return lockAt;
  }
  return null;
}
/** One outline around the union, a flat fill inside; `locked` adds a single lock (lockSpot) clear of `avoid`. */
export function drawBlock(g: G, b: Block, locked: boolean, avoid: Rect | null = null): void {
  if (!b.n) return;
  const edge = locked ? P.silkLo : mix(P.silkLo, P.silk, 0.5), fill = locked ? P.wafer : mix(P.wafer, P.ink, 0.25);
  for (let k = 0; k < b.n; k++) { const r = b.rows[k]!; R(g, r.x - 1, r.y - 1, r.w + 2, r.h + 2, edge); }
  for (let k = 0; k < b.n; k++) { const r = b.rows[k]!; R(g, r.x, r.y, r.w, r.h, fill); }
  if (!locked) return;
  const at = lockSpot(b, avoid);
  if (at) stamp(g, SPR.lock, at.x, at.y);
}
