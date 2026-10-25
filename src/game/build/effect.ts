import { amount } from '../amount';
import { allocCompiled } from '../core/buffers';
import { DT_S, MAX_ACCELS, REGIONS } from '../core/constants';
import type { BuildState, SystemSpec } from '../types/build';
import { REGION_IDS } from '../types/catalog';
import { rackId, systemId, type PartRef } from '../types/ids';
import type { CapacityUnit, EffectPreview } from '../types/quotes';
import type { GameState, Unlocks } from '../types/state';
import { capacity, isLeveled, partWatts, PARTS, type LeveledPartId } from './catalog';
import { compileSystem } from './compile';
import { readPart } from './partAccess';
import { installedGpuStats } from './gpu';
import type { AccelBuild } from '../types/gpu';

/**
 * Upgrade-versus-replace preview (spec §12.4): capacity before and after, watts at the current
 * utilization, energy cost change per minute, and payback = price / net gain per second. Gain is
 * the extra rate the part adds at the current load (1 Credit per unit of work, D2) minus the
 * extra energy; null means "No payback at this load".
 */
interface SysFigures { rate: number; mem: number; cache: number; gpu: number; store: number; psu: number; slots: number; idle: number; load: number }

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
    rate: c.threadRate[0]! * c.cores[0]! * c.etaCfg[0]!, mem: c.memCap[0]!, cache: c.cacheBits[0]!, gpu: c.gpuOps[0]!,
    store: c.storageCap[0]!, psu: c.psuCapW[0]!, slots: c.slots[0]!, idle, load,
  };
}

const CAPACITY: Record<string, [keyof SysFigures, CapacityUnit, boolean]> = {
  cpu: ['rate', 'ops/s', true], core: ['rate', 'ops/s', true], clock: ['rate', 'ops/s', true],
  l1: ['cache', 'bits', false], l2: ['cache', 'bits', false], l3: ['cache', 'bits', false], scheduler: ['slots', 'slots', false],
  ram: ['mem', 'bits', false], gpu: ['gpu', 'ops/s', true], npu: ['gpu', 'ops/s', true], drive: ['store', 'bits', false], psu: ['psu', 'W', false],
};

/** Credits per joule where a unit sits (spec §9.6). */
export function energyPrice(state: GameState, ref: PartRef): number {
  const b = state.build;
  const unit = ref.unit;
  const siteId = unit.kind === 'system' ? b.rooms[b.racks[b.systems[unit.id]?.rack ?? 0]?.room ?? 0]?.site
    : unit.kind === 'rack' ? b.rooms[b.racks[unit.id]?.room ?? 0]?.site : unit.kind === 'room' ? b.rooms[unit.id]?.site : unit.kind === 'site' ? unit.id : 0;
  const region = b.sites[siteId ?? 0]?.region ?? 'us-east';
  return REGIONS[REGION_IDS.indexOf(region)]!.energyPrice;
}

const perMinute = (watts: number, price: number) => amount(Math.round(watts * 60 * price));

const cardFigures = (card: AccelBuild | undefined, u: Unlocks): { rate: number; idle: number; load: number } => {
  if (!card) return { rate: 0, idle: 0, load: 0 };
  if (card.kind === 'gpu') {
    const stats = installedGpuStats(card, u);
    return { rate: stats.opsPerS, idle: stats.idleW, load: stats.loadW };
  }
  const watts = partWatts(PARTS.npu, card.gen, card.level);
  return { rate: capacity(PARTS.npu, card.gen, card.level) * PARTS.npu.tensorFactor![card.gen]!, ...watts };
};

export function preview(before: number, after: number, unit: CapacityUnit, wBefore: number, wAfter: number, price: number, cost: bigint, rateGain: number | null): EffectPreview {
  const energyDelta = (wAfter - wBefore) * price;
  const gain = rateGain === null ? null : rateGain - energyDelta;
  return {
    capacityBefore: before, capacityAfter: after, unit, wattsBefore: wBefore, wattsAfter: wAfter,
    energyPerMinuteDelta: perMinute(wAfter - wBefore, price),
    paybackS: gain !== null && gain > 0 ? Number(cost) / gain : null,
  };
}

/** Preview of a part change already applied in `after` (same system or infra unit). */
export function partEffect(state: GameState, ref: PartRef, after: BuildState, cost: bigint): EffectPreview | null {
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
      const use = Math.min(1, Math.max(0, ((state.hot.sys.accelTaskS[at] ?? 0) + (state.hot.sys.accelResearchS[at] ?? 0)) / DT_S));
      const before = cardFigures(a.accels[slot], u), afterCard = cardFigures(b.accels[slot], u);
      return preview(before.rate, afterCard.rate, 'ops/s', before.idle + before.load * use,
        afterCard.idle + afterCard.load * use, price, cost, (afterCard.rate - before.rate) * use);
    }
    const cores = Math.max(1, state.compiled.sys.cores[id] ?? 1);
    const use = Math.min(1, Math.max(0, (state.hot.sys.busy[id] ?? 0) / cores));
    const fa = figures(a, u), fb = figures(b, u);
    const [field, unit, isRate] = key;
    const wa = fa.idle + fa.load * use, wb = fb.idle + fb.load * use;
    return preview(fa[field], fb[field], unit, wa, wb, price, cost, isRate ? (fb[field] - fa[field]) * use : null);
  }
  const pa = readPart(state.build, ref), pb = readPart(after, ref);
  if (!pa || !pb || !isLeveled(pa.id)) return null;
  const row = PARTS[pa.id as LeveledPartId];
  const unit: CapacityUnit = row.watts.kind === 'supply' || row.watts.kind === 'cooler' ? 'W' : 'tasks/s';
  const wa = partWatts(row, pa.gen, pa.level).idle, wb = partWatts(row, pb.gen, pb.level).idle;
  return preview(capacity(row, pa.gen, pa.level), capacity(row, pb.gen, pb.level), unit, wa, wb, price, cost, null);
}
