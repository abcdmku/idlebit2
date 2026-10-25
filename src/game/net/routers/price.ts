import { REGIONS } from '../../core/constants';
import { GLOBAL } from '../scope';
import { siteLatency } from './latency';
import type { RouteStrategy } from './types';

/** price (global, D1.7): the lowest regional energy price; ties by latency, then slot. Below global, firstFit. */
export const price: RouteStrategy = {
  id: 'price',
  choose(w, kind, _id, r, cand, _slot, n) {
    if (kind !== GLOBAL) return 0;
    const key = (i: number) => REGIONS[w.compiled.site.region[cand[i]!]!]!.energyPrice;
    let best = 0;
    for (let i = 1; i < n; i += 1) {
      const a = key(i), b = key(best);
      if (a < b || (a === b && siteLatency(w, cand[i]!, r) < siteLatency(w, cand[best]!, r))) best = i;
    }
    return best;
  },
};
