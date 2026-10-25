import { DT_S } from '../../core/constants';
import type { World } from '../../core/world';
import { transferBits } from '../links';
import { finish } from '../finish';
import { GLOBAL } from '../scope';
import { summarized, summaryRank } from '../summary';
import { equal, sortBy, type RouteStrategy } from './types';

/** latency(site): its backbone latency (0 at the gateway) plus the entry's payload time over that link. */
export function siteLatency(w: World, site: number, r: number): number {
  const l = w.compiled.site.backboneLink[site]!;
  if (site === 0 || l < 0) return 0;
  const speed = w.compiled.link.speed[l]!;
  return w.compiled.link.latencyTicks[l]! * DT_S + (speed > 0 ? transferBits(w, r) / speed : Infinity);
}

/**
 * latency (global): sites in order of latency + finish (ties index); the split gives the whole
 * entry to the first, and a minimum split it can't hold spills to the next. Below global, firstFit.
 */
export const latency: RouteStrategy = {
  id: 'latency',
  weighted: false,
  plan(w, kind, _id, r, cand, slot, weight, n) {
    equal(weight, n);
    if (kind !== GLOBAL) return n;
    const score = Array.from({ length: n }, (_, i) =>
      siteLatency(w, cand[i]!, r) + (summarized(kind) ? summaryRank(w, kind, cand[i]!, r) : finish(w, kind, cand[i]!, r)));
    sortBy(cand, slot, weight, n, (i) => score[i]!);
    return n;
  },
};

/** Global strategies that place a whole entry in one site (spec §8.3): the split keeps one candidate. */
export const SINGLE_SITE: ReadonlySet<string> = new Set(['latency', 'price']);
