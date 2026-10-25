import { describe, expect, it } from 'vitest';
import type { GpuGeneration, GpuModelId, GpuSeries, GpuTechnology, GpuTier } from '../../types/gpu';
import {
  GPU_MODEL_IDS, evaluateGpu, gpuInstallPrice, gpuModel, gpuNativePrice, gpuPriceToLevel, gpuUpgradePrice,
} from './gpuModels';

const GENERATIONS: readonly GpuGeneration[] = [1, 2, 3, 4, 5, 6, 7, 8, 9];
const SERIES: readonly GpuSeries[] = [3, 5, 7, 9];
const TIERS: readonly GpuTier[] = [30, 50, 60, 70, 80, 90];
const id = (generation: GpuGeneration, series: GpuSeries, tier: GpuTier): GpuModelId =>
  `${generation}${series}${tier}`;
const gPushExponent = (generation: GpuGeneration) => generation <= 3 ? 0.36 : generation <= 6 ? 0.21 : 0.12;

describe('GPU model catalog', () => {
  it('contains every legal GSMT model exactly once, with immutable native definitions', () => {
    const expected = GENERATIONS.flatMap((g) => SERIES.flatMap((s) => TIERS.map((t) => id(g, s, t))));
    expect(GPU_MODEL_IDS).toEqual(expected);
    expect(new Set(GPU_MODEL_IDS).size).toBe(216);
    expect(Object.isFrozen(GPU_MODEL_IDS)).toBe(true);
    for (const model of GPU_MODEL_IDS) {
      const native = gpuModel(model)!;
      expect(native.model).toBe(model);
      expect(`${native.generation}${native.series}${native.tier}`).toBe(model);
      expect(native.upgrades).toBe(0);
      expect(native.maxUpgrades).toBe(5);
      expect(Object.isFrozen(native)).toBe(true);
      expect(evaluateGpu(model, 0)).toEqual(native);
    }
  });

  it('matches the published 3350, 3990 and starter energy anchors', () => {
    expect(evaluateGpu('3350', 0)).toMatchObject({
      generation: 3, series: 3, tier: 50, cores: 32, vramBits: 4_194_304,
      clockHz: 110_000, opsPerS: 3_520_000,
    });
    expect(gpuNativePrice('3350')).toBe(1_200_000_000n);
    expect(evaluateGpu('3990', 0)).toMatchObject({
      cores: 512, vramBits: 268_435_456, clockHz: 300_000, opsPerS: 153_600_000,
    });
    const flagship = evaluateGpu('3990', 0);
    expect(flagship.idleW + flagship.loadW).toBeCloseTo(2_548_882_285.7142854, 5);
    const core = evaluateGpu('1330', 0), memory = evaluateGpu('1530', 0);
    expect(core.opsPerS).toBe(4_000);
    expect(core.idleW + core.loadW).toBe(79_200);
    expect(memory.opsPerS).toBe(1_000);
    expect(memory.idleW + memory.loadW).toBe(19_800);
  });

  it('uses the nine clock classes with twentyfold native rate and tenfold exact price steps', () => {
    for (const s of SERIES) for (const t of TIERS) {
      for (let g = 1; g < GENERATIONS.length; g++) {
        const previous = evaluateGpu(id(GENERATIONS[g - 1], s, t), 0);
        const next = evaluateGpu(id(GENERATIONS[g], s, t), 0);
        expect(next.cores).toBe(previous.cores * 2);
        expect(next.vramBits).toBe(previous.vramBits * 16);
        expect(next.clockHz).toBe(previous.clockHz * 10);
        expect(next.opsPerS).toBe(previous.opsPerS * 20);
        const target = (generation: number) => generation <= 3 ? 6 : generation <= 6 ? 3 : 2;
        expect(next.efficiencyOpsPerJ / previous.efficiencyOpsPerJ)
          .toBeCloseTo(target(next.generation) / target(previous.generation), 12);
        // Generation 1 is the cheap System-era entry card (1e6); later generations step 10×.
        expect(gpuNativePrice(next.model)).toBe(gpuNativePrice(previous.model) * (previous.generation === 1 ? 40n : 10n));
      }
    }
    expect(GENERATIONS.map((g) => evaluateGpu(id(g, 3, 30), 0).clockHz))
      .toEqual([1e3, 1e4, 1e5, 1e6, 1e7, 1e8, 1e9, 1e10, 1e11]);
  });

  it('raises all specs and efficiency at each tier while preserving series emphasis', () => {
    for (const g of GENERATIONS) {
      for (const s of SERIES) {
        for (let k = 1; k < TIERS.length; k++) {
          const previous = evaluateGpu(id(g, s, TIERS[k - 1]), 0);
          const next = evaluateGpu(id(g, s, TIERS[k]), 0);
          expect(next.cores).toBe(previous.cores * 2);
          expect(next.vramBits).toBe(previous.vramBits * 2);
          expect(next.clockHz).toBeGreaterThan(previous.clockHz);
          expect(next.efficiencyOpsPerJ).toBeGreaterThan(previous.efficiencyOpsPerJ);
          expect(gpuNativePrice(next.model)).toBeGreaterThan(gpuNativePrice(previous.model));
        }
        expect(evaluateGpu(id(g, s, 90), 0).efficiencyOpsPerJ
          / evaluateGpu(id(g, s, 30), 0).efficiencyOpsPerJ).toBeCloseTo(1.05, 12);
      }
      for (const t of TIERS) {
        const core = evaluateGpu(id(g, 3, t), 0), memory = evaluateGpu(id(g, 5, t), 0);
        const clock = evaluateGpu(id(g, 7, t), 0), premium = evaluateGpu(id(g, 9, t), 0);
        expect(core.cores).toBe(memory.cores * 4);
        expect(core.cores).toBe(clock.cores * 4);
        expect(memory.vramBits).toBe(core.vramBits * 4);
        expect(clock.clockHz).toBe(core.clockHz * 2);
        expect(clock.opsPerS).toBe(core.opsPerS / 2);
        expect(clock.loadW / core.loadW).toBeCloseTo(0.48, 12);
        expect(clock.efficiencyOpsPerJ / core.efficiencyOpsPerJ).toBeCloseTo(1 / 0.96, 12);
        expect(premium.cores).toBe(core.cores);
        expect(premium.vramBits).toBe(memory.vramBits);
        expect(premium.clockHz).toBe(clock.clockHz);
        expect(premium.opsPerS).toBe(core.opsPerS * 2);
        expect(premium.opsPerS).toBe(memory.opsPerS * 8);
        expect(premium.opsPerS).toBe(clock.opsPerS * 4);
      }
    }
  });

  it('evaluates all 1296 push states with fixed model identity, rising watts and falling efficiency', () => {
    let states = 0;
    for (const model of GPU_MODEL_IDS) {
      let previous = evaluateGpu(model, 0);
      for (let u = 0; u <= 5; u++) {
        const current = evaluateGpu(model, u);
        states++;
        expect(current.model).toBe(model);
        expect(current.upgrades).toBe(u);
        expect(current.cores).toBe(previous.cores * (u === 0 ? 1 : 2));
        expect(current.vramBits).toBe(previous.vramBits * (u === 0 ? 1 : 2));
        expect(current.clockHz).toBe(previous.clockHz * (u === 0 ? 1 : 1.25));
        expect(current.opsPerS).toBe(previous.opsPerS * (u === 0 ? 1 : 2.5));
        expect(current.opsPerS).toBe(current.cores * current.clockHz);
        expect(current.tensorOpsPerS).toBe(current.opsPerS);
        expect(current.efficiencyOpsPerJ).toBe(current.opsPerS / (current.idleW + current.loadW));
        for (const value of Object.values(current)) {
          if (typeof value === 'number') expect(Number.isFinite(value)).toBe(true);
        }
        if (u > 0) {
          const exponent = gPushExponent(current.generation);
          expect(current.loadW / previous.loadW).toBeCloseTo(2.5 ** (1 + exponent), 12);
          expect(current.idleW / previous.idleW).toBeCloseTo(2.5 ** 0.25, 12);
          expect(current.efficiencyOpsPerJ).toBeLessThan(previous.efficiencyOpsPerJ);
        }
        previous = current;
      }
    }
    expect(states).toBe(1296);
    expect(evaluateGpu('3990', 5)).toMatchObject({
      cores: 16_384, vramBits: 8_589_934_592, opsPerS: 15_000_000_000,
    });
  });

  it('makes every native premium more efficient than every specialist in its generation', () => {
    for (const g of GENERATIONS) for (const premiumTier of TIERS) {
      const premium = evaluateGpu(id(g, 9, premiumTier), 0);
      for (const s of [3, 5, 7] as const) for (const specialistTier of TIERS) {
        expect(premium.efficiencyOpsPerJ)
          .toBeGreaterThan(evaluateGpu(id(g, s, specialistTier), 0).efficiencyOpsPerJ);
      }
      expect(evaluateGpu(id(g, 9, 30), 0).efficiencyOpsPerJ
        / evaluateGpu(id(g, 7, 90), 0).efficiencyOpsPerJ).toBeCloseTo(80 / 77, 12);
    }
  });

  it('meets each era energy target, keeps X990 best and all 216 u5 cards near break-even', () => {
    for (const model of GPU_MODEL_IDS) {
      const native = evaluateGpu(model, 0), pushed = evaluateGpu(model, 5);
      const flagship = evaluateGpu(id(native.generation, 9, 90), 0);
      const target = native.generation <= 3 ? 6 : native.generation <= 6 ? 3 : 2;
      const ratio = (card: typeof native) => card.opsPerS / ((card.idleW + card.loadW) * 0.01);
      expect(Math.abs(ratio(flagship) / target - 1)).toBeLessThan(0.01);
      expect(ratio(native)).toBeGreaterThan(target * 0.8);
      if (model !== flagship.model) expect(ratio(native)).toBeLessThan(ratio(flagship));
      expect(ratio(pushed)).toBeGreaterThanOrEqual(1);
      expect(ratio(pushed)).toBeLessThanOrEqual(1.3);
    }
  });

  it('applies independent memory, HBM idle and caller-selected tensor effects to all push states', () => {
    for (const model of GPU_MODEL_IDS) for (let u = 0; u <= 5; u++) {
      const base = evaluateGpu(model, u);
      const gddr = evaluateGpu(model, u, { vramMultiplier: 4 });
      const hbm = evaluateGpu(model, u, { vramMultiplier: 16, hbmIdleFactor: 0.5, tensorFactor: 8 });
      expect(gddr).toEqual({ ...base, vramBits: base.vramBits * 4 });
      expect(hbm.vramBits).toBe(base.vramBits * 16);
      expect(hbm.idleW / base.idleW).toBeCloseTo(0.75, 12);
      expect(hbm.loadW).toBe(base.loadW);
      expect(hbm.opsPerS).toBe(base.opsPerS);
      expect(hbm.tensorOpsPerS).toBe(base.opsPerS * 8);
      expect(hbm.cores).toBe(base.cores);
      expect(hbm.clockHz).toBe(base.clockHz);
      expect(hbm.efficiencyOpsPerJ).toBeGreaterThan(base.efficiencyOpsPerJ);
    }
    expect(evaluateGpu('4930', 0, { tensorFactor: 4 }).tensorOpsPerS)
      .toBe(evaluateGpu('4930', 0).opsPerS * 4);
    expect(evaluateGpu('3350', 0, { vramMultiplier: undefined })).toEqual(evaluateGpu('3350', 0));
  });
});

