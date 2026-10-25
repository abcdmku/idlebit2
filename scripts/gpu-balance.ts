/** Isolated catalog/quote arithmetic only. Does not advance a campaign or time fleet performance.
 * node node_modules/tsx/dist/cli.mjs scripts/gpu-balance.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { earlyGpuDiscontinuity, gpuEnergyRows, gpuEnergySweep, gpuGenerationComparison, gpuSupplyFit } from '../src/game/probes/gpuBalance';
import { GPU_ENERGY } from '../src/game/build/catalog/gpuModels';
import type { GpuGeneration } from '../src/game/types/gpu';
import { gpuLoadedState } from '../src/game/testkit/gpuLoaded';

// Optional sweep axes: --base-w=16,17,18,19,20 --push-exponents=0.12,0.21,0.36
function axis(name: string): number[] | undefined {
  const arg = process.argv.slice(2).find((value) => value.startsWith(`--${name}=`));
  if (!arg) return undefined;
  const values = arg.slice(arg.indexOf('=') + 1).split(',').map(Number);
  if (values.some((value) => !Number.isFinite(value) || value <= 0)) throw new Error(`Invalid ${name} sweep`);
  return values;
}
const energySweep = gpuEnergySweep(axis('base-w'), axis('push-exponents'));
const energyRows = gpuEnergyRows(), supplyFit = gpuSupplyFit();
const energy = { chosen: GPU_ENERGY, sweep: energySweep, models: energyRows, supplyFit,
  coefficientFormula: 'w = baseW * eraScale * seriesFactor * 100/(100+k); series 3/5/7/9 = 1/1/0.96/0.88; k is the zero-based tier index.',
  assumptions: 'Ordinary work, 1 Credit/op, neutral technology, full use, 0.010 Credits/J. Supply checks use one card plus a native Hz host and cascade PSU/PDU/UPS losses, excluding networking and cooling.' };

const generations = Array.from({ length: 8 }, (_, i) => gpuGenerationComparison(i + 1 as GpuGeneration));
const early = earlyGpuDiscontinuity();
const g3 = generations[2], u3 = g3.hot[3], next = g3.native.find((card) => card.model === '4990')!;
const comparison = next.vsHot[3], home = comparison.regions.find((r) => r.region === 'us-east')!;
// Inspect one representative server only; never build or advance the maximum fleet here.
const prepared = gpuLoadedState(), c = prepared.compiled, s = c.sys;
const fullW = s.coreIdleW[0]! + s.coreLoadW[0]! + s.clockIdleW[0]!
  + [0, 1, 2, 3].reduce((n, r) => n + s.idleW[r]! + s.loadW[r]!, 0);
const poweredProfile = { evidence: 'Static preparation only, no ticks or performance samples run',
  model: prepared.build.systems[0]!.spec.accels[0], cardsPerSystem: 8, queuedPerSystem: prepared.hot.sys.queueLen[0],
  cardOpsPerS: s.accelOps[0], cardIdleW: s.accelIdleW[0], cardLoadW: s.accelLoadW[0],
  task: 'rayTrace', memberSize: 2 ** 23, taskGpuSeconds: 14 * 2 ** 23 / s.accelOps[0]!,
  systemFullW: fullW, psuCapW: s.psuCapW[0], rackFull12SystemW: 12 * fullW,
  rackPduCapW: c.rack.pduCapW[0], rackCoolerQc: c.rack.coolerQc[0],
  fullFleetSystems: 6912, fullFleetTasks: 6912 * 8,
};
const report = {
  evidence: 'Isolated analytical checks, synthetic starting states. No campaign or maximum-fleet benchmark has run.',
  sources: ['build/catalog/gpuModels.ts', 'build/quotes.ts', 'build/research/tree.ts', 'core/accelerators.ts', 'market/families.ts', 'market/curve.ts', 'core/constants.ts'],
  assumptions: [
    'One owned current G990, identical 20-flagship-price Credit budget and next-generation Data budget for every alternative.',
    'Every research prerequisite is declared complete. Neutral VRAM/tensor tech, eta 1 and thermal efficiency 1.',
    'Next-generation research fee is debited by startResearch. Work completion is hypothetical for purchase pricing.',
    'GPU stage times exclude CPU/RAM/IO stages, network, queueing, members and other task gates.',
    'Power is actual compiled catalog watts. PSU headroom includes full system draw. Rack PDU headroom subtracts maximum cooler watts but excludes network/router load.',
    'Rack cooling headroom compares Qc with one system input heat at eta 1. This is not a thermal equilibrium or whole-fleet viability claim.',
    'Regional energy costs and payback are GPU-only, same served rate, ideal utilization. They exclude infrastructure, research energy and lost work.',
    'An energy payback does not make a replacement legal when it loses required cores or VRAM.',
    'Budget left after purchase excludes future energy bills. Energy may require more starting Credits.',
    'One Credit per work and authored Data ratios remain unchanged.',
  ], energy, early, generations, poweredProfile,
};
const lines = [
  '# GPU local comparison', '',
  report.evidence, '',
  `D8 calibration: base w=${GPU_ENERGY.baseW}, era scales ${GPU_ENERGY.eraScale.join('/')}, push exponents ${GPU_ENERGY.pushExponent.join('/')}.`,
  energy.coefficientFormula,
  `Sweep: ${energySweep.length} candidates; ${energySweep.filter((row) => row.meetsTargets).length} satisfy native ±2% and all u5 ratios 1.0–1.3.`,
  ...energyRows.filter((row) => row.model.endsWith('990')).map((row) =>
    `G${row.generation}: X990 u0 gross/energy ${row.native.grossToEnergy.toFixed(3)}, u5 ${row.u5.grossToEnergy.toFixed(3)}; mid ${row.generation}350 u5 ${energyRows.find((mid) => mid.model === `${row.generation}350`)!.u5.grossToEnergy.toFixed(3)}.`),
  `Supply fit: ${supplyFit.length} u0/u1 card-host cases; ${supplyFit.filter((row) => row.supplies.some((supply) => supply.headroomW < 0)).length} failures through era-available PSU/PDU/UPS/grid.`,
  energy.assumptions, '',
  `Early native 1330: ${early.currentNativeOpsPerS} ops/s versus archived ${early.supersededNativeGpuOpsPerS}, a ${early.ratio}x step.`,
  `Gen-2 work on a lone 1330: ${early.gen2ResearchGpuOnlySeconds1330} seconds before CPU contribution, sharing and physical limits.`, '',
  `3990 u3: ${u3.stats.opsPerS} ops/s, ${u3.stats.cores} cores, ${u3.stats.vramBits} VRAM bits, ${u3.stats.idleW + u3.stats.loadW} full watts. Hot bundle: ${u3.additionalCredits} Credits.`,
  `Gen-4 research: ${g3.research.credits} Credits + ${g3.research.data} Data + ${g3.research.work} work ops.`,
  `4990 native plus research: ${next.additionalCredits} Credits. ${next.stats.opsPerS} ops/s, ${next.stats.cores} cores, ${next.stats.vramBits} VRAM bits.`,
  `At identical ${comparison.offeredOpsPerS} ordinary ops/s, GPU watts are ${comparison.oldW} and ${comparison.nextW}.`,
  `Home GPU energy savings: ${home.savingCreditsPerS} Credits/s. Additional-cost energy-only payback: ${home.energyOnlyPaybackS! / 3600} hours.`,
  `4990 preserves u3 core+VRAM gates: ${comparison.preservesCoresAndVram}.`, '',
  ...report.assumptions.map((s) => `- ${s}`), '',
  'Inspect report.json for every generation, all 24 next-generation models, u0..5, family gate results, supply/cooling headroom and eight regional energy comparisons.', '',
  `Prepared powered profile: eight G1530 u5 cards/server, ${fullW} full system watts against ${s.psuCapW[0]} W PSU. A full 12-system rack has ${12 * fullW} system watts against ${c.rack.coolerQc[0]} W cooler Qc.`,
  `Each pre-admitted ray-trace task fills one actual card and needs ${poweredProfile.taskGpuSeconds} GPU seconds. Full profile has 6,912 systems and 55,296 tasks. No timed or sustained-run claim yet.`, '',
  'Pending integration evidence: legal campaign to first GPU and later research, per-card measured execution/power/research, and powered GPU-loaded frame/offline measurements alongside the all-max stress fixture.',
];
const dir = 'artifacts/gpu/balance/local';
mkdirSync(dir, { recursive: true });
writeFileSync(`${dir}/report.json`, JSON.stringify(report, null, 2));
writeFileSync(`${dir}/report.md`, lines.join('\n') + '\n');
console.log(lines.slice(0, 19).join('\n'));
console.log(`\nArtifacts: ${dir}`);
