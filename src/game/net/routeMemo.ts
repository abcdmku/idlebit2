import type { World } from '../core/world';

/*
 * Route-phase memos (derived, never state). The route phase recounts the free-slot summaries first
 * and keeps them exact through every take, so a live rack with `freeSlots` 0 holds no system that
 * can admit now, and a system only stops admitting within the phase. Nothing in the phase changes a
 * system's run lists or rates, so values built from them hold for the whole phase (`phase` stamp);
 * nothing changes at all during one placement decision (the take follows it), so values that also
 * read reservations, link queues or the record hold for that decision (`decision` stamp).
 * Outside the route phase `exact` is false and nothing is memoized.
 */
export const memo = { exact: false, phase: 1, decision: 1, rec: -1, epoch: 0 };

const next = (stamp: number): number => {
  if (stamp + 1 < 0x7fffffff) return stamp + 1;
  memo.epoch += 1; // every stamped array is cleared on its next use
  return 1;
};

/** Runs the take loop of one route phase with exact summaries. */
export function withExactSummaries(_w: World, run: () => void): void {
  memo.phase = next(memo.phase);
  beginDecision();
  memo.exact = true;
  try { run(); } finally { memo.exact = false; }
}

/** Starts a placement decision: before each take attempt. */
export function beginDecision(): void {
  memo.decision = next(memo.decision);
  memo.rec = -1;
}

/** Called with the record a decision scores: a different record starts a new decision. */
export function decisionFor(r: number): void {
  if (r === memo.rec) return;
  if (memo.rec >= 0) beginDecision();
  memo.rec = r;
}

/** A stamped per-unit memo column pair: `at[i] === stamp` marks `val[i]` valid. */
export class Stamped {
  at = new Int32Array(0);
  val = new Float64Array(0);
  private epoch = 0;
  /** Grows to n entries and clears after a stamp wrap. */
  ensure(n: number): this {
    if (this.at.length < n) { this.at = new Int32Array(n * 2); this.val = new Float64Array(n * 2); }
    else if (this.epoch !== memo.epoch) this.at.fill(0);
    this.epoch = memo.epoch;
    return this;
  }
}
