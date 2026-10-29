import type { Amount } from '../amount';

export interface RoundRewardGrant {
  readonly milestone: number;
  readonly round: number;
  readonly credits: Amount;
  readonly data: Amount;
}

/** Persistent first-reach rewards, separate from market payouts and research progress. */
export interface RoundRewardsState {
  readonly claimed: readonly number[];
  readonly pending: readonly RoundRewardGrant[];
  readonly receipts: readonly RoundRewardGrant[];
  readonly highest: number;
  readonly round: number;
  readonly met: number;
  readonly nextTier: number;
  readonly intervalCredits: Amount;
  readonly intervalData: Amount;
  readonly intervalDataMeter: number;
  readonly dataDividendRemainder: number;
  readonly energyDiscountRemainder: number;
  readonly grantedCredits: Amount;
  readonly grantedData: Amount;
}

export interface RoundRewardBonuses {
  readonly preparedTargets: number;
  readonly dataPercent: number;
  readonly researchSlots: number;
  readonly energyPercent: number;
  readonly researchDataPercent: number;
  readonly researchCreditPercent: number;
}

export interface RoundRewardDefinition {
  readonly milestone: number;
  readonly name: string;
  readonly summary: string;
  readonly icon: string;
  readonly effect: string;
  readonly limit: string;
  readonly research: string | null;
}

export interface RoundRewardView extends RoundRewardDefinition {
  readonly status: 'locked' | 'ready' | 'claimed';
  readonly credits: Amount;
  readonly data: Amount;
  readonly round: number | null;
}

export interface RoundRewardsView {
  readonly ready: number;
  readonly current: number;
  readonly best: number;
  readonly next: number;
  readonly rows: readonly RoundRewardView[];
}
