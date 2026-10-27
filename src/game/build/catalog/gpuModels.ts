import type {
  GpuGeneration, GpuModelDefinition, GpuModelId, GpuSeries, GpuStats, GpuTechnology, GpuTier,
} from '../../types/gpu';

const GENERATIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;
const SERIES = [3, 5, 7, 9] as const;
const TIERS = [30, 50, 60, 70, 80, 90] as const;
const TIER_PRICES = [1n, 3n, 7n, 16n, 36n, 80n] as const;

/** D8: home-price gross/energy targets 6/3/2 per era. Tiers raise efficiency; there is no push penalty. */
export interface GpuEnergyCalibration {
  readonly baseW: number;
  readonly eraScale: readonly [number, number, number];
}
export const GPU_ENERGY: GpuEnergyCalibration = Object.freeze({
  baseW: 18,
  eraScale: [1, 2, 3] as const,
});

/** Technology is supplied by the caller, including generation-specific tensor eligibility. */
function technologyFactor(value: number | undefined, name: keyof GpuTechnology): number {
  if (value === undefined) return 1;
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`Invalid GPU ${name}: ${value}`);
  return value;
}

/**
 * A card is generation, type (series) and tier. The tier is its upgrade state: each step doubles cores and VRAM,
 * raises the clock and improves joules per op, so an upgrade never makes a card worse.
 */
function stats(
  generation: GpuGeneration, series: GpuSeries, tier: GpuTier,
  technology: Partial<GpuTechnology>, energy: GpuEnergyCalibration = GPU_ENERGY,
): GpuStats {
  const k = TIERS.indexOf(tier);
  const capacity = 2 ** k;
  const cores = 2 ** (generation - 1) * (series === 3 || series === 9 ? 4 : 1) * capacity;
  const vramBits = 2 ** (13 + 4 * (generation - 1)) * (series === 5 || series === 9 ? 4 : 1)
    * capacity * technologyFactor(technology.vramMultiplier, 'vramMultiplier');
  const clockHz = 10 ** (generation + 2) * (series === 7 || series === 9 ? 2 : 1) * (10 + k) / 10;
  const opsPerS = cores * clockHz;
  const tensorOpsPerS = opsPerS * technologyFactor(technology.tensorFactor, 'tensorFactor');
  const era = Math.floor((generation - 1) / 3);
  const coefficient = energy.baseW * energy.eraScale[era]!
    * (series === 9 ? 0.88 : series === 7 ? 0.96 : 1) * 100 / (100 + k);
  const idleHalf = 0.05 * coefficient * opsPerS;
  const idleW = idleHalf * (1 + technologyFactor(technology.hbmIdleFactor, 'hbmIdleFactor'));
  const loadW = coefficient * opsPerS;
  const efficiencyOpsPerJ = opsPerS / (idleW + loadW);
  if (![vramBits, tensorOpsPerS, idleW, efficiencyOpsPerJ].every((n) => Number.isFinite(n) && n > 0)) {
    throw new RangeError('GPU technology produces non-finite or non-positive specifications');
  }
  return {
    model: `${generation}${series}${tier}`, generation, series, tier, tierIndex: k, maxTierIndex: TIERS.length - 1,
    cores, vramBits, clockHz, opsPerS, tensorOpsPerS, idleW, loadW, efficiencyOpsPerJ,
  };
}

const MODELS = new Map<string, GpuModelDefinition>();
for (const generation of GENERATIONS) for (const series of SERIES) for (const tier of TIERS) {
  const native = Object.freeze(stats(generation, series, tier, {}));
  MODELS.set(native.model, native);
}

/** All 216 model IDs, ordered by generation, series, then tier. */
export const GPU_MODEL_IDS: readonly GpuModelId[] = Object.freeze(
  [...MODELS.values()].map((native) => native.model),
);

export function gpuModel(model: string): GpuModelDefinition | null {
  return MODELS.get(model) ?? null;
}

function requireModel(model: GpuModelId): GpuModelDefinition {
  const native = gpuModel(model);
  if (!native) throw new RangeError(`Unknown GPU model: ${model}`);
  return native;
}

export function evaluateGpu(
  model: GpuModelId, technology: Partial<GpuTechnology> = {}, energy: GpuEnergyCalibration = GPU_ENERGY,
): GpuStats {
  const native = requireModel(model);
  return stats(native.generation, native.series, native.tier, technology, energy);
}

