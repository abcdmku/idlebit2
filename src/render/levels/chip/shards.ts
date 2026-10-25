// D25 pieces on the CPU: a shard runs on `shardThreads` cores at once, so the cores holding one
// shard (equal taskId and shard) are outlined in its task type's colour as one group, joined across
// the gaps between neighbours. Each core's piece is the work it still holds (1 − progress), so it
// empties as the shard finishes. Real state only: nothing moves unless the core's progress does.
import { familyId } from '../../../game';
import type { CoreView } from '../../../game';
import { P, R, frame as outline, typeColor, typeOf } from '../../core';
import type { Rect } from '../../core';

type G = CanvasRenderingContext2D;

/** The task type colour of the shard a core runs (D23), or null when it runs none. */
export const coreColor = (c: CoreView): string | null => (c.family === null ? null : typeColor(typeOf(familyId(c.family))));
/** Two cores run one shard: the same task and shard index. */
export const sameShard = (a: CoreView, b: CoreView): boolean => a.taskId !== null && a.taskId === b.taskId && a.shard === b.shard;
/** The work a piece still holds, 0..1. */
export const remaining = (progress: number): number => 1 - Math.max(0, Math.min(1, progress));

/** A piece gauge: an ink well and the remaining work in `colour`, draining right to left. */
export function drawPiece(g: G, x: number, y: number, w: number, h: number, left: number, colour: string): void {
  R(g, x, y, w, h, P.ink); R(g, x + 1, y + 1, w - 2, h - 2, P.logicLo);
  const fw = Math.round((w - 2) * Math.max(0, Math.min(1, left)));
  if (fw > 0) R(g, x + 1, y + 1, fw, h - 2, colour);
}
/** The piece inside a small grid core site: a 4 art tall gauge at the foot of its top face. */
export function drawGridPiece(g: G, r: Rect, left: number, colour: string): void {
  if (r.w < 6 || r.h < 10) return;
  // Short tiles (under 18 art px) leave room for their speed label: the piece drains along the foot row.
  if (r.h < 18) { g.fillStyle = colour; g.fillRect(r.x + 1, r.y + r.h - 1, Math.round((r.w - 2) * Math.max(0, Math.min(1, left))), 1); return; }
  drawPiece(g, r.x + 1, r.y + r.h - 7, r.w - 2, 4, left, colour);
}

/**
 * Outline each busy core in its shard's colour, and bridge the gap to its right and lower neighbour
 * when that neighbour runs the same shard, so a shard's cores read as one block. `live` false draws
 * nothing (paused or offline hardware holds no running work on screen).
 */
export function drawShardGroups(g: G, sites: readonly Rect[], cores: readonly CoreView[], live: boolean): void {
  if (!live) return;
  const n = Math.min(sites.length, cores.length);
  let cols = 0;
  for (const s of sites) if (s.y === sites[0]!.y) cols++;
  for (let i = 0; i < n; i++) {
    const c = cores[i]!, r = sites[i]!;
    if (c.busy <= 0) continue;
    const colour = coreColor(c);
    if (!colour) continue;
    // The colour ring, with an ink ring inside it so it reads on the core's own purple too.
    outline(g, r.x, r.y, r.w, r.h, colour);
    if (r.w >= 8 && r.h >= 8) outline(g, r.x + 1, r.y + 1, r.w - 2, r.h - 2, P.ink);
    const right = i + 1 < n && (i + 1) % cols !== 0 ? i + 1 : -1, below = i + cols < n ? i + cols : -1;
    if (right >= 0 && cores[right]!.busy > 0 && sameShard(c, cores[right]!)) {
      const o = sites[right]!, gap = o.x - (r.x + r.w);
      R(g, r.x + r.w, r.y, gap, 1, colour); R(g, r.x + r.w, r.y + r.h - 1, gap, 1, colour);
    }
    if (below >= 0 && cores[below]!.busy > 0 && sameShard(c, cores[below]!)) {
      const o = sites[below]!, gap = o.y - (r.y + r.h);
      R(g, r.x, r.y + r.h, 1, gap, colour); R(g, r.x + r.w - 1, r.y + r.h, 1, gap, colour);
    }
  }
}
