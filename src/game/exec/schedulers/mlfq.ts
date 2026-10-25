import { estRecord } from '../est';
import { keyedStrategy } from './types';

/** A queued task that has waited this long starts first (3 s, spec §8.1). */
export const MLFQ_AGING_TICKS = 30;

/** Aging inside the queue (mlfq): sjf, but tasks queued 3 s or more start first (earliest take of those). */
export const mlfq = keyedStrategy('mlfq', (w, s, r) => (w.tick - w.hot.rec.taken[r]! >= MLFQ_AGING_TICKS ? -1 : estRecord(w, s, r)));
