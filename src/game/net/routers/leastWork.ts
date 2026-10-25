import { finishBelow } from '../finish';
import { summarized, summaryRank } from '../summary';
import { argmin, type RouteStrategy } from './types';

/**
 * leastWork: the lowest predicted finish (backlog / Keff + own est + transfer time); ties lowest slot.
 * Each candidate is scored below the best so far (finishBelow), which picks as exact scores would.
 * At site and global scope candidates rank by their maintained summary instead (D24, net/summary.ts).
 */
export const leastWork: RouteStrategy = {
  id: 'leastWork',
  choose(w, kind, _id, r, cand, _slot, n) {
    if (summarized(kind)) return argmin(n, (i) => summaryRank(w, kind, cand[i]!, r));
    let best = 0, bestScore = finishBelow(w, kind, cand[0]!, r, Infinity);
    for (let i = 1; i < n; i += 1) {
      const score = finishBelow(w, kind, cand[i]!, r, bestScore);
      if (score < bestScore) { best = i; bestScore = score; }
    }
    return best;
  },
};
