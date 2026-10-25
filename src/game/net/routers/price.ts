import { REGIONS } from '../../core/constants';
import { GLOBAL } from '../scope';
import { siteLatency } from './latency';
import { equal, sortBy, type RouteStrategy } from './types';

/** price (global, D1.7): sites by regional energy price, ties by latency, then slot; one site takes the entry. Below global, firstFit. */
export const price: RouteStrategy = {
  id: 'price',
  weighted: false,
  plan(w, kind, _id, r, cand, slot, weight, n) {
    equal(weight, n);
    if (kind !== GLOBAL) return n;
    const lat = Array.from({ length: n }, (_, i) => siteLatency(w, cand[i]!, r));
    const pr = Array.from({ length: n }, (_, i) => REGIONS[w.compiled.site.region[cand[i]!]!]!.energyPrice);
    const rank = Array.from({ length: n }, (_, i) => i).sort((a, b) => pr[a]! - pr[b]! || lat[a]! - lat[b]! || a - b);
    const pos = new Float64Array(n);
    rank.forEach((i, k) => { pos[i] = k; });
    sortBy(cand, slot, weight, n, (i) => pos[i]!);
    return n;
  },
};
