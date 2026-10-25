import { POWER_LIMIT } from '../filters';
import { hasRunRoom, supplyUsage } from '../metrics';
import { equal, keepIf, type RouteStrategy } from './types';

/**
 * binPack (D4.4): index order, only candidates with a system below its running limit Keff whose own
 * supply was below 90% last tick; equal shares. If none qualifies, as firstFit. Queues fill only
 * when every unit is at Keff, so the idle tail can sleep.
 */
export const binPacking: RouteStrategy = {
  id: 'binPack',
  weighted: false,
  plan(w, kind, _id, _r, cand, slot, weight, n) {
    return equal(weight, keepIf(cand, slot, n, (i) => supplyUsage(w, kind, cand[i]!) < POWER_LIMIT && hasRunRoom(w, kind, cand[i]!)));
  },
};
