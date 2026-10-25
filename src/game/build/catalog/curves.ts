import type { Curve } from '../../types/catalog';
import type { CatalogRow, LadderDef } from './types';
import { linkWatts, networkStepPrice as rawStepPrice, type NetworkLadderDef } from './network';

/**
 * Level, watt and price formulas shared by every catalog row (spec §9.1, §12.1, §12.3, §12.5,
 * post-D5). Prices are whole Credits as bigint; callers convert to Amount at the boundary.
 */

/** x^1.2: each flow level costs about 2.3× the last (program D5.6). */
export const LEVEL_PRICE_EXP = 1.2;
/** Extra-unit growth (spec §12.3, Appendix B). */
export const EXTRA_UNIT_GROWTH = 1.25;
export const EXTRA_CORE_GROWTH = 1.65;
export const ECC_PRICE_FACTOR = 1.25;
/** Rate parts idle at this share of their native rated draw (§9.1). */
export const IDLE_SHARE = 0.1;

/** The CSV progression (hardware-progression.md §2, §5): ×1.5 rate per level, ×1.7 price per level, 36 levels. */
export const STEP_RATE = 1.5;
export const STEP_LEVEL_MAX = 36;

export const levelFactor = (curve: Curve, level: number): number =>
  curve === 'flow' ? 2 ** (level - 1) : curve === 'step' ? STEP_RATE ** (level - 1) : curve === 'fixed' ? 1 : level;

/** Highest level of generation g (spec §12.1, A.5), plus a research bonus (rdimm, stacked3d). */
export const levelMax = (row: CatalogRow, g: number, bonus = 0): number =>
  (row.levelMax ?? (row.curve === 'step' ? STEP_LEVEL_MAX : row.curve === 'flow' ? 11 + g : row.curve === 'core' ? 8 + 2 * g : row.curve === 'linear' ? 8 + g : 1)) + bonus;

/** Primary capacity at (g, L): base[g] × x. */
export const capacity = (row: CatalogRow, g: number, level: number): number =>
  row.base[g]! * (row.capacityTable ? row.capacityTable[Math.min(row.capacityTable.length, Math.max(1, level)) - 1]! : levelFactor(row.curve, level));
/** Secondary capacity (RAM bandwidth, VRAM, IO rate, scheduler Q) scales by the same x. */
export const capacity2 = (row: CatalogRow, g: number, level: number): number => (row.base2?.[g] ?? 0) * levelFactor(row.curve, level);

/** RAM and drives are rated by bandwidth / IO (secondary); every other rate part by its primary capacity. */
export const ratedRate = (row: CatalogRow, g: number, level: number): number =>
  row.id === 'ram' || row.id === 'storage' ? capacity2(row, g, level) : capacity(row, g, level);

export interface Watts { readonly idle: number; readonly load: number }
const NONE: Watts = { idle: 0, load: 0 };

/** §9.1 rate-part rule: push = max(1, rate / native); idle = 0.1 × w × native × push^0.25; load = w × rate × push^0.3. */
export function rateWatts(wPerUnit: number, native: number, rate: number): Watts {
  if (!(native > 0)) return NONE;
  const push = Math.max(1, rate / native);
  return { idle: IDLE_SHARE * wPerUnit * native * push ** 0.25, load: wPerUnit * rate * push ** 0.3 };
}

/** Energy eras (hardware-progression.md §3): native ratio and per-level retention, Hz, kHz, MHz, GHz. */
export const NATIVE_RATIO: readonly number[] = [10, 6, 3, 2];
export const RATIO_DECAY: readonly number[] = [0.92, 0.93, 0.95, 0.9625];
/** The fixed normalization price of the energy ratio, Credits per joule. */
export const RATIO_REFERENCE_PRICE = 0.01;

/** Energy ratio E of a part running at `rate` against its native rate, in energy era `era` (with an optional per-part decay table). */
export function energyRatio(era: number, native: number, rate: number, decay: readonly number[] = RATIO_DECAY): number {
  const push = Math.max(1, rate / native);
  return NATIVE_RATIO[era]! / push ** (-Math.log(decay[era]!) / Math.log(STEP_RATE));
}

/** hardware-progression.md §3: full-use W = rate / (0.010 × E); idle = 0.1 × min(native full W × push^0.25, full W). */
export function ratioWatts(era: number, native: number, rate: number, decay: readonly number[] = RATIO_DECAY): Watts {
  if (!(native > 0) || !(rate > 0)) return NONE;
  const push = Math.max(1, rate / native);
  const fullW = rate / (RATIO_REFERENCE_PRICE * energyRatio(era, native, rate, decay));
  const idle = IDLE_SHARE * Math.min((native / (RATIO_REFERENCE_PRICE * NATIVE_RATIO[era]!)) * push ** 0.25, fullW);
  return { idle, load: fullW - idle };
}

/** Idle and full-use load watts of one part at (g, L). Cores pass their own rate (lanes × clock) and native. */
export function partWatts(row: CatalogRow, g: number, level: number, rate?: { rate: number; native: number }): Watts {
  const w = row.watts;
  const x = levelFactor(row.curve, level);
  switch (w.kind) {
    case 'ratio': {
      const era = w.era[g] ?? 0;
      return rate ? ratioWatts(era, rate.native, rate.rate, w.decay) : ratioWatts(era, ratedRate(row, g, 1), ratedRate(row, g, level), w.decay);
    }
    case 'idle': return { idle: (w.idle[g] ?? 0) * x ** 0.25, load: 0 };
    case 'cooler': {
      const qc = row.base[g]! * (w.wpw[g] ?? 0);
      return { idle: 0.1 * qc * x ** 0.25, load: qc * x ** 1.5 };
    }
    case 'supply': return NONE;
    case 'rate': return rate ? rateWatts(w.wPerUnit, rate.native, rate.rate) : rateWatts(w.wPerUnit, ratedRate(row, g, 1), ratedRate(row, g, level));
  }
}

