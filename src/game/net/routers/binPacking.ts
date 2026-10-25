import { POWER_LIMIT } from '../filters';
import { hasRunRoom, supplyUsage } from '../metrics';
import type { RouteStrategy } from './types';

/**
 * binPack (D4.4): the lowest-slot candidate that has a system with running + reserved below its
 * running limit Keff and whose own supply was below 90% last tick; otherwise as firstFit. Queues
 * fill only when every unit is at Keff, so the idle tail can sleep.
 */
export const binPacking: RouteStrategy = {
  id: 'binPack',
  choose(w, kind, _id, _r, cand, _slot, n) {
    for (let i = 0; i < n; i += 1) if (supplyUsage(w, kind, cand[i]!) < POWER_LIMIT && hasRunRoom(w, kind, cand[i]!)) return i;
    return 0;
  },
};
