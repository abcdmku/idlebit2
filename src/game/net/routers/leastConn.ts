import { conns } from '../metrics';
import { argmin, type RouteStrategy } from './types';

/** leastConn: the fewest admitted + reserved tasks; ties to the lowest slot. */
export const leastConn: RouteStrategy = {
  id: 'leastConn',
  choose: (w, kind, _id, _r, cand, _slot, n) => argmin(n, (i) => conns(w, kind, cand[i]!)),
};
