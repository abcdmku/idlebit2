import { amount } from '../amount';
import { G } from '../core/buffers';
import { roundRewardDefinition } from '../rewards/catalog';
import { FIRST_REWARD_TIER } from '../rewards/progress';
import { tierOf, tierValue } from '../rewards/ladder';
import type { GameState } from '../types/state';
import type { RoundRewardsView } from '../types/roundRewards';

/** Frozen pending grants, owned perks and the next endless task-count rungs. No simulated earnings. */
export function selectRoundRewards(state: GameState): RoundRewardsView {
  const r = state.roundRewards, current = state.hot.g[G.met] ?? 0;
  const maxTier = Math.max(18, tierOf(r.highest) + 2), rows: RoundRewardsView['rows'][number][] = [];
  for (let tier = FIRST_REWARD_TIER; tier <= maxTier; tier++) {
    const milestone = tierValue(tier), grant = r.pending.find(row => row.milestone === milestone) ?? r.receipts.find(row => row.milestone === milestone);
    rows.push({ ...roundRewardDefinition(milestone), status: r.claimed.includes(milestone) ? 'claimed' : grant ? 'ready' : 'locked',
      credits: grant?.credits ?? amount((BigInt(milestone) * 20n).toString()),
      data: grant?.data ?? amount((BigInt(milestone) * 2n).toString()), round: grant?.round ?? null });
  }
  return { ready: r.pending.length, current, best: Math.max(current, state.round.frontier.bestMet),
    next: tierValue(Math.max(FIRST_REWARD_TIER - 1, tierOf(r.highest)) + 1), rows };
}
