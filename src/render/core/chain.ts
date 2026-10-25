// Chained zooms. v3 publishes two level snapshots (focus and partner), so a jump of several
// levels plays one level per transition. The chain gives those steps the mockup's timing and
// easing for the whole jump (core/view.js: one cubic in-out over min(2.6, 0.62 + 0.56 n) s):
// step k of n samples [k/n, (k+1)/n] of that one curve, so the camera never stops between levels.
import { zoomSeconds } from './transition';
import type { ZoomSegment } from './transition';

/** A step may start this long after the previous one ended and still continue its chain. */
export const CHAIN_GAP_S = 0.5;
const SINGLE: ZoomSegment = { a: 0, b: 1, total: zoomSeconds(1) };

export class ZoomChain {
  private n = 0;
  private k = 0;
  private toDepth = -1;
  private goalDepth = -1;
  private endS = -Infinity;
  private segment: ZoomSegment = SINGLE;

  /**
   * The segment for a one-level step from depth `from` to depth `to`. `goal` is the depth the view
   * is heading for (the UI's `zoomGoal`), or null for a single step. Depth grows outward.
   */
  step(from: number, to: number, goal: number | null, nowS: number): ZoomSegment {
    const dir = Math.sign(to - from);
    const aim = goal !== null && Math.sign(goal - to) === dir ? goal : to;
    const continues = this.n > 0 && this.k + 1 < this.n && from === this.toDepth && aim === this.goalDepth
      && Math.sign(this.goalDepth - from) === dir && nowS - this.endS <= CHAIN_GAP_S;
    if (continues) this.k++;
    else { this.n = 1 + Math.abs(aim - to); this.k = 0; this.goalDepth = aim; }
    this.toDepth = to; this.endS = Infinity;
    this.segment = this.n === 1 ? SINGLE : { a: this.k / this.n, b: (this.k + 1) / this.n, total: zoomSeconds(this.n) };
    return this.segment;
  }
  /** The step ended at `nowS` (finished or cut). */
  end(nowS: number): void { if (this.endS === Infinity) this.endS = nowS; }
  /** Forget the chain (resize, epoch change, a cut). */
  reset(): void { this.n = 0; this.k = 0; this.endS = -Infinity; this.toDepth = -1; this.goalDepth = -1; }
  get steps(): number { return this.n; }
  get index(): number { return this.k; }
}
