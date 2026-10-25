import type {
  GpuGeneration, GpuModelDefinition, GpuModelId, GpuSeries, GpuStats, GpuTechnology, GpuTier,
} from '../../types/gpu';

const GENERATIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;
const SERIES = [3, 5, 7, 9] as const;
const TIERS = [30, 50, 60, 70, 80, 90] as const;
const TIER_PRICES = [1n, 3n, 7n, 16n, 36n, 80n] as const;
const MAX_UPGRADES = 5;

/** D8: home-price gross/energy targets 6/3/2, with every u5 card near break-even. */
export interface GpuEnergyCalibration {
  readonly baseW: number;
  readonly eraScale: readonly [number, number, number];
  readonly pushExponent: readonly [number, number, number];
}
export const GPU_ENERGY: GpuEnergyCalibration = Object.freeze({
  baseW: 18,
  eraScale: [1, 2, 3] as const,
  pushExponent: [0.36, 0.21, 0.12] as const,
});

/** Technology is supplied by the caller, including generation-specific tensor eligibility. */
function technologyFactor(value: number | undefined, name: keyof GpuTechnology): number {
  if (value === undefined) return 1;
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`Invalid GPU ${name}: ${value}`);
  return value;
}

function stats(
  generation: GpuGeneration, series: GpuSeries, tier: GpuTier, upgrades: number,
  technology: Partial<GpuTechnology>, energy: GpuEnergyCalibration = GPU_ENERGY,
): GpuStats {
  const k = TIERS.indexOf(tier);
  const capacity = 2 ** (k + upgrades);
  const cores = 2 ** (generation - 1) * (series === 3 || series === 9 ? 4 : 1) * capacity;
  const vramBits = 2 ** (13 + 4 * (generation - 1)) * (series === 5 || series === 9 ? 4 : 1)
    * capacity * technologyFactor(technology.vramMultiplier, 'vramMultiplier');
  const clockHz = 10 ** (generation + 2) * (series === 7 || series === 9 ? 2 : 1)
    * (10 + k) / 10 * (5 / 4) ** upgrades;
  const opsPerS = cores * clockHz;
  const tensorOpsPerS = opsPerS * technologyFactor(technology.tensorFactor, 'tensorFactor');
  const push = (5 / 2) ** upgrades;
  const nativeOpsPerS = opsPerS / push;
  const era = Math.floor((generation - 1) / 3);
  const coefficient = energy.baseW * energy.eraScale[era]!
    * (series === 9 ? 0.88 : series === 7 ? 0.96 : 1) * 100 / (100 + k);
  const idleHalf = 0.05 * coefficient * nativeOpsPerS * push ** 0.25;
  const idleW = idleHalf * (1 + technologyFactor(technology.hbmIdleFactor, 'hbmIdleFactor'));
  const loadW = coefficient * opsPerS * push ** energy.pushExponent[era]!;
  const efficiencyOpsPerJ = opsPerS / (idleW + loadW);
  if (![vramBits, tensorOpsPerS, idleW, efficiencyOpsPerJ].every((n) => Number.isFinite(n) && n > 0)) {
    throw new RangeError('GPU technology produces non-finite or non-positive specifications');
  }
  return {
    model: `${generation}${series}${tier}`, generation, series, tier, upgrades,
    cores, vramBits, clockHz, opsPerS, tensorOpsPerS, idleW, loadW, efficiencyOpsPerJ,
    maxUpgrades: MAX_UPGRADES,
  };
}

const MODELS = new Map<string, GpuModelDefinition>();
for (const generation of GENERATIONS) for (const series of SERIES) for (const tier of TIERS) {
  const native = Object.freeze(stats(generation, series, tier, 0, {}));
  MODELS.set(native.model, native);
}

/** All 216 native model IDs, ordered by generation, series, then tier. */
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

function requireUpgrades(upgrades: number, max: number): void {
  if (!Number.isInteger(upgrades) || upgrades < 0 || upgrades > max) {
    throw new RangeError(`GPU upgrades must be an integer from 0 to ${max}: ${upgrades}`);
  }
}

export function evaluateGpu(
  model: GpuModelId, upgrades: number, technology: Partial<GpuTechnology> = {},
  energy: GpuEnergyCalibration = GPU_ENERGY,
): GpuStats {
  const native = requireModel(model);
  requireUpgrades(upgrades, MAX_UPGRADES);
  return stats(native.generation, native.series, native.tier, upgrades, technology, energy);
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

export function gpuNativePrice(model: GpuModelId): bigint {
  return nativePrice(requireModel(model));
}

/** Price of the next hot upgrade; an already capped card has no next quote. */
export function gpuUpgradePrice(model: GpuModelId, upgradesAlreadyApplied: number): bigint {
  const price = gpuNativePrice(model);
  requireUpgrades(upgradesAlreadyApplied, MAX_UPGRADES - 1);
  return ceilDiv(price * 3n ** BigInt(upgradesAlreadyApplied), 10n);
}

/** Full card cost at a push count, before native-install escalation. */
export function gpuPriceToLevel(model: GpuModelId, upgrades: number): bigint {
  const price = gpuNativePrice(model);
  requireUpgrades(upgrades, MAX_UPGRADES);
  let total = price;
  for (let u = 0; u < upgrades; u++) total += ceilDiv(price * 3n ** BigInt(u), 10n);
  return total;
}

/** Count only other GPUs, excluding NPUs and the card being replaced. */
export function gpuInstallPrice(model: GpuModelId, otherGpuCount: number): bigint {
  const price = gpuNativePrice(model);
  if (!Number.isSafeInteger(otherGpuCount) || otherGpuCount < 0) {
    throw new RangeError(`GPU count must be a nonnegative safe integer: ${otherGpuCount}`);
  }
  const exponent = BigInt(Math.max(0, otherGpuCount - 1));
  return ceilDiv(price * 5n ** exponent, 4n ** exponent);
}
