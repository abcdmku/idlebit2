/** Barebones tiers on the configuration plate: CPU generation g (spec §13.2). */
export const TIER_NAMES = ['Hz', 'kHz', 'MHz', 'GHz'] as const;
export const TIER_COUNT = TIER_NAMES.length;
export const tierName = (tier: number): string => TIER_NAMES[tier] ?? `Gen ${tier}`;
