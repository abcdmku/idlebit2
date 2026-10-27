import { viewW } from '../core/constants';
import { amount } from '../amount';
import { allocCompiled } from '../core/buffers';
import { DT_S, MAX_ACCELS, REGIONS } from '../core/constants';
import { PRE_SYSTEM_CPU_W } from '../phys/draw';
import type { BuildState, SystemSpec } from '../types/build';
import { REGION_IDS } from '../types/catalog';
import { rackId, systemId, type PartRef } from '../types/ids';
import type { CapacityUnit, EffectPreview } from '../types/quotes';
import type { GameState, Unlocks } from '../types/state';
import { capacity, capacity2, isLeveled, partWatts, PARTS, type LeveledPartId } from './catalog';
import { compileSystem } from './compile';
import { lossFraction } from './catalog/curves';
import { supplyLossW } from '../phys/supplies';
import { POWER_SLOTS, readPart } from './partAccess';
import { installedGpuStats } from './gpu';
import type { AccelBuild } from '../types/gpu';
import { cpuMarketKnown, gpuMarketKnown, gpuMarketShare, paidWorkScale, researchRackHeat, workEnergyChange } from './workloadValue';
import { workProfile, type WorkProfile } from './workEnergy';

/**
 * Upgrade-versus-replace preview (spec §12.4): capacity, full-load input watts for rate parts,
 * and payback from recent paid work minus energy per unit of work at saved sleep settings.
 * Research earns no Credits. A nonpositive estimated return differs from an unestimated benefit.
 */
interface SysValues { rate: number; mem: number; cache: number; gpu: number; store: number; psu: number; queue: number; idle: number; load: number; ramBw: number; io: number }
interface SysFigures extends SysValues { work: WorkProfile }

/** Figures are pure in (spec, unlocks), both immutable, and a tray re-asks them every frame. */
const figureMemo = new WeakMap<SystemSpec, WeakMap<Unlocks, SysFigures>>();
function figures(spec: SystemSpec, u: Unlocks): SysFigures {
  let byUnlocks = figureMemo.get(spec);
  if (!byUnlocks) figureMemo.set(spec, (byUnlocks = new WeakMap()));
  let f = byUnlocks.get(u);
  if (!f) byUnlocks.set(u, (f = compileFigures(spec, u)));
  return f;
}

function compileFigures(spec: SystemSpec, u: Unlocks): SysFigures {
  const c = allocCompiled({ systems: 1, racks: 0, rooms: 0, sites: 0, links: 0 }).sys;
  compileSystem({ sys: c } as never, { id: systemId(0), rack: rackId(0), slot: 0, online: true, spec }, u);
  let idle = c.coreIdleW[0]! + c.clockIdleW[0]!;
  let load = c.coreLoadW[0]! + c.clockLoadW[0]!;
  for (let r = 0; r < 4; r += 1) { idle += c.idleW[r]!; load += c.loadW[r]!; }
  return {
    rate: c.threadRate[0]! * c.cores[0]! * c.etaCfg[0]!, mem: c.ramCap[0]!, cache: c.cacheBits[0]!, gpu: c.gpuOps[0]!,
    store: c.storageCap[0]!, psu: c.psuCapW[0]!, queue: c.Q[0]!, idle, load, ramBw: c.ramBw[0]!, io: c.ioRate[0]!, work: workProfile(c, 0, spec, u),
  };
}

const CAPACITY: Record<string, [keyof SysValues, CapacityUnit, boolean]> = {
  cpu: ['rate', 'Hz', true], core: ['rate', 'ops/s', true], clock: ['rate', 'Hz', true],
  l1: ['cache', 'bits', false], l2: ['cache', 'bits', false], l3: ['cache', 'bits', false], scheduler: ['queue', 'slots', false],
  ram: ['mem', 'bits', false], gpu: ['gpu', 'ops/s', true], npu: ['gpu', 'ops/s', true], drive: ['store', 'bits', false], psu: ['psu', 'W', false],
};
/**
 * A part's shown x → y is the number the board prints on that part (coordinator rule): the clock's
 * Hz and, for the package, the CPU's headline clock (ChipSnapshot.clock.hz, the System board's CPU
 * label); a core's clock rate (CoreView.rate); a RAM stick's
 * or drive's own bits (PartView.capacityBits). Payback still uses the
 * system figures: an upgrade's gain is the rate it adds.
 */
const OWN_VALUE = new Set(['cpu', 'clock', 'core', 'l1', 'l2', 'l3', 'ram', 'drive']);
function ownValue(build: BuildState, ref: PartRef): number {
  const cpu = ref.unit.kind === 'system' ? build.systems[ref.unit.id]?.spec.cpu : null;
  const hz = cpu ? capacity(PARTS.clock, cpu.clock.gen, cpu.clock.level) : 0;
  if (ref.slot.kind === 'cpu' || ref.slot.kind === 'clock') return hz;
  const p = readPart(build, ref);
  if (!p || !isLeveled(p.id)) return 0;
  const own = capacity(PARTS[p.id as LeveledPartId], p.gen, p.level);
  return ref.slot.kind === 'core' ? own * hz : own;
}