/** The same card one tier up (tier-up is hot), or null at tier 90. */
export function gpuNextTier(model: GpuModelId): GpuModelId | null {
  const native = requireModel(model);
  const k = TIERS.indexOf(native.tier);
  return k + 1 < TIERS.length ? `${native.generation}${native.series}${TIERS[k + 1]!}` : null;
}

/** The same type and tier in a later generation (a cold replace), or null past generation 9. */
export function gpuAtGeneration(model: GpuModelId, generation: number): GpuModelId | null {
  const native = requireModel(model);
  if (!Number.isInteger(generation) || generation <= native.generation || generation > 9) return null;
  return `${generation as GpuGeneration}${native.series}${native.tier}`;
}

/**
 * Generation 1 is the System-era entry card (balance, 25 Oct): 1,000,000 Credits, about half an hour of
 * System-era net income, so the first GPU answers its wall instead of a two-hour save. Later generations keep 4e6 × 10^(g−1).
 */
const genBase = (generation: number): bigint => (generation === 1 ? 1_000_000n : 4_000_000n * 10n ** BigInt(generation - 1));

function nativePrice(native: GpuModelDefinition): bigint {
  return genBase(native.generation) * (native.series === 9 ? 4n : 1n)
    * TIER_PRICES[TIERS.indexOf(native.tier)];
}

function ceilDiv(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator - 1n) / denominator;
}

/** A card's value: its price as the first or second GPU in a system. */
export function gpuNativePrice(model: GpuModelId): bigint {
  return nativePrice(requireModel(model));
}

/** Extra-card escalation: with n other GPUs, ×(5/4)^max(0, n − 1). NPUs and the card itself never count. */
function escalate(price: bigint, otherGpuCount: number): bigint {
  if (!Number.isSafeInteger(otherGpuCount) || otherGpuCount < 0) {
    throw new RangeError(`GPU count must be a nonnegative safe integer: ${otherGpuCount}`);
  }
  const exponent = BigInt(Math.max(0, otherGpuCount - 1));
  return ceilDiv(price * 5n ** exponent, 4n ** exponent);
}

/** Count only other GPUs, excluding NPUs and the card being replaced. */
export function gpuInstallPrice(model: GpuModelId, otherGpuCount: number): bigint {
  return escalate(gpuNativePrice(model), otherGpuCount);
}

/**
 * Upgrading a card (a tier up, or the next generation at the same type and tier) costs the difference in value,
 * at the card's escalation: earlier steps are never thrown away, and the total paid for a card is the same
 * whichever way it got to its model.
 */
export function gpuStepPrice(from: GpuModelId, to: GpuModelId, otherGpuCount: number): bigint {
  const gain = gpuNativePrice(to) - gpuNativePrice(from);
  if (gain <= 0n) throw new RangeError(`GPU ${to} is not worth more than ${from}`);
  // Difference of whole card values telescopes exactly, including escalation's rounding.
  return gpuInstallPrice(to, otherGpuCount) - gpuInstallPrice(from, otherGpuCount);
}

/**
 * A type change keeps generation and tier (a cold swap). It costs any rise in card value at the card's escalation,
 * and nothing when the value stays or falls: there is no refund, and nothing already paid is lost.
 */
export function gpuTypeChangePrice(from: GpuModelId, to: GpuModelId, otherGpuCount: number): bigint {
  const gain = gpuInstallPrice(to, otherGpuCount) - gpuInstallPrice(from, otherGpuCount);
  return gain > 0n ? gain : 0n;
}

/** The same generation and tier as another type, or null when it is the same type. */
export function gpuAsType(model: GpuModelId, series: GpuSeries): GpuModelId | null {
  const native = requireModel(model);
  return native.series === series ? null : `${native.generation}${series}${native.tier}`;
}

/** The same generation and type at tier index 0 … 5, or null outside the ladder. */
export function gpuAtTierIndex(model: GpuModelId, tierIndex: number): GpuModelId | null {
  const native = requireModel(model);
  const tier = TIERS[tierIndex];
  return Number.isInteger(tierIndex) && tier !== undefined ? `${native.generation}${native.series}${tier}` : null;
}
