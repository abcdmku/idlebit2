import type { HotBuffers } from '../core/buffers';
import { RATE_RING_TICKS, TICKS_PER_SECOND } from '../core/constants';
import { FAIL_CAUSES, type FailCause } from '../types/events';

export interface FeedRates {
  /** Takes per second over the last 10 s; met and failed tasks per second over the last 2 s. */
  readonly takes: number; readonly met: number; readonly fail: number;
  /** Dominant failure cause over the last 2 s, with the total failure rate. */
  readonly failBin: { readonly cause: FailCause; readonly perSec: number } | null;
}

const TWO_S = 2 * TICKS_PER_SECOND;
const WINDOW_S = RATE_RING_TICKS / TICKS_PER_SECOND;
const NONE: FeedRates = { takes: 0, met: 0, fail: 0, failBin: null };

/**
 * Rates from the market's per-tick ring (hot.ring, row tick % RATE_RING_TICKS). Rows whose `at`
 * falls outside the window are stale (skipped ticks, an earlier round) and count as zero.
 * `tick` is the number of ticks completed, so the last tick run is tick − 1.
 */
export function feedRates(hot: HotBuffers, tick: number): FeedRates {
  const ring = hot.ring;
  const causes = FAIL_CAUSES.length;
  let takes = 0, met = 0, fail = 0, any = false;
  const by = new Float64Array(causes);
  for (let k = 1; k <= RATE_RING_TICKS; k += 1) {
    const t = tick - k;
    if (t < 0) break;
    const row = t % RATE_RING_TICKS;
    if (ring.at[row] !== t) continue;
    any = true;
    takes += ring.taken[row] ?? 0;
    if (k > TWO_S) continue;
    met += ring.met[row] ?? 0;
    fail += ring.failed[row] ?? 0;
    for (let c = 0; c < causes; c += 1) by[c]! += ring.failBy[row * causes + c] ?? 0;
  }
  if (!any) return NONE;
  let top = -1;
  for (let c = 0; c < causes; c += 1) if (by[c]! > 0 && (top < 0 || by[c]! > by[top]!)) top = c;
  return {
    takes: takes / WINDOW_S, met: met / 2, fail: fail / 2,
    failBin: top >= 0 ? { cause: FAIL_CAUSES[top]!, perSec: fail / 2 } : null,
  };
}
