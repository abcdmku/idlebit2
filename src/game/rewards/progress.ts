import type { Amount } from '../amount';
import { tierValue } from './ladder';
import type { RoundRewardsState } from '../types/roundRewards';
import type { World } from '../core/world';

export const FIRST_REWARD_TIER = 5;
export function initialRoundRewards(): RoundRewardsState {
  return { claimed: [], pending: [], receipts: [], highest: 0, round: 1, met: 0, nextTier: FIRST_REWARD_TIER,
    intervalCredits: '0' as Amount, intervalData: '0' as Amount, intervalDataMeter: 0,
    dataDividendRemainder: 0, energyDiscountRemainder: 0, grantedCredits: '0' as Amount, grantedData: '0' as Amount };
}

/** Each completed parent counts once. Large equal cohorts are split only at milestone boundaries. */
export function recordRewardWork(w: World, credits: bigint, count: number, dataRatio: number): void {
  const r = w.roundRewards;
  if (r.round !== w.round.index) {
    r.round = w.round.index; r.met = 0; r.nextTier = FIRST_REWARD_TIER;
    r.intervalCredits = '0' as Amount; r.intervalData = '0' as Amount; r.intervalDataMeter = 0;
  }
  while (count > 0) {
    const threshold = tierValue(r.nextTier);
    const take = Math.min(count, threshold - r.met);
    const earned = credits * BigInt(take);
    r.intervalCredits = (BigInt(r.intervalCredits) + earned).toString() as Amount;
    const data = r.intervalDataMeter + Number(earned) / dataRatio;
    const whole = Math.floor(data);
    r.intervalData = (BigInt(r.intervalData) + BigInt(whole)).toString() as Amount;
    r.intervalDataMeter = data - whole;
    r.met += take; count -= take;
    if (r.met !== threshold) continue;
    if (threshold > r.highest) {
      const floorCredits = BigInt(threshold) * 20n, floorData = BigInt(threshold) * 2n;
      const c = BigInt(r.intervalCredits), d = BigInt(r.intervalData);
      r.pending = [...r.pending, { milestone: threshold, round: w.round.index,
        credits: (c > floorCredits ? c : floorCredits).toString() as Amount,
        data: (d > floorData ? d : floorData).toString() as Amount }];
      r.highest = threshold;
    }
    r.nextTier += 1;
    r.intervalCredits = '0' as Amount; r.intervalData = '0' as Amount; r.intervalDataMeter = 0;
  }
}
