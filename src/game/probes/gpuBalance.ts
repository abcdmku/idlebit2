import { amount, amountAdd, amountCompare, amountMultiply, amountSubtract } from '../amount';
import { applyAction } from '../core/actions';
import { accelGate, accelNeed, chooseAccel } from '../core/accelerators';
import { REGIONS } from '../core/constants';
import { compileAll } from '../core/topology';
import { GPU_ENERGY, GPU_MODEL_IDS, evaluateGpu, gpuModel, gpuNativePrice } from '../build/catalog/gpuModels';
import type { GpuEnergyCalibration } from '../build/catalog/gpuModels';
import { PSU } from '../build/catalog/board';
import { capacity, levelMax, lossFraction } from '../build/catalog/curves';
import { PDU, UPS } from '../build/catalog/infra';
import { GRID } from '../build/catalog/site';
import type { CatalogRow } from '../build/catalog/types';
import { quote } from '../build/quotes';
import { researchDef } from '../build/research/tree';
import { FAMILIES } from '../market/families';
import { memberSize } from '../market/curve';
import { supplyLossW } from '../phys/supplies';
import { buildState } from '../testkit/builders';
import type { GpuGeneration, GpuModelId } from '../types/gpu';
import { researchId, systemId } from '../types/ids';
import type { GameAction } from '../types/actions';
import type { GameState } from '../types/state';

/** Isolated ordinary GPU work, neutral technology, 1 Credit/op at the home reference tariff. */
export function gpuEnergyRows(energy: GpuEnergyCalibration = GPU_ENERGY) {
  return GPU_MODEL_IDS.map((model) => {
    const at = (upgrades: number) => {
      const card = evaluateGpu(model, upgrades, {}, energy);
      const watts = card.idleW + card.loadW;
      return { upgrades, watts, grossToEnergy: card.opsPerS / (watts * 0.01) };
    };
    return { model, generation: gpuModel(model)!.generation, native: at(0), u1: at(1), u5: at(5) };
  });
}

/** Sweep each era independently; all native models must stay profitable and all u5 cards in band. */
export function gpuEnergySweep(
  baseWatts: readonly number[] = [16, 17, 18, 19, 20],
  pushExponents: readonly number[] = [0.09, 0.12, 0.15, 0.18, 0.21, 0.24, 0.33, 0.36, 0.39],
) {
  return [6, 3, 2].flatMap((target, era) => baseWatts.flatMap((baseW) => pushExponents.map((exponent) => {
    const energy: GpuEnergyCalibration = { baseW, eraScale: GPU_ENERGY.eraScale,
      pushExponent: GPU_ENERGY.pushExponent.map((p, i) => i === era ? exponent : p) as [number, number, number] };
    const rows = gpuEnergyRows(energy).filter((r) => Math.floor((r.generation - 1) / 3) === era);
    const flagship = rows.find((r) => r.model === `${era * 3 + 1}990`)!.native.grossToEnergy;
    const u5Min = Math.min(...rows.map((r) => r.u5.grossToEnergy));
    const u5Max = Math.max(...rows.map((r) => r.u5.grossToEnergy));
    return { era, baseW, generationScale: energy.eraScale[era]!, exponent, target,
      flagship, nativeMin: Math.min(...rows.map((r) => r.native.grossToEnergy)), u5Min, u5Max,
      meetsTargets: Math.abs(flagship / target - 1) <= 0.02 && u5Min >= 1 && u5Max <= 1.3 };
  })));
}

/** Conservative era availability: Bench, Bronze, Gold, Platinum, then Titanium from GPU gen 6. */
const GPU_PSU_GENERATIONS = [0, 2, 3, 4, 4, 5, 5, 5, 5] as const;
function fitSupply(row: CatalogRow, generation: number, deliveredW: number) {
  const maximumLevel = levelMax(row, generation);
  let level = 1;
  while (level < maximumLevel && capacity(row, generation, level) < deliveredW) level++;
  const capacityW = capacity(row, generation, level);
  return { part: row.id, generation, level, maximumLevel, deliveredW, capacityW,
    headroomW: capacityW - deliveredW,
    inputW: deliveredW + supplyLossW(deliveredW, capacityW, lossFraction(row, generation, level)) };
}

export function gpuSupplyFit() {
  return gpuEnergyRows().flatMap((row) => [row.native, row.u1].map((card) => {
    const psuGeneration = GPU_PSU_GENERATIONS[row.generation - 1]!;
    // A single card plus the reference host's native Hz CPU, clock and cache, before PSU loss.
    const systemW = card.watts + 1.4;
    const psu = fitSupply(PSU, psuGeneration, systemW), supplies = [psu];
    // One reference system only, cascading actual supply losses. Excludes cooling/network draw.
    if (row.generation >= 3) supplies.push(fitSupply(PDU, row.generation < 5 ? 1 : 2, supplies.at(-1)!.inputW));
    if (row.generation >= 5) supplies.push(fitSupply(UPS, row.generation < 7 ? 1 : 2, supplies.at(-1)!.inputW));
    if (row.generation >= 7) supplies.push(fitSupply(GRID, row.generation < 8 ? 1 : 2, supplies.at(-1)!.inputW));
    return { model: row.model, upgrades: card.upgrades, psuGeneration, level: psu.level,
      maximumLevel: psu.maximumLevel, systemW, capacityW: psu.capacityW, headroomW: psu.headroomW, supplies };
  }));
}