describe('exact GPU prices', () => {
  it('charges exact native prices, upgrade recurrence and the full 13.1-times-native bundle', () => {
    for (const model of GPU_MODEL_IDS) {
      const native = gpuNativePrice(model);
      expect(typeof native).toBe('bigint');
      expect(native).toBeGreaterThan(0n);
      expect(gpuPriceToLevel(model, 0)).toBe(native);
      let total = native;
      for (let u = 0; u < 5; u++) {
        const step = gpuUpgradePrice(model, u);
        expect(step).toBe(u === 0 ? native / 10n : gpuUpgradePrice(model, u - 1) * 3n);
        total += step;
        expect(gpuPriceToLevel(model, u + 1)).toBe(total);
      }
      expect(total * 10n).toBe(native * 131n);
    }
    expect(TIERS.map((tier) => gpuNativePrice(id(3, 3, tier))))
      .toEqual([400_000_000n, 1_200_000_000n, 2_800_000_000n, 6_400_000_000n, 14_400_000_000n, 32_000_000_000n]);
    expect(gpuPriceToLevel('3990', 5) - gpuNativePrice('3990')).toBe(1_548_800_000_000n);
  });

  it('preserves exact high prices and rounds install escalation up once', () => {
    expect(gpuNativePrice('9990')).toBe(128_000_000_000_000_000n);
    expect(gpuUpgradePrice('9990', 4)).toBe(1_036_800_000_000_000_000n);
    expect(gpuPriceToLevel('9990', 5)).toBe(1_676_800_000_000_000_000n);
    expect(gpuInstallPrice('9990', 7)).toBe(488_281_250_000_000_000n);
    expect(Array.from({ length: 8 }, (_, n) => gpuInstallPrice('1330', n)))
      .toEqual([1_000_000n, 1_000_000n, 1_250_000n, 1_562_500n, 1_953_125n, 2_441_407n, 3_051_758n, 3_814_698n]);
    for (const model of GPU_MODEL_IDS) for (let n = 0; n < 8; n++) {
      const e = BigInt(Math.max(0, n - 1));
      const numerator = gpuNativePrice(model) * 5n ** e, denominator = 4n ** e;
      const quote = gpuInstallPrice(model, n);
      expect(quote * denominator).toBeGreaterThanOrEqual(numerator);
      expect((quote - 1n) * denominator).toBeLessThan(numerator);
      if (n > 0) expect(quote).toBeGreaterThanOrEqual(gpuInstallPrice(model, n - 1));
    }
  });

  it('prices premium above three comparable specialists at equal and successive legal positions', () => {
    let equalComparisons = 0;
    for (const g of GENERATIONS) for (const t of TIERS) for (let u = 0; u <= 5; u++) {
      const pushedInstall = (s: GpuSeries, n: number) => {
        const model = id(g, s, t);
        return gpuInstallPrice(model, n) + gpuPriceToLevel(model, u) - gpuNativePrice(model);
      };
      for (let n = 0; n < 8; n++) {
        expect(pushedInstall(9, n)).toBeGreaterThan(
          pushedInstall(3, n) + pushedInstall(5, n) + pushedInstall(7, n),
        );
        equalComparisons++;
        if (n <= 5) expect(pushedInstall(9, n)).toBeGreaterThan(
          pushedInstall(3, n) + pushedInstall(5, n + 1) + pushedInstall(7, n + 2),
        );
      }
    }
    expect(equalComparisons).toBe(2592);
  });
});

