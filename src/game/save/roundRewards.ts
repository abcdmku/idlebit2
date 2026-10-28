import type { GameState } from '../types/state';
import { tierOf, tierValue } from '../rewards/ladder';
import { FIRST_REWARD_TIER } from '../rewards/progress';

type Fail = (path: string, message: string) => never;
type Obj = Record<string, unknown>;
export function validateRoundRewards(state: GameState, fail: Fail): void {
  const raw = state.roundRewards as unknown;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('roundRewards', 'expected an object');
  const r = raw as Obj;
  const integer = (value: unknown, path: string, min = 0) => {
    if (!Number.isSafeInteger(value) || (value as number) < min) fail(path, 'expected a nonnegative safe integer');
    return value as number;
  };
  const whole = (value: unknown, path: string) => {
    if (typeof value !== 'string' || !/^(0|[1-9]\d*)$/.test(value)) fail(path, 'expected a nonnegative whole Amount');
    return BigInt(value as string);
  };
  const milestone = (value: unknown, path: string) => {
    const n = integer(value, path, 50);
    if (tierValue(tierOf(n)) !== n) fail(path, 'not a task-count milestone');
    return n;
  };
  const highest = integer(r.highest, 'roundRewards.highest');
  if (highest !== 0) milestone(highest, 'roundRewards.highest');
  if (integer(r.round, 'roundRewards.round', 1) > state.round.index) fail('roundRewards.round', 'ahead of current round');
  const met = integer(r.met, 'roundRewards.met');
  const next = integer(r.nextTier, 'roundRewards.nextTier', FIRST_REWARD_TIER);
  if (met >= tierValue(next) || next > FIRST_REWARD_TIER && met < tierValue(next - 1)) fail('roundRewards.nextTier', 'does not bracket completed tasks');
  for (const key of ['intervalCredits', 'intervalData', 'grantedCredits', 'grantedData']) whole(r[key], `roundRewards.${key}`);
  if (typeof r.intervalDataMeter !== 'number' || !Number.isFinite(r.intervalDataMeter) || r.intervalDataMeter < 0 || r.intervalDataMeter >= 1)
    fail('roundRewards.intervalDataMeter', 'expected a fractional meter');
  for (const key of ['dataDividendRemainder', 'energyDiscountRemainder']) if (integer(r[key], `roundRewards.${key}`) >= 100)
    fail(`roundRewards.${key}`, 'expected a percentage remainder below 100');
  if (!Array.isArray(r.claimed) || !Array.isArray(r.pending) || !Array.isArray(r.receipts)) fail('roundRewards', 'expected reward arrays');
  const receipts = r.receipts as unknown[];
  const receiptIds = new Set<number>();
  let paidCredits = 0n, paidData = 0n;
  for (const value of receipts) {
    if (!value || typeof value !== 'object') fail('roundRewards.receipts', 'expected a receipt');
    const grant = value as Obj, n = milestone(grant.milestone, 'roundRewards.receipts.milestone');
    if (receiptIds.has(n) || !(r.claimed as unknown[]).includes(n)) fail('roundRewards.receipts', 'duplicate or unclaimed receipt');
    if (integer(grant.round, 'roundRewards.receipts.round', 1) > state.round.index) fail('roundRewards.receipts.round', 'ahead of current round');
    if (whole(grant.credits, 'roundRewards.receipts.credits') < BigInt(n) * 20n
      || whole(grant.data, 'roundRewards.receipts.data') < BigInt(n) * 2n) fail('roundRewards.receipts', 'below guaranteed grant');
    receiptIds.add(n);
    paidCredits += whole(grant.credits, 'roundRewards.receipts.credits'); paidData += whole(grant.data, 'roundRewards.receipts.data');
  }
  if (receiptIds.size !== (r.claimed as unknown[]).length || paidCredits !== BigInt(r.grantedCredits as string) || paidData !== BigInt(r.grantedData as string))
    fail('roundRewards.receipts', 'claim totals do not match receipts');
  const seen = new Set<number>();
  for (const value of r.claimed as unknown[]) {
    const n = milestone(value, 'roundRewards.claimed');
    if (seen.has(n) || n > highest) fail('roundRewards.claimed', 'duplicate or unearned reward');
    seen.add(n);
  }
  for (const value of r.pending as unknown[]) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail('roundRewards.pending', 'expected a grant');
    const grant = value as Obj, n = milestone(grant.milestone, 'roundRewards.pending.milestone');
    if (seen.has(n) || n > highest) fail('roundRewards.pending', 'duplicate or unearned reward');
    seen.add(n);
    if (integer(grant.round, 'roundRewards.pending.round', 1) > state.round.index) fail('roundRewards.pending.round', 'ahead of current round');
    if (whole(grant.credits, 'roundRewards.pending.credits') < BigInt(n) * 20n
      || whole(grant.data, 'roundRewards.pending.data') < BigInt(n) * 2n) fail('roundRewards.pending', 'below guaranteed grant');
  }
  for (let i = FIRST_REWARD_TIER; tierValue(i) <= highest; i++) if (!seen.has(tierValue(i)))
    fail('roundRewards', 'an earned reward is missing');
}
