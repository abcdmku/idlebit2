import { conns, freeOf } from '../metrics';
import { sortBy, type RouteStrategy } from './types';

/** leastConn: fewest admitted + reserved shards first; weight free(c), so a nearly full child gets a small share. */
export const leastConn: RouteStrategy = {
  id: 'leastConn',
  weighted: true,
  plan(w, kind, _id, _r, cand, slot, weight, n) {
    const key = new Float64Array(n);
    for (let i = 0; i < n; i += 1) { weight[i] = Math.max(1, freeOf(w, kind, cand[i]!)); key[i] = conns(w, kind, cand[i]!); }
    sortBy(cand, slot, weight, n, (i) => key[i]!);
    return n;
  },
};