/** Supply loss fraction: loss[g] + lossPerLevel × (L − 1) (spec §9.2). 0 for non-supplies. */
export const lossFraction = (row: CatalogRow, g: number, level: number): number =>
  row.watts.kind === 'supply' ? (row.watts.loss[g] ?? 0) + row.watts.lossPerLevel * (level - 1) : 0;

/** Rounds a positive price up to a whole Credit. 15 significant digits strip float noise first. */
export const ceilCredits = (value: number): bigint => {
  if (!(value > 0)) return 0n;
  return BigInt(Math.ceil(Number(value.toPrecision(15))));
};

export const installPrice = (row: CatalogRow, g: number): bigint => ceilCredits(row.price[g] ?? 0);
/** Price of L → L + 1 within generation g. `lanes` = lanes driven, for a clock (spec §12.3). */
export const upgradePrice = (row: CatalogRow, g: number, level: number, lanes = 1): bigint => {
  const drive = row.upgradeDrive === 'lanes' ? lanes : 1;
  if (row.curve === 'step') return stepPrice(row.upgrade[g] ?? 0, level, drive);
  return ceilCredits((row.upgrade[g] ?? 0) * levelFactor(row.curve, level) ** LEVEL_PRICE_EXP * drive);
};
/** CSV step price, exact (hardware-progression.md §5): ceil(base × 1.7^(L − 1) × drive), in whole Credits. */
function stepPrice(base: number, level: number, drive: number): bigint {
  if (!(base > 0) || !(drive > 0)) return 0n;
  const p = BigInt(Math.max(0, level - 1)), den = 10n ** p;
  const num = BigInt(Math.round(base)) * 17n ** p * BigInt(Math.round(drive));
  return (num + den - 1n) / den;
}
/** Sum of upgrades from `from` to `to`. */
export const upgradesBetween = (row: CatalogRow, g: number, from: number, to: number, lanes = 1): bigint => {
  let total = 0n;
  for (let l = from; l < to; l += 1) total += upgradePrice(row, g, l, lanes);
  return total;
};
/** Install plus every upgrade up to `level` (spec §13.3). */
export const priceToLevel = (row: CatalogRow, g: number, level: number, lanes = 1): bigint =>
  installPrice(row, g) + upgradesBetween(row, g, 1, level, lanes);
/** Scales a whole price by a factor, rounding up. */
export const scalePrice = (price: bigint, factor: number): bigint => (factor === 1 ? price : ceilCredits(Number(price) * factor));

/* ---------- Ladders (spec §7.3, §12.5) ---------- */

export const ladderSpeed = (k: number): number => [1, 2, 5][k % 3]! * 10 ** (3 + Math.floor(k / 3));
/** xp = speed(k) / speed(baseK[g]). */
export const portX = (row: LadderDef, g: number, k: number): number => ladderSpeed(k) / ladderSpeed(row.baseK[g]!);
/** Watts of one port or uplink at rung k (D18.5); the generation sets only the rung range. */
export const portWatts = (row: LadderDef, _g: number, k: number): Watts => linkWatts(row.wPerUnit, ladderSpeed(k));
export const ladderInstall = (row: LadderDef, g: number): bigint => ceilCredits(row.price[g] ?? 0);
/*
 * Port-step prices are pure in (row, k, uplink, zones) but cost two 80-digit Decimal powers each,
 * and a tray re-asks them every frame. The same values are memoized here, per row object.
 */
const stepMemo = new WeakMap<NetworkLadderDef, Map<number, bigint>>();
/** One port/uplink step (network.ts `networkStepPrice`), memoized. */
export function networkStepPrice(row: NetworkLadderDef, k: number, uplink = false, zones = 1): bigint {
  let memo = stepMemo.get(row);
  if (!memo) stepMemo.set(row, (memo = new Map()));
  // k and zones are validated whole numbers in rawStepPrice; anything else misses and throws there.
  const key = Number.isSafeInteger(k) && k >= 0 && Number.isSafeInteger(zones) && zones >= 1 && zones < 1024
    ? (k * 1024 + zones) * 2 + (uplink ? 1 : 0) : NaN;
  const hit = memo.get(key);
  if (hit !== undefined) return hit;
  const price = rawStepPrice(row, k, uplink, zones);
  if (key === key) memo.set(key, price);
  return price;
}
/** Sum of the individually rounded steps from fromK to toK (network.ts `networkStepsBetween`), memoized steps. */
export function networkStepsBetween(row: NetworkLadderDef, fromK: number, toK: number, uplink = false, zones = 1): bigint {
  let total = 0n;
  for (let k = fromK; k < toK; k += 1) total += networkStepPrice(row, k, uplink, zones);
  return total;
}
/** The j-th port beyond minPorts (j ≥ 1). Uplinks beyond the first cost like a port. */
export const portAddPrice = (row: LadderDef, g: number, j: number): bigint =>
  ceilCredits((row.portAdd?.[g] ?? 0) * (row.portAddGrowth ?? 1) ** (j - 1));
