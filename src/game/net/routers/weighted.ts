import { MAX_ZONES_PER_SITE, RACKS_PER_ROOM, SERVERS_PER_RACK } from '../../core/constants';
import { conns, rated } from '../metrics';
import { RACK, ROOM, SITE } from '../scope';
import { argmin, type RouteStrategy } from './types';

/**
 * weighted: smooth weighted round robin by rated ops/s. Each candidate adds its weight to its
 * counter, the highest counter wins (ties lowest slot), and the pick gives back the total weight
 * of the candidates. Counters are hot state per router. The global scheduler has no counter
 * column yet (R23): it picks the lowest (conns + 1) / rated, which tends to the same proportions.
 */
export const weighted: RouteStrategy = {
  id: 'weighted',
  choose(w, kind, id, _r, cand, slot, n) {
    const h = w.hot;
    const counters = kind === RACK ? h.rack.wrr : kind === ROOM ? h.room.wrr : kind === SITE ? h.site.wrr : null;
    if (!counters) return argmin(n, (i) => (conns(w, kind, cand[i]!) + 1) / Math.max(1e-300, rated(w, kind, cand[i]!)));
    const stride = kind === RACK ? SERVERS_PER_RACK : kind === ROOM ? RACKS_PER_ROOM : MAX_ZONES_PER_SITE;
    let total = 0, best = 0, bestCounter = -Infinity;
    for (let i = 0; i < n; i += 1) {
      const weight = rated(w, kind, cand[i]!);
      const k = id * stride + slot[i]!;
      counters[k] = counters[k]! + weight;
      total += weight;
      if (counters[k]! > bestCounter) { best = i; bestCounter = counters[k]!; }
    }
    const k = id * stride + slot[best]!;
    counters[k] = counters[k]! - total;
    return best;
  },
};
