import type { World } from '../../core/world';
import type { QueueStrategyId } from '../../types/catalog';
import { startable } from '../est';

/**
 * System strategies (spec §8.1, architecture §1.6). A strategy orders one choice: which queued
 * task starts next. The market order is fixed: a system always takes the head. Each strategy is a
 * key (lower first); ties go to the earlier take, then the lower task id. Pure reads.
 */
export type QueueKey = (w: World, s: number, r: number) => number;

export interface QueueStrategy {
  readonly id: QueueStrategyId;
  /** Compute is shared by all running tasks; Keff = 2K; no in-tick chaining (spec §6.6, §6.7). */
  readonly timeSlice: boolean;
  /** The queued record of system s to start next among those that fit now, or -1. */
  pickQueue(w: World, s: number): number;
}

const earlier = (w: World, a: number, b: number): boolean => {
  const rec = w.hot.rec;
  const ta = rec.taken[a]!, tb = rec.taken[b]!;
  return ta !== tb ? ta < tb : rec.taskId[a]! < rec.taskId[b]!;
};

export function keyedStrategy(id: QueueStrategyId, key: QueueKey, timeSlice = false): QueueStrategy {
  return {
    id, timeSlice,
    pickQueue(w, s) {
      const next = w.hot.rec.next;
      let best = -1, bestKey = Infinity;
      for (let r = w.hot.sys.queueHead[s]!; r >= 0; r = next[r]!) {
        if (!startable(w, s, r, timeSlice)) continue;
        const k = key(w, s, r);
        if (best < 0 || k < bestKey || (k === bestKey && earlier(w, r, best))) { best = r; bestKey = k; }
      }
      return best;
    },
  };
}
