import type { Amount } from '../amount';
import type { RoundRewardBonuses } from '../types/roundRewards';

const memo = new WeakMap<readonly number[], RoundRewardBonuses>();
/** Values are totals derived from unique claimed IDs, never repeated or compounded. */
export function roundRewardBonuses(claimed: readonly number[]): RoundRewardBonuses {
  const hit = memo.get(claimed);
  if (hit) return hit;
  const has = (n: number) => claimed.includes(n);
  const result: RoundRewardBonuses = {
    preparedTargets: has(300) ? 4 : has(50) ? 2 : 1,
    dataPercent: has(1500) ? 20 : has(75) ? 10 : 0,
    researchSlots: has(750) ? 2 : has(100) ? 1 : 0,
    energyPercent: has(5000) ? 15 : has(2000) ? 10 : has(200) ? 5 : 0,
    researchDataPercent: has(7500) ? 20 : has(1000) ? 10 : 0,
    researchCreditPercent: has(3000) ? 10 : 0,
  };
  memo.set(claimed, result);
  return result;
}

/** Final whole-currency price, rounded up once; no nonzero price becomes free. */
export function discountedResearchCost(price: Amount | number, percent: number): Amount {
  const raw = BigInt(price);
  return ((raw * BigInt(100 - percent) + 99n) / 100n).toString() as Amount;
}
