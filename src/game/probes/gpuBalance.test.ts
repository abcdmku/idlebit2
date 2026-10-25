import { amountAdd, amountSubtract } from '../amount';
import { earlyGpuDiscontinuity, gpuEnergyRows, gpuEnergySweep, gpuGenerationComparison, gpuSupplyFit } from './gpuBalance';

describe('GPU isolated economic comparison', () => {
  it('uses exact live fees, legal actions and the same starting budgets for every alternative', () => {
    const result = gpuGenerationComparison(3);
    expect(result.research).toMatchObject({ credits: '64000000000', data: '40000000', work: 2e10 });
    expect(result.hot.map((h) => h.upgrades)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(result.native).toHaveLength(24);
    for (const row of [...result.hot, ...result.native]) {
      expect(amountAdd(row.creditsRemaining, row.additionalCredits)).toBe(result.start.credits);
      expect(Number.isFinite(row.stats.idleW + row.stats.loadW)).toBe(true);
    }
    for (const row of result.native) expect(row.dataRemaining).toBe('0');
    expect(result.research.walletAfterStart.credits).toBe(amountSubtract(result.start.credits, result.research.credits));
  });

  it('reports losing core gates and a long energy-only payback at identical served work', () => {
    const result = gpuGenerationComparison(3), next = result.native.find((r) => r.model === '4990')!;
    const vs = next.vsHot[3], home = vs.regions.find((r) => r.region === 'us-east')!;
    expect(vs.preservesCoresAndVram).toBe(false);
    expect(vs.offeredOpsPerS).toBe(2.4e9);
    expect(home.energyOnlyPaybackS! / 3600).toBeCloseTo(2.021811, 5);
    expect(result.hot[3].researchSecondsGpuOnly).toBeCloseTo(8.333333, 5);
    expect(result.hot[0].researchSecondsGpuOnly).toBeCloseTo(130.208333, 5);
    expect(result.hot[0].gates.every((g) => g.gate !== 0 || g.pairedRate === result.hot[0].stats.opsPerS)).toBe(true);
  });

  it('keeps the early 125x rate step explicit', () => {
    expect(earlyGpuDiscontinuity()).toMatchObject({ ratio: 125, currentNativeOpsPerS: 4000, gen2ResearchGpuOnlySeconds1330: 7500 });
  });

  it('selects the D8 watt and push coefficients from the parameter sweep', () => {
    const accepted = gpuEnergySweep().filter((row) => row.meetsTargets);
    expect(accepted.map(({ baseW, generationScale, exponent }) => [baseW, generationScale, exponent]))
      .toEqual([[18, 1, 0.36], [18, 2, 0.21], [18, 3, 0.12]]);
    const lowerW = gpuEnergySweep([16], [0.36])[0];
    expect(lowerW.flagship).toBeGreaterThan(accepted[0].flagship);
    expect(lowerW.u5Max).toBeGreaterThan(1.3);
    const rows = gpuEnergyRows();
    expect(rows).toHaveLength(216);
    for (const row of rows) {
      const target = row.generation <= 3 ? 6 : row.generation <= 6 ? 3 : 2;
      expect(row.native.grossToEnergy).toBeGreaterThan(target * 0.8);
      expect(row.u5.grossToEnergy).toBeGreaterThanOrEqual(1);
      expect(row.u5.grossToEnergy).toBeLessThanOrEqual(1.3);
    }
  });

  it('fits every native card through u1 within legal era supplies, including upstream losses', () => {
    const rows = gpuSupplyFit();
    expect(rows).toHaveLength(432);
    for (const row of rows) for (const supply of row.supplies) {
      expect(supply.headroomW, `${row.model} u${row.upgrades} ${supply.part}`).toBeGreaterThanOrEqual(0);
      expect(supply.level).toBeLessThanOrEqual(supply.maximumLevel);
    }
    for (const [model, generation, levels] of [
      ['1330', 0, [3, 4]], ['1530', 0, [1, 2]], ['3990', 3, [12, 14]],
    ] as const) {
      const cards = rows.filter((row) => row.model === model);
      expect(cards.map((row) => [row.upgrades, row.psuGeneration, row.level]))
        .toEqual([[0, generation, levels[0]], [1, generation, levels[1]]]);
    }
  });
});
