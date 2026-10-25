import { beginDecision } from '../routeMemo';
import { finish } from '../finish';
import { summarized, summaryRank } from '../summary';
import { sortBy, type RouteStrategy } from './types';

/**
 * leastWork: lowest predicted finish first (backlog / Keff + own est + transfer time). A child's
 * weight is the inverse of its predicted finish for the share, so faster and emptier children take
 * more and the chosen children's last shards finish close together. At site and global scope
 * candidates rank by their maintained summary (D24, net/summary.ts).
 */
export const leastWork: RouteStrategy = {
  id: 'leastWork',
  weighted: true,
  plan(w, kind, _id, r, cand, slot, weight, n) {
    beginDecision();
    const score = new Float64Array(n);
    for (let i = 0; i < n; i += 1) {
      score[i] = summarized(kind) ? summaryRank(w, kind, cand[i]!, r) : finish(w, kind, cand[i]!, r);
      weight[i] = Number.isFinite(score[i]!) ? 1 / Math.max(1e-9, score[i]!) : 1e-300;
    }
    sortBy(cand, slot, weight, n, (i) => score[i]!);
    return n;
  },
};
