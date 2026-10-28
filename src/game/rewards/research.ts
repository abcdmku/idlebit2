import { amount } from '../amount';
import { researchId } from '../types/ids';
import type { ResearchDef } from '../types/catalog';
import type { RoundRewardsState } from '../types/roundRewards';
import { discountedResearchCost, roundRewardBonuses } from './bonuses';

function blueprint(id: string, name: string, milestone: number, requires: string[], data: number, work: number, effect: string, summary: string): ResearchDef {
  return { id: researchId(id), name, rewardMilestone: milestone, requires: requires.map(researchId),
    category: 'compute', level: 'chip', era: 'hz', tier: milestone === 50 ? 2 : milestone === 150 ? 3 : 5,
    data, creditCost: amount((BigInt(data) * 10n).toString()), work, effects: [], effect, summary,
    answers: ['threads', 'pickup'], implemented: true };
}

export const REWARD_RESEARCH: readonly ResearchDef[] = [
  blueprint('parallelLoaders', 'Parallel cache loaders', 50, ['sjf'], 100, 600,
    'Load two queued tasks at once, using one separate idle physical core per loader. Each cache bit costs one CPU operation. Cache and queue capacity still apply.', 'Up to 2 real cache loaders.'),
  blueprint('residentWorkspace', 'Resident batch cache', 150, ['parallelLoaders'], 2500, 5000,
    'Keep one recipe’s reusable fixed workspace in installed cache across intervening tasks. Private inputs are never shared. Reclaim it before it blocks execution.', 'Retain 1 fixed recipe workspace.'),
  blueprint('parallelLoaderController', 'Parallel loader controller', 500, ['parallelLoaders'], 8000, 300000,
    'Raise the selectable loader budget to four idle physical cores. Every loader still consumes CPU work and real cache; it creates no extra hardware.', 'Up to 4 real cache loaders.'),
];

/** Purchase-series nodes keep their prices. Only new, funded processor research gets the contract. */
export function researchCosts(def: ResearchDef, rewards: Pick<RoundRewardsState, 'claimed'>) {
  const bonus = roundRewardBonuses(rewards.claimed);
  return {
    credits: discountedResearchCost(def.creditCost, def.purchase ? 0 : bonus.researchCreditPercent),
    data: discountedResearchCost(def.data, def.purchase ? 0 : bonus.researchDataPercent),
  };
}
