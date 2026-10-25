import { DT_S } from '../../core/constants';
import type { World } from '../../core/world';
import { transferBits } from '../links';
import { finishBelow } from '../finish';
import { GLOBAL } from '../scope';
import { summarized, summaryRank } from '../summary';
import { argmin, type RouteStrategy } from './types';

/** latency(site): its backbone latency (0 at the gateway) plus the task's payload time over that link. */
export function siteLatency(w: World, site: number, r: number): number {
  const l = w.compiled.site.backboneLink[site]!;
  if (site === 0 || l < 0) return 0;
  const speed = w.compiled.link.speed[l]!;
  return w.compiled.link.latencyTicks[l]! * DT_S + (speed > 0 ? transferBits(w, r) / speed : Infinity);
}

/**
 * The finish bound under which lat + finish can still score below `best`: any finish ≥ it gives
 * fl(lat + finish) ≥ best (addition rounds monotonically). Infinity when nothing can be ruled out.
 */
function boundAfter(lat: number, best: number): number {
  if (!Number.isFinite(lat) || !Number.isFinite(best)) return Infinity;
  let b = best - lat;
  for (let i = 0; i < 4 && lat + b < best; i += 1) b += Math.abs(b) * 2.3e-16 + Number.MIN_VALUE;
  return lat + b < best ? Infinity : b;
}

/** latency (global): the lowest latency + finish. Below global it ranks by finish alone; at site and global scope finish is the D24 summary. */
export const latency: RouteStrategy = {
  id: 'latency',
  choose(w, kind, _id, r, cand, _slot, n) {
    const lat = (i: number) => (kind === GLOBAL ? siteLatency(w, cand[i]!, r) : 0);
    if (summarized(kind)) return argmin(n, (i) => lat(i) + summaryRank(w, kind, cand[i]!, r));
    let best = 0, bestScore = lat(0) + finishBelow(w, kind, cand[0]!, r, Infinity);
    for (let i = 1; i < n; i += 1) {
      const l = lat(i);
      const score = l + finishBelow(w, kind, cand[i]!, r, boundAfter(l, bestScore));
      if (score < bestScore) { best = i; bestScore = score; }
    }
    return best;
  },
};
