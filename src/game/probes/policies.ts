/**
 * Balance bot policies (architecture §6, program §14). A policy is data: how often the player looks
 * at the game and what it is willing to do. The bot (bot.ts) turns it into public actions.
 */
export type PolicyId = 'active' | 'idle' | 'passive';

export interface Policy {
  readonly id: PolicyId;
  /** Ticks between decisions. 20 = every 2 s of sim time. */
  readonly cadenceTicks: number;
  /** Buy parts and units. */
  readonly buys: boolean;
  /** Start research when none is running. */
  readonly researches: boolean;
  /** Purchases per decision, at most. */
  readonly maxBuysPerDecision: number;
  /** Fraction of the wallet kept for the cheapest locked-out structural step (0 = spend it all). */
  readonly saveFraction: number;
}

export const POLICIES: Readonly<Record<PolicyId, Policy>> = {
  /** Program §14's "active player who buys the sensible thing when they can afford it". */
  active: { id: 'active', cadenceTicks: 20, buys: true, researches: true, maxBuysPerDecision: 8, saveFraction: 0 },
  /** Checks in every 10 minutes, then lets the machine run. */
  idle: { id: 'idle', cadenceTicks: 6_000, buys: true, researches: true, maxBuysPerDecision: 32, saveFraction: 0 },
  /** Never buys or researches (D20: round 1 ends in about a minute without upgrades). */
  passive: { id: 'passive', cadenceTicks: 20, buys: false, researches: false, maxBuysPerDecision: 0, saveFraction: 0 },
};
