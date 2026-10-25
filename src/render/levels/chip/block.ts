// The CPU grid's empty sites as blocks (lead ruling on A25): on a grid (more than 2 sites) the open
// sites draw as one dim block and the locked sites as one block with a single lock, not one dashed
// cell each. A block is the union of its row spans; one outline goes around the whole of it.
import { P, R, SPR, mix, stamp } from '../../core';
import type { Rect } from '../../core';

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
/** One outline around the union, a flat fill inside; `locked` adds a single lock at the block's widest row. */
export function drawBlock(g: G, b: Block, locked: boolean): void {
  if (!b.n) return;
  const edge = locked ? P.silkLo : mix(P.silkLo, P.silk, 0.5), fill = locked ? P.wafer : mix(P.wafer, P.ink, 0.25);
  for (let k = 0; k < b.n; k++) { const r = b.rows[k]!; R(g, r.x - 1, r.y - 1, r.w + 2, r.h + 2, edge); }
  for (let k = 0; k < b.n; k++) { const r = b.rows[k]!; R(g, r.x, r.y, r.w, r.h, fill); }
  if (!locked) return;
  let best = b.rows[0]!;
  for (let k = 1; k < b.n; k++) if (b.rows[k]!.w > best.w) best = b.rows[k]!;
  const y = b.n > 1 ? b.box.y + (b.box.h >> 1) : best.y + (best.h >> 1);
  if (best.w >= 11 && b.box.h >= 10) stamp(g, SPR.lock, best.x + (best.w >> 1) - 3, y - 4);
}
