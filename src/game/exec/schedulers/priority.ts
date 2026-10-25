import { estRecord } from '../est';
import { keyedStrategy } from './types';

/** Priority (priorityQ): the highest payout per second of est first. */
export const priority = keyedStrategy('priority', (w, s, r) => {
  const est = estRecord(w, s, r);
  return est > 0 ? -w.hot.rec.payout[r]! / est : -Infinity;
});