function act(state: GameState, action: GameAction): GameState {
  const result = applyAction(state, action);
  if (!result.ok) throw new Error(`Probe action ${action.type}: ${JSON.stringify(result)}`);
  return result.state;
}

/** Same synthetic owned flagship, exact budgets and neutral memory/tensor tech for both paths.
 * Every prerequisite is declared complete. This setup is expressly not an earned campaign.
 */
function startingState(generation: GpuGeneration): GameState {
  const model: GpuModelId = `${generation}990`;
  const next = researchDef(`gpuGen${generation + 1}`)!;
  const completed = new Set<string>();
  const visit = (id: string) => {
    if (completed.has(id)) return;
    const node = researchDef(id);
    if (!node) throw new Error(`Missing runtime research ${id}`);
    for (const parent of node.requires) visit(parent);
    completed.add(id);
  };
  for (const parent of next.requires) visit(parent);
  const base = buildState({ sites: 1, zonesPerSite: 1, racksPerZone: 1, serversPerRack: 1,
    unlocks: 'max', round: 'between', credits: (gpuNativePrice(model) * 20n).toString(), data: String(next.data),
    system: (id, rack, slot) => ({ id, rack, slot, online: true, spec: {
      kind: 'server', board: 'general', cpu: { cpu: { gen: 0, level: 1 }, cores: [{ gen: 0, level: 1 }],
        clock: { gen: 0, level: 1 }, l1: { gen: 0, level: 1 }, l2: null, l3: null }, cpuCount: 1,
      scheduler: null, ram: [], drives: [], accels: [{ kind: 'gpu', model, upgrades: 0 }],
      psu: { gen: 5, level: 16, capped: false }, settings: { dvfs: false, turbo: false, cStateLimit: 0 },
    } }),
    rack: (r) => ({ ...r, opened: true, pdu: { gen: 2, level: 13, capped: false },
      cooler: { gen: 3, level: 14, setpointF: 70 } }),
  });
  const research = { ...base.research, completed: [...completed].map(researchId), unlocks: {
    ...base.research.unlocks, gens: { ...base.research.unlocks.gens, gpu: (1 << generation) - 1 },
    rules: base.research.unlocks.rules.filter((r) => !['gpuLink', 'vramPerLevel', 'tensorRate'].includes(r)), ruleParams: {},
  } };
  return { ...base, research, compiled: compileAll(base.build, research) };
}

function observation(state: GameState) {
  const card = state.build.systems[0]!.spec.accels[0]!;
  if (card.kind !== 'gpu') throw new Error('Probe needs a GPU');
  const stats = quote(state, { kind: 'gpuModels', system: systemId(0), index: 0,
    generation: gpuModel(card.model)!.generation }).quotes.find((q) => q.action.type === 'installGpu' && q.action.model === card.model)!.gpu!.after;
  // Read the installed paired columns, including hot upgrades, rather than a system-wide maximum.
  const c = state.compiled, s = c.sys;
  const actual = { ...stats, upgrades: card.upgrades, cores: s.accelCores[0]!, vramBits: s.accelVram[0]!,
    clockHz: s.accelClockHz[0]!, opsPerS: s.accelOps[0]!, tensorOpsPerS: s.accelTensorOps[0]!,
    idleW: s.accelIdleW[0]!, loadW: s.accelLoadW[0]! };
  actual.efficiencyOpsPerJ = actual.opsPerS / (actual.idleW + actual.loadW);
  const idle = s.coreIdleW[0]! + s.clockIdleW[0]! + [0, 1, 2, 3].reduce((sum, r) => sum + s.idleW[r]!, 0);
  const systemFullW = idle + s.coreLoadW[0]! + [0, 1, 2, 3].reduce((sum, r) => sum + s.loadW[r]!, 0);
  const systemInputW = systemFullW + supplyLossW(systemFullW, s.psuCapW[0]!, s.psuLoss[0]!);
  return { model: card.model, upgrades: card.upgrades, stats: actual,
    creditsRemaining: state.wallet.credits, dataRemaining: state.wallet.data,
    systemFullW, psuHeadroomW: s.psuCapW[0]! - systemFullW,
    rackPduHeadroomBeforeNetworkingW: c.rack.pduCapW[0]! - systemInputW - c.rack.coolerIdleW[0]! - c.rack.coolerLoadW[0]!,
    rackCoolingHeadroomVsSystemHeatW: c.rack.coolerQc[0]! - systemInputW,
    gates: FAMILIES.filter((f) => f.stages.some((st) => st.resource === 'gpu')).map((family) => {
      const { window: intensityWindow } = family;
      const size = memberSize((intensityWindow.from + intensityWindow.to) / 2, 1, family.members);
      const need = accelNeed(family, size), gate = accelGate(c, 0, need), choice = chooseAccel(c, null, 0, need, 1);
      const gpuWork = family.stages.filter((st) => st.resource === 'gpu').reduce((n, st) => n + st.work.fixed + st.work.perSize * size, 0);
      return { family: family.key, size, gpuCores: need.gpuCores, vramBits: need.vramBits, gate,
        pairedRate: choice?.opsPerS ?? null, gpuStageSeconds: choice ? gpuWork / choice.opsPerS : null };
    }),
  };
}

