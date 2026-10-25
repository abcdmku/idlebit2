import { rated } from '../metrics';
import type { RouteStrategy } from './types';

/** weighted: index order; weight rated(c) over its systems with room, so mixed-generation children get shares in proportion to speed. */
export const weighted: RouteStrategy = {
  id: 'weighted',
  weighted: true,
  plan(w, kind, _id, _r, cand, _slot, weight, n) {
    for (let i = 0; i < n; i += 1) weight[i] = Math.max(1e-300, rated(w, kind, cand[i]!, true));
    return n;
  },
};