/** Credits per joule where a unit sits (spec §9.6). */
export function energyPrice(state: GameState, ref: PartRef): number {
  const b = state.build;
  const unit = ref.unit;
  const siteId = unit.kind === 'system' ? b.rooms[b.racks[b.systems[unit.id]?.rack ?? 0]?.room ?? 0]?.site
    : unit.kind === 'rack' ? b.rooms[b.racks[unit.id]?.room ?? 0]?.site : unit.kind === 'room' ? b.rooms[unit.id]?.site : unit.kind === 'site' ? unit.id : 0;
  const region = b.sites[siteId ?? 0]?.region ?? 'us-east';
  return REGIONS[REGION_IDS.indexOf(region)]!.energyPrice;
}

const cardFigures = (card: AccelBuild | undefined, u: Unlocks): { rate: number; idle: number; load: number } => {
  if (!card) return { rate: 0, idle: 0, load: 0 };
  if (card.kind === 'gpu') {
    const stats = installedGpuStats(card, u);
    return { rate: stats.opsPerS, idle: stats.idleW, load: stats.loadW };
  }
  const watts = partWatts(PARTS.npu, card.gen, card.level);
  return { rate: capacity(PARTS.npu, card.gen, card.level) * PARTS.npu.tensorFactor![card.gen]!, ...watts };
};

export function preview(before: number, after: number, unit: CapacityUnit, wBefore: number, wAfter: number, price: number, cost: bigint, rateGain: number | null, workEnergyDelta?: number): EffectPreview {
  const energyDelta = workEnergyDelta ?? (wAfter - wBefore) * price;
  const gain = rateGain === null ? null : rateGain - energyDelta;
  return {
    // D36: watts, joules and W/J capacities leave the sim at the view scale.
    capacityBefore: unit === 'W' || unit === 'J' ? viewW(before) : before, capacityAfter: unit === 'W' || unit === 'J' ? viewW(after) : after, unit,
    wattsBefore: viewW(wBefore), wattsAfter: viewW(wAfter),
    energyPerMinuteDelta: amount(Math.round(energyDelta * 60)),
    paybackS: gain !== null && gain > 0 ? Number(cost) / gain : null,
    paybackEvaluated: rateGain !== null,
    ...(rateGain !== null && energyDelta > 0 && rateGain <= energyDelta ? { marginalLoss: true } : {}),
  };
}

/**
 * A power supply change: capacity in W, its loss before and after (percent at typical load), and
 * the system's input power at its current draw (delivered + loss), so the energy delta is the
 * saving and payback is price / saving.
 */
function psuEffect(state: GameState, id: number, a: SystemSpec, b: SystemSpec, capA: number, capB: number, price: number, cost: bigint): EffectPreview {
  const lossA = lossFraction(PARTS.psu, a.psu.gen, a.psu.level), lossB = lossFraction(PARTS.psu, b.psu.gen, b.psu.level);
  const draw = state.hot.sys.drawW[id] ?? 0;
  const wa = draw + supplyLossW(draw, capA, lossA), wb = draw + supplyLossW(draw, capB, lossB);
  return { ...preview(capA, capB, 'W', wa, wb, price, cost, 0), lossPctBefore: lossA * 100, lossPctAfter: lossB * 100 };
}

/**
 * Preview of a part change already applied in `after` (same system or infra unit). `total`: the system's own
 * totals instead of the part's printed value (an Add: all RAM and its pooled bandwidth, all storage and its IO,
 * the CPUs' work rate), so a new module reads as what the system gains.
 */
