import { familyType } from '../market/taskTypes';
import { FAIL_CAUSES } from '../types/events';
import { familyId } from '../types/ids';
import type { FailureView } from '../types/views';
import type { HotBuffers } from './buffers';
import type { World } from './world';
import { completionLog, observeCompletionLog } from './completions';

const CAPACITY = 2048, STRIDE = 6;
export interface FailureLog { values: Float64Array; next: number }
/** Transient, bounded history; structured clones and saves carry no recording observer. */
let nextSeq = 1;
export const failureCursor = (hot: HotBuffers): number => completionLog(hot)?.failures?.next ?? 0;

/** First view starts capture; cursor reads never mutate the simulation or consume another view. */
export function readFailures(hot: HotBuffers, after = 0): readonly FailureView[] {
  const observer = observeCompletionLog(hot), log = observer.failures;
  if (!log) {
    observer.failures = { values: new Float64Array(CAPACITY * STRIDE), next: 0 };
    return [];
  }
  const out: FailureView[] = [], v = log.values;
  for (let seq = Math.max(after, log.next - CAPACITY); seq < log.next; seq += 1) {
    const p = (seq % CAPACITY) * STRIDE, family = v[p + 4]!;
    out.push({ seq: v[p]!, tick: v[p + 1]!, tau: v[p + 2]!, taskId: v[p + 3]!, family: familyId(family), type: familyType(family), cause: FAIL_CAUSES[v[p + 5]!]! });
  }
  return out;
}

/** One entry per logical task; cohorts own contiguous IDs and gang losses call this only once. */
export function recordFailures(w: World, family: number, cause: number, count: number, taskId: number): void {
  const log = w.completions?.failures;
  if (!log) return;
  const retained = Math.min(count, CAPACITY), skipped = count - retained, v = log.values;
  log.next += skipped;
  // Admission and between-tick swaps occur at the start; deadline, power and heat at the end.
  const tau = w.late ? 1 : 0;
  for (let i = 0; i < retained; i += 1) {
    const p = (log.next % CAPACITY) * STRIDE;
    v[p] = nextSeq++; v[p + 1] = w.tick; v[p + 2] = tau;
    v[p + 3] = taskId + skipped + i; v[p + 4] = family; v[p + 5] = cause;
    log.next += 1;
  }
}
