// D25.5: a finished non-final shard pays nothing; its piece just empties. Each ShardDoneView (by
// `seq`) draws on the component that ran it, over 300 ms of sim time: either its rims draining top
// to bottom, or (a level's `shardAnchor`, the sled's LCD) a bright fill draining across the window.
// Never a currency, never a pop. Many at once on one component merge into one mark.
import type { Camera, PixelRatio } from './camera';
import { projectRect } from './camera';
import type { Rect } from './geom';
import { rect } from './geom';

/** A finished non-final shard (contract name `ShardDoneView`), read from `RenderSnapshot.shardsDone`. */
export interface ShardDone {
  readonly seq: number; readonly tick: number; readonly tau: number; readonly system: number;
  readonly cpu: number | null; readonly core: number | null; readonly gpu: number | null;
  readonly taskId: number; readonly shard: number;
}
export function shardsDoneOf(s: object): readonly ShardDone[] {
  return (s as { readonly shardsDone?: readonly ShardDone[] }).shardsDone ?? [];
}
export const SHARD_DONE_MS = 300, MAX_SHARD_MARKS = 32;
interface Mark { key: number; born: number; r: Rect; fill: boolean }

export class ShardMarks {
  private readonly marks: Mark[] = Array.from({ length: MAX_SHARD_MARKS }, () => ({ key: -1, born: 0, r: rect(), fill: false }));
  private count = 0;
  private readonly at = rect();
  clear(): void { this.count = 0; }
  /** One finished shard on component `key` at `r` (art px), at sim time `atMs`. */
  add(key: number, r: Rect, atMs: number, fill = false): void {
    let m: Mark | null = null;
    for (let i = 0; i < this.count; i++) if (this.marks[i]!.key === key) { m = this.marks[i]!; break; }
    if (!m) { if (this.count >= MAX_SHARD_MARKS) return; m = this.marks[this.count++]!; }
    m.key = key; m.born = atMs; m.fill = fill; m.r.x = r.x; m.r.y = r.y; m.r.w = r.w; m.r.h = r.h;
  }
  /** The draining outline: the part of the component's rim still "full" shrinks to nothing. */
  draw(g: CanvasRenderingContext2D, nowMs: number, cam: Camera, vp: Rect, ratio: PixelRatio, n: number, clip: Rect): void {
    if (!this.count) return;
    g.save(); g.setTransform(ratio.x, 0, 0, ratio.y, 0, 0);
    g.beginPath(); g.rect(clip.x, clip.y, clip.w, clip.h); g.clip();
    for (let i = this.count - 1; i >= 0; i--) {
      const m = this.marks[i]!, u = (nowMs - m.born) / SHARD_DONE_MS;
      if (u >= 1 || u < -1) { const last = --this.count, t = this.marks[i]!; this.marks[i] = this.marks[last]!; this.marks[last] = t; continue; }
      if (u < 0) continue;
      const r = projectRect(cam, vp, ratio, m.r, this.at), left = Math.round(r.h * (1 - u) / n) * n;
      if (m.fill) {
        // The window's piece: a bright fill draining right to left, whole art px at a time.
        const w = Math.round(r.w * (1 - u) / n) * n;
        g.fillStyle = '#ffffff'; g.globalAlpha = 0.55; g.fillRect(Math.round(r.x), Math.round(r.y), w, Math.round(r.h));
        g.globalAlpha = 1; continue;
      }
      g.fillStyle = '#ffffff'; g.globalAlpha = 0.85;
      // Two side rims that drain downward, so the piece reads as emptying.
      g.fillRect(Math.round(r.x), Math.round(r.y + r.h - left), n, left);
      g.fillRect(Math.round(r.x + r.w - n), Math.round(r.y + r.h - left), n, left);
      g.fillRect(Math.round(r.x), Math.round(r.y + r.h - n), Math.round(r.w), n);
    }
    g.restore();
  }
}