describe('GPU input validation', () => {
  it('rejects malformed, unknown and out-of-range models without defaults', () => {
    for (const invalid of ['', '335', '03350', '3350 ', ' 3350', '3350\n', '3351', '3340', '3450', '0350', '10350', 'NaN', '__proto__']) {
      expect(gpuModel(invalid)).toBeNull();
      const model = invalid as GpuModelId;
      for (const action of [
        () => evaluateGpu(model, 0), () => gpuNativePrice(model), () => gpuUpgradePrice(model, 0),
        () => gpuPriceToLevel(model, 0), () => gpuInstallPrice(model, 0),
      ]) expect(action).toThrow(/Unknown GPU model/);
    }
  });

  it('rejects invalid upgrade counts and refuses a sixth upgrade', () => {
    for (const u of [-1, 0.5, 6, NaN, Infinity, -Infinity]) {
      expect(() => evaluateGpu('3350', u)).toThrow(RangeError);
      expect(() => gpuPriceToLevel('3350', u)).toThrow(RangeError);
      expect(() => gpuUpgradePrice('3350', u)).toThrow(RangeError);
    }
    expect(() => gpuUpgradePrice('3350', 5)).toThrow(/0 to 4/);
  });

  it('rejects invalid install counts and technology rather than returning NaN or infinite stats', () => {
    for (const n of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => gpuInstallPrice('3350', n)).toThrow(RangeError);
    }
    for (const field of ['vramMultiplier', 'hbmIdleFactor', 'tensorFactor'] as const) {
      for (const value of [0, -1, NaN, Infinity, Number.MAX_VALUE]) {
        const technology: Partial<GpuTechnology> = { [field]: value };
        expect(() => evaluateGpu('9990', 5, technology)).toThrow(RangeError);
      }
    }
  });
});