export function gpuGenerationComparison(generation: GpuGeneration) {
  if (generation === 9) throw new Error('Generation 9 has no next generation');
  const start = startingState(generation), project = researchId(`gpuGen${generation + 1}`);
  const def = researchDef(project)!;
  const researchQuote = quote(start, { kind: 'research', project }).quotes[0]!;
  if (researchQuote.locked || !researchQuote.affordable || researchQuote.creditCost === undefined) throw new Error('Missing usable runtime research quote');
  const ref = { unit: { kind: 'system' as const, id: systemId(0) }, slot: { kind: 'gpu' as const, index: 0 } };
  let pushed = start, spent = amount(0);
  const hot: (ReturnType<typeof observation> & { additionalCredits: string; researchSecondsGpuOnly: number })[] = [];
  for (let u = 0; u <= 5; u++) {
    hot.push({ additionalCredits: spent, ...observation(pushed),
      researchSecondsGpuOnly: def.work / pushed.compiled.sys.accelOps[0]! });
    if (u === 5) break;
    const q = quote(pushed, { kind: 'part', part: ref }).quotes.find((q) => q.action.type === 'upgradePart')!;
    spent = amountAdd(spent, q.cost); pushed = act(pushed, q.action);
  }
  const paid = act(start, researchQuote.action);
  // Quote the post-research purchase analytically. No work or completion is claimed to have run.
  const research = { ...paid.research, active: null, completed: [...paid.research.completed, project],
    unlocks: { ...paid.research.unlocks, gens: { ...paid.research.unlocks.gens, gpu: (1 << (generation + 1)) - 1 } } };
  const unlocked = { ...paid, research, compiled: compileAll(paid.build, research) };
  const native = quote(unlocked, { kind: 'gpuModels', system: systemId(0), index: 0, generation: generation + 1 as GpuGeneration }).quotes.map((q) => {
    const obs = observation(act(unlocked, q.action));
    const additionalCredits = amountAdd(researchQuote.creditCost!, q.cost);
    return { ...obs, purchaseCredits: q.cost, additionalCredits,
      vsHot: hot.map((old) => {
        const offeredOpsPerS = Math.min(old.stats.opsPerS, obs.stats.opsPerS);
        const oldW = old.stats.idleW + old.stats.loadW * offeredOpsPerS / old.stats.opsPerS;
        const nextW = obs.stats.idleW + obs.stats.loadW * offeredOpsPerS / obs.stats.opsPerS;
        const premium = amountSubtract(additionalCredits, old.additionalCredits);
        return { upgrades: old.upgrades, offeredOpsPerS, oldW, nextW,
          preservesCoresAndVram: obs.stats.cores >= old.stats.cores && obs.stats.vramBits >= old.stats.vramBits,
          regions: REGIONS.map((region) => {
            const oldCreditsPerS = amountMultiply(String(oldW), String(region.energyPrice));
            const nextCreditsPerS = amountMultiply(String(nextW), String(region.energyPrice));
            const savingCreditsPerS = amountSubtract(oldCreditsPerS, nextCreditsPerS);
            return { region: region.id, energyPrice: region.energyPrice, oldCreditsPerS, nextCreditsPerS, savingCreditsPerS,
              energyOnlyPaybackS: amountCompare(savingCreditsPerS, 0) > 0 ? Math.max(0, Number(premium)) / Number(savingCreditsPerS) : null };
          }) };
      }) };
  });
  return { generation, evidence: 'Synthetic analytical comparison, not a campaign or timed execution.',
    start: { credits: start.wallet.credits, data: start.wallet.data, owned: `${generation}990`, technology: 'neutral',
      workload: 'Identical family midpoint sizes, jitter 1. Gates cover GPU only; other task gates may fail.' },
    research: { project, data: researchQuote.cost, credits: researchQuote.creditCost, work: researchQuote.workOps,
      required: def.requires, walletAfterStart: paid.wallet }, hot, native };
}

export function earlyGpuDiscontinuity() {
  const oldRate = 32, current = gpuModel('1330')!;
  return { supersededNativeGpuOpsPerS: oldRate, currentNativeModel: current.model,
    currentNativeOpsPerS: current.opsPerS, ratio: current.opsPerS / oldRate,
    gpuGen2Work: researchDef('gpuGen2')!.work,
    gen2ResearchGpuOnlySecondsOld: researchDef('gpuGen2')!.work / oldRate,
    gen2ResearchGpuOnlySeconds1330: researchDef('gpuGen2')!.work / current.opsPerS,
    caveat: 'Old 32 ops/s is the archived baseline. Current rate/work come from runtime catalogs. CPU, other cards, duty, power and temperature change actual research time.' };
}