export function partEffect(state: GameState, ref: PartRef, after: BuildState, cost: bigint, total = false): EffectPreview | null {
  const u = state.research.unlocks;
  const price = energyPrice(state, ref);
  if (ref.unit.kind === 'system') {
    const id = ref.unit.id;
    const a = state.build.systems[id]?.spec;
    const b = after.systems[id]?.spec;
    const key = CAPACITY[ref.slot.kind];
    if (!a || !b || !key) return null;
    if (ref.slot.kind === 'gpu') {
      const slot = ref.slot.index, at = id * MAX_ACCELS + slot;
      const use = Math.min(1, Math.max(0, (state.hot.sys.accelTaskS[at] ?? 0) / DT_S));
      const before = cardFigures(a.accels[slot], u), afterCard = cardFigures(b.accels[slot], u);
      const fa = figures(a, u), fb = figures(b, u), pipe = state.compiled.sys.pipeSpeed[id] ?? 0;
      const scale = state.round.reports.length ? paidWorkScale(state) : use;
      const gain = gpuMarketKnown(state) ? (Math.min(fb.rate + fb.gpu, pipe) - Math.min(fa.rate + fa.gpu, pipe)) * scale * gpuMarketShare(state) : null;
      const energy = workEnergyChange(state, id, fb.work, Math.min(fb.rate + fb.gpu, pipe));
      const wa = fa.idle + fa.load, wb = fb.idle + fb.load;
      return { ...preview(before.rate, afterCard.rate, 'ops/s', wa + supplyLossW(wa, fa.psu, state.compiled.sys.psuLoss[id] ?? 0),
        wb + supplyLossW(wb, fb.psu, state.compiled.sys.psuLoss[id] ?? 0), price, cost, gain, energy), marketEstimate: true };
    }
    const cores = Math.max(1, state.compiled.sys.cores[id] ?? 1);
    const use = Math.min(1, Math.max(0, (state.hot.sys.busy[id] ?? 0) / cores));
    const threads = Math.max(1, state.compiled.sys.threads[id] ?? 1);
    const paidUse = Math.min(1, Math.max(0, (state.hot.sys.active[id * 4] ?? 0) / threads));
    const fa = figures(a, u), fb = figures(b, u);
    if (ref.slot.kind === 'psu') return psuEffect(state, id, a, b, fa.psu, fb.psu, price, cost);
    const [field, unit, isRate] = key;
    const fixed = !u.levels.system;
    const demand = isRate ? 1 : use;
    const wa = fixed ? PRE_SYSTEM_CPU_W : fa.idle + fa.load * demand, wb = fixed ? PRE_SYSTEM_CPU_W : fb.idle + fb.load * demand;
    const inputA = fixed ? wa : wa + supplyLossW(wa, fa.psu, state.compiled.sys.psuLoss[id] ?? 0);
    const inputB = fixed ? wb : wb + supplyLossW(wb, fb.psu, state.compiled.sys.psuLoss[id] ?? 0);
    const pipe = state.compiled.sys.pipeSpeed[id] ?? 0;
    const scale = state.round.reports.length ? paidWorkScale(state) : paidUse;
    const gain = isRate && cpuMarketKnown(state) ? (Math.min(fb.rate + fb.gpu, pipe) - Math.min(fa.rate + fa.gpu, pipe)) * scale : null;
    const rack = state.build.systems[id]!.rack, heat = isRate ? researchRackHeat(state, rack, { id, profile: fb.work }) : 0;
    const cooling = state.compiled.rack.coolerQc[rack] ?? 0;
    const warning = state.compiled.rack.opened[rack] === 1 && heat > cooling
      ? { researchCooling: { rack, heatW: viewW(heat), capacityW: viewW(cooling) } } : {};
    const estimate = isRate ? { marketEstimate: true, researchOpsBefore: fa.work.researchRate, researchOpsAfter: fb.work.researchRate, ...warning } : {};
    const energy = isRate ? workEnergyChange(state, id, fb.work, Math.min(fb.rate + fb.gpu, pipe)) : undefined;
    if (total) {
      const t = { ...preview(fa[field], fb[field], unit, inputA, inputB, price, cost, gain, energy), ...estimate };
      return ref.slot.kind === 'ram' ? { ...t, throughputBefore: fa.ramBw, throughputAfter: fb.ramBw }
        : ref.slot.kind === 'drive' ? { ...t, throughputBefore: fa.io, throughputAfter: fb.io } : t;
    }
    if (OWN_VALUE.has(ref.slot.kind)) {
      const effect = { ...preview(ownValue(state.build, ref), ownValue(after, ref), unit, inputA, inputB, price, cost, gain, energy), ...estimate };
      if (ref.slot.kind === 'ram' || ref.slot.kind === 'drive') {
        const pa = readPart(state.build, ref), pb = readPart(after, ref), row = PARTS[ref.slot.kind === 'ram' ? 'ram' : 'storage'];
        if (pb) return { ...effect, throughputBefore: pa ? capacity2(row, pa.gen, pa.level) : 0, throughputAfter: capacity2(row, pb.gen, pb.level) };
      }
      return effect;
    }
    return { ...preview(fa[field], fb[field], unit, inputA, inputB, price, cost, gain, energy), ...estimate };
  }
  const pa = readPart(state.build, ref), pb = readPart(after, ref);
  // An optional D31 part may be installed into an empty slot: it starts from nothing.
  if (!pb || !isLeveled(pb.id) || (!pa && !POWER_SLOTS.includes(ref.slot.kind))) return null;
  // D31 start controllers have no capacity: their levels shorten the wake time.
  if (pb.id === 'roomStart' || pb.id === 'globalStart') return null;
  const row = PARTS[pb.id as LeveledPartId];
  const unit: CapacityUnit = pb.id === 'powerCtl' ? 'J' : pb.id === 'generation' || row.watts.kind === 'supply' || row.watts.kind === 'cooler' ? 'W' : 'tasks/s';
  const wa = pa ? partWatts(row, pa.gen, pa.level).idle : 0, wb = partWatts(row, pb.gen, pb.level).idle;
  return preview(pa ? capacity(row, pa.gen, pa.level) : 0, capacity(row, pb.gen, pb.level), unit, wa, wb, price, cost, null);
}
