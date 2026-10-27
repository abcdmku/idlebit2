import { supplyPreparation, supplyResearch } from '../build/supplyRecovery';
import { marketResearchCpuEnergy } from '../build/researchEnergy';
import { POWER_SCALE } from '../core/constants';
import { capacity } from '../build/catalog/curves';
import { amountCompare, amountToNumber } from '../amount';
import {
  applyAction, quote, rackId, REGIONS, roomId, selectMarketQueue, selectResearchTree, systemId,
  type GameAction, type GameState, type MeetNeed, type Quote, type QuoteRequest, type ResearchNodeView, type ScopeRef,
} from '../index';
import { MAX_UPS } from '../core/constants';
import { rqLen, rqLevel, rqRow } from '../core/routerQueue';
import { energyRatio, LADDERS, ladderSpeed, PARTS, portSpeedPrice, ratedRate } from '../build/catalog';
import { researchDef } from '../build/research/tree';
import { deepestCState } from '../build/settings';
import { fullSystemEnergy, marketGain, paidCapacity, paidWorkScale, researchEnergy, researchRackHeat } from '../build/workloadValue';
import type { GpuGeneration } from '../types/gpu';
import type { Policy } from './policies';

function ratePurchase(_state: GameState, q: Quote): boolean {
  return cpuTarget(q.action) !== null || q.action.type === 'upgradePort' || q.action.type === 'addUnit'
    || !!q.gpu?.before || ramTarget(q.action) !== null && q.effect?.unit === 'bit/s';
}

function fundedScore(state: GameState, q: Quote): number | null {
  return score(q.affordable ? state : { ...state, wallet: { ...state.wallet, credits: q.cost } }, q);
}

function configurePowerModes(state: GameState, log: BotEvent[]): GameState {
  let s = state;
  const limit = deepestCState(s), losing = BigInt(s.round.reports.at(-1)?.net ?? '0') < 0n;
  for (const id of firstIds(s.build.systems, 64)) {
    const spec = s.build.systems[id]!.spec, system = systemId(id);
    const actions: GameAction[] = [];
    if (spec.settings.cStateLimit !== limit) actions.push({ type: 'setCStateLimit', system, limit });
    if (losing && s.research.unlocks.rules.includes('dvfs') && !spec.settings.dvfs)
      actions.push({ type: 'setSystemSetting', system, setting: 'dvfs', on: true });
    for (const action of actions) {
      const next = tryAction(s, action);
      if (next) { log.push({ tick: s.clock.tick, kind: 'configure', label: action.type, cost: '0' }); s = next; }
    }
  }
  if (losing && s.round.phase !== 'running' && !canFinishResearch(s)) {
    const ids = firstIds(s.build.systems, 64).filter(id => s.build.systems[id]!.online);
    const minGen = Math.min(...ids.map(id => (s.build.systems[id]!.spec.cpu?.cpu.gen ?? 0)));
    const expensive = ids.filter(id => ((s.build.systems[id]!.spec.cpu?.cpu.gen ?? 0)) > minGen)
      .sort((a, b) => fullSystemEnergy(s, b) - fullSystemEnergy(s, a))[0];
    if (expensive !== undefined) {
      const next = tryAction(s, { type: 'setOnline', unit: { kind: 'system', id: systemId(expensive) }, online: false });
      if (next) { log.push({ tick: s.clock.tick, kind: 'configure', label: `Offline system ${expensive + 1} after operating loss`, cost: '0' }); s = next; }
    }
  }
  return s;
}

function cpuNeedsCooling(state: GameState, rack: number): boolean {
  return sampleSystems(state).some(id => {
    if (state.build.systems[id]?.rack !== rack) return false;
    const q = quote(state, { kind: 'tray', at: {level:'chip', id:systemId(id)} }).quotes.find(q => q.action.type === 'replaceCpu');
    return q && !q.locked && q.affordable && q.effect?.researchCooling && score(state, q) !== null;
  });
}

function cpuNeedsSupply(state: GameState, system: number, part: 'psu' | 'pdu' | 'ups' = 'psu'): boolean {
  const q = quote(state, {kind:'tray',at:{level:'chip',id:systemId(system)}}).quotes.find(q => q.action.type === 'replaceCpu');
  if (!q || q.locked || !q.affordable || q.overSupply?.part !== part) return false;
  const payback = score(state, q);
  const researchBoost = state.research.active !== null && q.effect?.researchOpsBefore !== undefined && q.effect.researchOpsAfter !== undefined
    && q.effect.researchOpsAfter >= 8 * Math.max(1, q.effect.researchOpsBefore) && Number(q.cost) <= Number(state.wallet.credits) / 3;
  // The overloaded supply inflates the counterfactual energy bill. A budgeted research-speed
  // investment may need that supply repaired before its final completion budget can be quoted.
  return researchBoost || payback !== null && (payback <= CPU_SAVE_PAYBACK_S || Number(q.cost) <= Number(state.wallet.credits) / 2);
}

/**
 * The balance bot. It plays only through the public barrel: quotes say what can be bought and
 * at what price, actions buy it. It reads `state` only to find units and empty slots to ask about.
 */

export interface BotEvent {
  readonly tick: number;
  readonly kind: 'buy' | 'research' | 'return' | 'configure';
  readonly label: string;
  readonly cost: string;
  readonly creditCost?: string;
  /** Wait for a complete paid round before making another CPU-capacity investment after Rack. */
  readonly researchCapacityAdded?: boolean;
  readonly psu?: {
    readonly system: number;
    readonly replacement: boolean;
    readonly capacityBeforeW: number;
    readonly capacityAfterW: number;
    readonly lossBefore: number;
    readonly lossAfter: number;
  };
}

/** Research that opens a level or a structural step comes first (docs/research.md milestones). */
const MILESTONES = ['systemBoard', 'fabKhz', 'rack', 'fabMhz', 'room', 'fabGhz', 'dataCenter', 'regions'];
/** Systems, racks and rooms the bot asks quotes for per decision. */
const SAMPLE = 4;

const firstIds = <T>(list: readonly (T | null)[], n: number): number[] => {
  const out: number[] = [];
  for (let i = 0; i < list.length && out.length < n; i += 1) if (list[i] !== null) out.push(i);
  return out;
};

/** Compute rate of a system as the quote previews count it: threads × cores × configuration efficiency. */
const computeRate = (state: GameState, id: number): number => {
  const c = state.compiled.sys;
  return (c.threadRate[id] ?? 0) * (c.cores[id] ?? 0) * (c.etaCfg[id] ?? 1);
};
/** Credits per joule at the home region (spec §9.6); payback counts energy at this price. */
const ENERGY_PRICE = REGIONS[0]!.energyPrice;
/** Full-load watts of a system's CPU, RAM, drives and accelerators (compiled at clock factor 1). */
function fullLoadW(state: GameState, id: number): { idle: number; load: number } {
  const c = state.compiled.sys;
  let idle = c.coreIdleW[id]! + c.clockIdleW[id]!, load = c.coreLoadW[id]!;
  for (let r = 0; r < 4; r += 1) { idle += c.idleW[id * 4 + r]!; load += c.loadW[id * 4 + r]!; }
  return { idle, load };
}
/** Existing hardware at the measured workload. Used only to rank systems and copy the same build. */
const carried = (state: GameState, id: number): number => {
  if (!state.build.systems[id]?.online) return 0;
  const r = state.round.reports.at(-1);
  let energy = 0;
  state.build.systems.forEach((s, n) => { if (s?.online) energy += fullSystemEnergy(state, n); });
  const duty = r && r.durationTicks > 0 && energy > 0 ? Math.min(1, Number(r.energy) / (r.durationTicks / 10) / energy) : 1;
  return paidCapacity(state, id) * paidWorkScale(state) - fullSystemEnergy(state, id) * duty;
};
/** Gate budgets use earned net income. Counterfactual purchases use marketGain, never a recalibrated ledger. */
export const income = (state: GameState): number => {
  const r = state.round.reports.at(-1);
  return r && r.durationTicks > 0 ? amountToNumber(r.net) / (r.durationTicks / 10)
    : state.build.systems.reduce((sum, s, id) => sum + (s === null ? 0 : carried(state, id)), 0);
};

/** Current round's gross Credits/s, then the last round or the opening capacity estimate. */
function grossRate(state: GameState): number {
  const elapsedS = (state.clock.tick - state.round.startTick) / 10;
  if (state.round.phase === 'running' && elapsedS > 0 && Number(state.round.gross) > 0)
    return Number(state.round.gross) / elapsedS;
  const r = state.round.reports.at(-1);
  return r && r.durationTicks > 0 ? amountToNumber(r.gross) / (r.durationTicks / 10) : Math.max(1, income(state));
}

/** Full-load watts of a rack's servers against its PDU capacity (opened racks only). */
function rackLoad(state: GameState, rack: number): { loadW: number; capW: number; perServerW: number } {
  const ids = (state.build.racks[rack]?.servers ?? []).filter((s): s is NonNullable<typeof s> => s !== null);
  let loadW = 0, top = 0;
  for (const id of ids) { const w = fullLoadW(state, id); loadW += w.idle + w.load; top = Math.max(top, w.idle + w.load); }
  return { loadW, capW: state.compiled.rack.pduCapW[rack] ?? 0, perServerW: top };
}
/** A server may join a rack only with a free switch port and PDU headroom for one more at full load. */
const PDU_HEADROOM = 0.9;
function rackHasRoom(state: GameState, rack: number): { port: boolean; power: boolean } {
  const r = state.build.racks[rack];
  if (!r) return { port: false, power: false };
  const servers = r.servers.filter((s) => s !== null).length;
  const { loadW, capW, perServerW } = rackLoad(state, rack);
  return { port: servers < r.switch.ports.length, power: loadW + perServerW <= PDU_HEADROOM * capW };
}

/** The systems the bot looks at: the weakest first, so a rack is upgraded evenly. */
function sampleSystems(state: GameState): number[] {
  const ids = state.build.systems.flatMap((s, id) => (s === null ? [] : [id]));
  const eccWall = lastFailedOn(state, ['ecc']);
  return ids.sort((a, b) => (eccWall ? (state.compiled.sys.ecc[a] ?? 0) - (state.compiled.sys.ecc[b] ?? 0) : 0)
    || carried(state, a) - carried(state, b) || a - b).slice(0, SAMPLE);
}

/** Native price of the cheapest generation-1 model; each generation costs 10× (spec §12.6). */
const GPU_ENTRY_PRICE = 1e6;
function newestGpuGeneration(state: GameState): GpuGeneration | null {
  for (let g = 9; g >= 1; g -= 1) if (state.research.unlocks.gens.gpu & (1 << (g - 1))) return g as GpuGeneration;
  return null;
}

/** The quote requests the bot looks at: trays at every opened level, and the first empty slot of each container. */
export function candidateRequests(state: GameState, need: MeetNeed = {}): QuoteRequest[] {
  const { build } = state;
  const levels = state.research.unlocks.levels;
  const reqs: QuoteRequest[] = [];
  const gpuGen = newestGpuGeneration(state);
  sampleSystems(state).forEach((id, n) => {
    reqs.push({ kind: 'tray', at: {level:'chip', id:systemId(id)} });
    reqs.push({ kind: 'part', part: { unit: { kind: 'system', id: systemId(id) }, slot: { kind: 'scheduler' } } });
    if (Object.keys(need).length) reqs.push({ kind: 'meet', system: systemId(id), need });
    if (levels.rack) reqs.push({ kind: 'pipe', system: systemId(id) });
    if (!levels.system) return;
    const system = systemId(id), spec = build.systems[id]!.spec;
    reqs.push({ kind: 'tray', at: { level: 'system', id: system } });
    reqs.push({ kind: 'part', part: { unit: { kind: 'system', id: system }, slot: { kind: 'psu' } } });
    reqs.push({ kind: 'part', part: { unit: { kind: 'system', id: system }, slot: { kind: 'cpu', socket: 0 } } });
    spec.ram.forEach((_, index) => reqs.push({ kind: 'part', part: { unit: { kind: 'system', id: system }, slot: { kind: 'ram', index } } }));
    if (spec.ram.length === 0) reqs.push({ kind: 'part', part: { unit: { kind: 'system', id: system }, slot: { kind: 'ram', index: 0 } } });
    spec.drives.forEach((_, index) => reqs.push({ kind: 'part', part: { unit: { kind: 'system', id: system }, slot: { kind: 'drive', index } } }));
    if (lastFailedOn(state, ['ecc']) && state.compiled.sys.ecc[id] !== 1)
      reqs.push({ kind: 'meet', system, need: { ecc: true } });
    const cards = spec.accels.flatMap((card, index) => (card.kind === 'gpu' ? [index] : []));
    for (const index of cards) reqs.push({ kind: 'part', part: { unit: { kind: 'system', id: system }, slot: { kind: 'gpu', index } } });
    // A model catalog quotes every model with a full-load power preview, which is costly: ask only
    // for affordable unlocked generations, on the weakest system, between rounds.
    if (state.round.phase !== 'running' && n === 0 && gpuGen !== null && amountToNumber(state.wallet.credits) >= GPU_ENTRY_PRICE) {
      for (let generation = 1; generation <= gpuGen; generation += 1) {
        if ((state.research.unlocks.gens.gpu & (1 << (generation - 1))) === 0 || Number(state.wallet.credits) < GPU_ENTRY_PRICE * 10 ** (generation - 1)) continue;
        for (const index of [null, ...cards.slice(0, 1)]) reqs.push({ kind: 'gpuModels', system, index, generation: generation as GpuGeneration });
      }
    }
  });
  if (levels.rack) {
    for (const id of firstIds(build.racks, SAMPLE)) {
      const rack = build.racks[id]!;
      reqs.push({ kind: 'tray', at: { level: 'rack', id: rackId(id) } });
      reqs.push({ kind: 'switch', sw: { kind: 'rack', id: rackId(id) } });
      // D31: Power control (battery and smart start) in the fifth slot.
      reqs.push({ kind: 'infra', unit: { kind: 'rack', id: rackId(id) }, slot: 'powerCtl' });
      reqs.push({ kind: 'routerQueue', unit: { kind: 'rack', id: rackId(id) } });
      const slot = rack.servers.indexOf(null);
      if (slot >= 0) reqs.push({ kind: 'add', parent: { kind: 'rack', id: rackId(id) }, slot });
    }
  }
  if (levels.room) {
    for (const id of firstIds(build.rooms, SAMPLE)) {
      const room = build.rooms[id]!;
      reqs.push({ kind: 'tray', at: { level: 'room', id: roomId(id) } });
      const slot = room.racks.indexOf(null);
      if (slot >= 0) reqs.push({ kind: 'add', parent: { kind: 'room', id: roomId(id) }, slot });
    }
  }
  if (levels.global) reqs.push({ kind: 'tray', at: { level: 'global', id: 0 } });
  return reqs;
}

const CPU_RATE_SLOTS = new Set(['core', 'clock', 'cpu']);

/** The system whose RAM an upgrade or added module changes, or null. */
function ramTarget(a: GameAction): number | null {
  if (a.type === 'addPart' && a.kind === 'ram') return a.system;
  if ((a.type === 'upgradePart' || a.type === 'upgradePartTo' || a.type === 'replacePart') && a.part.unit.kind === 'system' && a.part.slot.kind === 'ram') return a.part.unit.id;
  return null;
}

/** The system whose CPU compute an action changes, or null. */
function cpuTarget(a: GameAction): number | null {
  if (a.type === 'replaceCpu') return a.system;
  if (a.type === 'addPart' && (a.kind === 'core' || a.kind === 'socket')) return a.system;
  if ((a.type === 'upgradePart' || a.type === 'replacePart') && a.part.unit.kind === 'system' && CPU_RATE_SLOTS.has(a.part.slot.kind)) return a.part.unit.id;
  return null;
}

/** A sensible player fills a rack or room by copying a working sibling, not with barebones parts. */
function hasSibling(state: GameState, parent: ScopeRef): boolean {
  const b = state.build;
  if (parent.kind === 'rack') return (b.racks[parent.id]?.servers ?? []).some((s) => s !== null);
  if (parent.kind === 'room') return (b.rooms[parent.id]?.racks ?? []).some((r) => r !== null);
  return false;
}

/**
 * D31: Power control pays back in round-start energy its battery covers, billed instead at 25% at Return:
 * per round, min(capacity, the rack's draw over the opening) × 0.75 × the price, over the round's length.
 * Returns undefined for other actions, null when it carries nothing.
 */
const OPENING_S = 120;
function powerCtlScore(state: GameState, a: GameAction, cost: number): number | null | undefined {
  if ((a.type !== 'replacePart' && a.type !== 'upgradePart') || a.part.slot.kind !== 'powerCtl' || a.part.unit.kind !== 'rack') return undefined;
  const r = a.part.unit.id, next = tryAction(state, a);
  const cap = (s: GameState | null) => { const ctl = s?.build.racks[r]?.powerCtl; return ctl ? capacity(PARTS.powerCtl, ctl.gen, ctl.level) : 0; };
  const last = state.round.reports.at(-1);
  if (!next || !last || last.durationTicks <= 0) return null;
  const servers = state.build.racks[r]?.servers.filter((x) => x !== null).length ?? 0;
  if (servers < 2) return null;
  const drawW = Math.max(state.hot.rack.drawW[r] ?? 0, amountToNumber(last.energy) / (last.durationTicks / 10) / ENERGY_PRICE);
  const covered = (s: GameState | null) => Math.min(cap(s), drawW * OPENING_S);
  const gain = (covered(next) - covered(state)) * 0.75 * ENERGY_PRICE / (last.durationTicks / 10);
  return gain > 0 ? cost / gain : null;
}
/** A newly installed Power control starts one server and wakes the rest after a 2 s head wait. */
function configurePowerCtl(state: GameState): GameState {
  let s = state;
  for (const id of firstIds(s.build.racks, SAMPLE)) {
    const ctl = s.build.racks[id]!.powerCtl;
    if (!ctl || ctl.startWith !== 1 || ctl.trigger.headWaitS !== 2 || ctl.order === 'fastest') continue;
    s = tryAction(s, { type: 'setStartConfig', unit: { kind: 'rack', id: rackId(id) }, startWith: 1, headWaitS: 2, busyPct: ctl.gen >= 1 ? 75 : null, order: 'fastest' }) ?? s;
  }
  return s;
}

/** D36: GPU quote stats back at the sim scale. */
const simGpu = <T extends { idleW: number; loadW: number }>(g: T): T => ({ ...g, idleW: g.idleW / POWER_SCALE, loadW: g.loadW / POWER_SCALE });

/** A gate costing one second of income ranks like a rate part that pays back in this many seconds. */
const GATE_PAYBACK_S = 20;

/**
 * Lower is better: seconds to pay back from the extra income a purchase carries (1 Credit per op).
 * Compute, ports and new servers count only what their pipe carries, so a pipe-bound system buys
 * no compute. Null = it carries nothing more. Gates (cache, RAM, PSU, drives, coolers, the first
 * GPU) carry no rate; they are priced against current income, so cheap gates come early.
 */
export function score(state: GameState, q: Quote): number | null {
  const cost = amountToNumber(q.cost);
  const a = q.action;
  const battery = powerCtlScore(state, a, cost);
  if (battery !== undefined) return battery;
  const rate = cpuTarget(a) !== null || a.type === 'upgradePort' || a.type === 'addUnit';
  if (a.type === 'addUnit' && a.source.kind === 'barebones' && hasSibling(state, a.parent)) return null;
  if (a.type === 'addUnit' && a.parent.kind === 'rack') {
    const room = rackHasRoom(state, a.parent.id);
    if (!room.port || !room.power) return null;
  }
  if (a.type === 'addPorts') {
    // A port is the gate for one more server: wanted when the rack has a free slot and every port is taken.
    const r = a.sw.kind === 'rack' ? state.build.racks[a.sw.id] : null;
    if (!r || !r.servers.includes(null) || r.servers.filter((s) => s !== null).length < r.switch.ports.length) return null;
    return GATE_PAYBACK_S * cost / Math.max(1, grossRate(state));
  }
  if (a.type === 'upgradeRouterQueue') {
    // D25.7: a deeper queue only helps when entries wait in it and heads still time out.
    if (a.unit.kind !== 'rack') return null;
    // A queue deeper than two entries per server only holds work the rack can't start.
    const servers = state.build.racks[a.unit.id]?.servers.filter((x) => x !== null).length ?? 0;
    if (servers < 2 || rqLevel(state.compiled, 0, a.unit.id) >= 2 * servers) return null;
    const full = rqLen(state.hot, rqRow(state.hot, 0, a.unit.id)) >= rqLevel(state.compiled, 0, a.unit.id);
    const last = state.round.reports.at(-1);
    if (!full || !last || last.failedByCause.timeout === 0) return null;
    return GATE_PAYBACK_S * cost / Math.max(1, grossRate(state));
  }
  if (a.type === 'addUnit' && a.source.kind === 'copy' && a.source.from.kind === 'system') {
    // A copied server lands on a default port; a player steps that port to the original's speed.
    const from = a.source.from.id, pipe = state.compiled.sys.pipeSpeed[from] ?? 0;
    const gain = carried(state, from);
    const base = ladderSpeed(LADDERS.switch.baseK[0]!);
    const market = gain > 0 && pipe > 0 ? (cost + (pipe > base ? Number(portSpeedPrice(base, pipe, 1)) : 0)) / gain : null;
    const next = tryAction(state, a);
    return market !== null && market <= CPU_SAVE_PAYBACK_S ? market : next ? researchInvestment(state, next, cost) : null;
  }
  if (a.type === 'addUnit' && a.source.kind === 'copy' && a.source.from.kind === 'rack') {
    const source = state.build.racks[a.source.from.id];
    const gain = source?.servers.reduce((sum, id) => sum + (id === null ? 0 : carried(state, id)), 0) ?? 0;
    return gain > 0 && cost / gain <= CPU_SAVE_PAYBACK_S ? cost / gain : null;
  }
  // RAM bandwidth carries every task's memory traffic (D26): a player keeps it up with the cores, like a clock.
  const ramSys = ramTarget(a);
  if (ramSys !== null) {
    const c = state.compiled.sys, need = Math.min(Math.max(computeRate(state, ramSys), c.gpuOps[ramSys] ?? 0), c.pipeSpeed[ramSys] ?? Infinity), before = c.ramBw[ramSys] ?? 0;
    if (before < need && !ramPastRatio(state, a)) {
      const next = tryAction(state, a);
      const gain = next ? Math.min(need, next.compiled.sys.ramBw[ramSys] ?? 0) - before : 0;
      if (gain > 0) return cost / gain;
    }
  }
  if (rate) {
    const next = tryAction(state, a);
    const target = cpuTarget(a);
    // The first native kHz package opens the hardware era, like the first GPU; its
    // benefit is a progression gate, not a mixed-workload income prediction.
    if (next && target !== null && (state.build.systems[target]?.spec.cpu ? state.build.systems[target]!.spec.cpu!.cpu.gen : -1) === 0
      && (next.build.systems[target]?.spec.cpu ? next.build.systems[target]!.spec.cpu!.cpu.gen : -1) === 1) return GATE_PAYBACK_S * cost / Math.max(1, grossRate(state));
    // hardware-progression.md §3: a player stops pushing a CPU whose energy ratio falls under CPU_MIN_RATIO.
    if (next && target !== null && coreRatio(next, target) < CPU_MIN_RATIO && coreRatio(next, target) < coreRatio(state, target)) return null;
    // Before Rack, capacity is a purchase-ranking heuristic, not a player-facing earnings forecast.
    // Keep its physical-efficiency and four-hour investment bounds; later CPU buys need measured or research value.
    const gain = next ? marketGain(state, next, !state.research.unlocks.levels.rack) : 0;
    const market = gain > 0 && cost / gain <= CPU_SAVE_PAYBACK_S ? cost / gain : null;
    const newCpu = a.type === 'addUnit' && a.parent.kind === 'rack';
    return market ?? (next && (target !== null || newCpu) ? researchInvestment(state, next, cost) : null);
  }
  if (q.gpu) {
    // The first card opens the GPU band, a gate. Later cards and upgrades must pay back from the
    // net ops their pipe carries, after their energy (u5 cards run near break-even, D8).
    const sys = a.type === 'installGpu' ? a.system : (a.type === 'upgradePart' || a.type === 'replacePart') && a.part.unit.kind === 'system' ? a.part.unit.id : -1;
    const first = sys >= 0 && !state.build.systems[sys]?.spec.accels.some((c) => c.kind === 'gpu');
    if (first) return supplyNeeded(state, a) ? GATE_PAYBACK_S * cost / Math.max(1, income(state)) : null;
    // A new card or a later generation is a gate when the last round failed on VRAM or GPU cores.
    // A tier up must pay back as rate.
    // D36: quote watts are at the view scale; the bot compares them with sim prices and capacities.
    const before = q.gpu.before && simGpu(q.gpu.before), after = simGpu(q.gpu.after);
    const bigger = a.type === 'installGpu'
      && (after.vramBits > (before?.vramBits ?? 0) || after.cores > (before?.cores ?? 0))
      && after.opsPerS > 2 * ENERGY_PRICE * (after.idleW + after.loadW);
    if (bigger && lastFailedOn(state, ['vram', 'gpuCores']) && supplyNeeded(state, a)) return GATE_PAYBACK_S * cost / Math.max(1, income(state));
    const next = tryAction(state, a);
    const gain = next ? marketGain(state, next) : 0;
    return gain > 0 && cost / gain <= CPU_SAVE_PAYBACK_S ? cost / gain : null;
  }
  if (!supplyNeeded(state, a)) {
    // A more efficient PSU pays back in energy saved, like a rate part.
    if (!isPsu(a)) return null;
    const next = tryAction(state, a);
    const gain = next ? marketGain(state, next) : 0;
    return gain > 0 ? cost / gain : null;
  }
  if (!gateNeeded(state, a, cost)) return null;
  return GATE_PAYBACK_S * cost / Math.max(1, income(state));
}
const isPsu = (a: GameAction): boolean => (a.type === 'upgradePart' || a.type === 'replacePart') && a.part.slot.kind === 'psu';

/** The failure detail a capacity gate answers (cache, RAM, drives, GPU), or null. */
function gateDetail(a: GameAction): readonly string[] | null {
  const kind = a.type === 'upgradePart' || a.type === 'replacePart' ? a.part.slot.kind
    : a.type === 'addPart' ? a.kind : a.type === 'upgradeAll' ? a.kind : a.type === 'installGpu' ? 'gpu' : null;
  switch (kind) {

    // D26: a box with no RAM reports cache; RAM or a drive answers a RAM wall; RAM answers spill.
    case 'ram': return ['cache', 'ram', 'disk'];
    case 'drive': return ['ram', 'disk'];
    case 'gpu': return ['gpu', 'vram', 'gpuCores'];
    default: return null;
  }
}
/** A gate costing this many seconds of income or less is bought freely; dearer ones only for a named failure. */
const CHEAP_GATE_S = 60;
/** Capacity gates are bought when cheap, or when the last round failed on what they answer. */
function gateNeeded(state: GameState, a: GameAction, cost: number): boolean {
  const details = gateDetail(a);
  if (ramPastRatio(state, a)) return false;
  // Drive levels raise IO watts for spill traffic: bought only for a named wall, never just because they are cheap.
  if (!details || (cost <= CHEAP_GATE_S * Math.max(1, income(state)) && !details.includes('disk'))) return true;
  return lastFailedOn(state, details);
}
/**
 * A RAM level whose energy ratio would fall below RAM_MIN_RATIO (hardware-progression.md §3) costs more to
 * run than its capacity is worth: a player adds a module or a newer generation instead.
 */
const RAM_MIN_RATIO = 2.5;
/** The cores' energy ratio: ops per second against their full-use Credits per second at the reference price. */
const CPU_MIN_RATIO = 2;
function coreRatio(state: GameState, id: number): number {
  const c = state.compiled.sys, w = (c.coreIdleW[id] ?? 0) + (c.coreLoadW[id] ?? 0);
  return w > 0 ? computeRate(state, id) / (0.01 * w) : Infinity;
}
function ramPastRatio(state: GameState, a: GameAction): boolean {
  if ((a.type !== 'upgradePart' && a.type !== 'upgradePartTo') || a.part.unit.kind !== 'system' || a.part.slot.kind !== 'ram') return false;
  const m = state.build.systems[a.part.unit.id]?.spec.ram[a.part.slot.index];
  if (!m) return false;
  const era = (PARTS.ram.watts as { era: readonly number[] }).era[m.gen] ?? 0;
  return energyRatio(era, ratedRate(PARTS.ram, m.gen, 1), ratedRate(PARTS.ram, m.gen, a.type === 'upgradePartTo' ? a.level : m.level + 1)) < RAM_MIN_RATIO;
}
/** The action answers a failure detail of one of the last few rounds. */
function answersRecentWall(state: GameState, a: GameAction): boolean {
  const details = gateDetail(a);
  return details !== null && state.round.reports.slice(-3).some((r) => r.details.some((d) => details.includes(d.detail)));
}
const lastFailedOn = (state: GameState, details: readonly string[]): boolean =>
  state.round.reports.at(-1)?.details.some((d) => details.includes(d.detail)) ?? false;

/** Supplies and coolers are bought when they near their limit, not because they are cheap. */
const SUPPLY_USE = 0.75, HOT_F = 85;
function supplyNeeded(state: GameState, a: GameAction): boolean {
  if (a.type !== 'upgradePart' && a.type !== 'replacePart') return true;
  const { unit, slot } = a.part, h = state.hot;
  switch (slot.kind) {
    case 'psu': return unit.kind === 'system' && ((h.sys.psuUsage[unit.id] ?? 0) > SUPPLY_USE
      || cpuNeedsSupply(state, unit.id)
      || (() => { const w = fullLoadW(state, unit.id); return w.idle + w.load > SUPPLY_USE * (state.compiled.sys.psuCapW[unit.id] ?? 0); })()
      || (state.research.unlocks.gens.gpu !== 0 && !state.build.systems[unit.id]?.spec.accels.some((c) => c.kind === 'gpu')));
    case 'pdu': return unit.kind === 'rack' && ((h.rack.pduUsage[unit.id] ?? 0) > SUPPLY_USE
      || state.research.active !== null && researchRackHeat(state, unit.id) > 0.9 * (state.compiled.rack.pduCapW[unit.id] ?? 0)
      || sampleSystems(state).some(id => state.build.systems[id]?.rack === unit.id && cpuNeedsSupply(state, id, 'pdu'))
      || (rackHasRoom(state, unit.id).port && !rackHasRoom(state, unit.id).power && (state.build.racks[unit.id]?.servers.includes(null) ?? false)));
    // Hot, or the last round lost work to heat: a player adds cooling.
    case 'rackCooler': return unit.kind === 'rack' && ((h.rack.tempF[unit.id] ?? 0) > HOT_F
      || state.research.active !== null && researchRackHeat(state, unit.id) > (state.compiled.rack.coolerQc[unit.id] ?? 0)
      || cpuNeedsCooling(state, unit.id) || (state.round.reports.at(-1)?.failedByCause.heat ?? 0) > 0);
    case 'roomCooler': return unit.kind === 'room' && (h.room.tempF[unit.id] ?? 0) > HOT_F;
    case 'ups': return unit.kind === 'room' && ((h.room.upsUsage[unit.id * MAX_UPS] ?? 0) > SUPPLY_USE
      || sampleSystems(state).some(id => state.build.racks[state.build.systems[id]!.rack]?.room === unit.id && cpuNeedsSupply(state, id, 'ups')));
    default: return true;
  }
}

/** Affordable, unlocked Credit purchases; cold ones only between rounds. */
export function buyable(state: GameState, quotes: readonly Quote[], recovery: ReadonlySet<Quote> = new Set(), includeUnaffordable = false): Quote[] {
  const running = state.round.phase === 'running';
  return quotes.filter((q) => q.currency === 'credits' && q.locked === null && (q.affordable || includeUnaffordable)
    && !q.overSupply
    && !(state.research.active !== null && q.effect?.researchCooling)
    && amountCompare(q.cost, '0') > 0 && !(running && q.cold)
    && psuImproves(state, q) && (recovery.has(q) || gpuImproves(q)) && gpuFitsSupply(state, q) && memoryImproves(state, q));
}

/** A RAM or drive purchase must keep the system's memory bandwidth (and a replacement its capacity): a new module at L1 can be 100× slower. */
function memoryImproves(state: GameState, q: Quote): boolean {
  const a = q.action;
  // RAM bandwidth is the slowest module's (compile: min over modules): adding an L1 module next to a levelled one can cut it 300×.
  const id = a.type === 'replacePart' && a.part.unit.kind === 'system' && (a.part.slot.kind === 'ram' || a.part.slot.kind === 'drive') ? a.part.unit.id
    : a.type === 'addPart' && (a.kind === 'ram' || a.kind === 'drive') ? a.system : -1;
  if (id < 0) return true;
  const next = tryAction(state, a);
  if (!next) return false;
  const b = state.compiled.sys, n = next.compiled.sys;
  if (a.type === 'addPart') return (b.ramBw[id] ?? 0) === 0 || n.ramBw[id]! >= b.ramBw[id]!;
  return n.memCap[id]! >= b.memCap[id]! && n.ramBw[id]! >= b.ramBw[id]! && n.ioRate[id]! >= b.ioRate[id]!;
}

/** Replacements must keep capacity and efficiency; level upgrades trade efficiency for capacity. */
function psuImproves(state: GameState, q: Quote): boolean {
  const a = q.action;
  if (a.type === 'replacePart' && (a.part.slot.kind === 'pdu' || a.part.slot.kind === 'ups'))
    return !!q.effect && q.effect.capacityAfter >= q.effect.capacityBefore;
  if (a.type !== 'replacePart' || a.part.unit.kind !== 'system' || a.part.slot.kind !== 'psu') return true;
  const next = tryAction(state, a);
  if (!next) return false;
  const id = a.part.unit.id, before = state.compiled.sys, after = next.compiled.sys;
  return after.psuCapW[id]! >= before.psuCapW[id]! && after.psuLoss[id]! <= before.psuLoss[id]!
    && (after.psuCapW[id]! > before.psuCapW[id]! || after.psuLoss[id]! < before.psuLoss[id]!);
}

/** Reject cards that exceed full-load supply headroom. Ask PSU quotes above. */
function gpuFitsSupply(state: GameState, q: Quote): boolean {
  if (!q.gpu) return true;
  const id = q.action.type === 'installGpu' ? q.action.system
    : q.action.type === 'upgradePart' && q.action.part.unit.kind === 'system' ? q.action.part.unit.id : null;
  if (id === null) return true;
  const c = state.compiled.sys;
  const fullW = c.coreIdleW[id]! + c.coreLoadW[id]! + c.clockIdleW[id]!
    + [0, 1, 2, 3].reduce((n, resource) => n + c.idleW[id * 4 + resource]! + c.loadW[id * 4 + resource]!, 0);
  const beforeW = q.gpu.before ? (q.gpu.before.idleW + q.gpu.before.loadW) / POWER_SCALE : 0;
  return fullW - beforeW + (q.gpu.after.idleW + q.gpu.after.loadW) / POWER_SCALE <= c.psuCapW[id]!;
}

/** Do not repeatedly scrap a card for the same tray model, or buy a weaker replacement. */
function gpuImproves(q: Quote): boolean {
  if (!q.gpu?.before) return true;
  const { before, after } = q.gpu;
  return after.cores >= before.cores && after.vramBits >= before.vramBits && after.opsPerS >= before.opsPerS
    && (after.cores > before.cores || after.vramBits > before.vramBits || after.opsPerS > before.opsPerS
      || after.idleW + after.loadW < before.idleW + before.loadW);
}

function tryAction(state: GameState, action: GameAction): GameState | null {
  const out = applyAction(state, action);
  return out.ok ? out.state : null;
}

/**
 * Credits to keep for research that has its Data but waits on a Credit fee (GPU generations):
 * a sensible player saves for the essential node rather than spending on parts.
 */
const RESERVE_HORIZON_S = 1800;
export function creditReserve(state: GameState, need: MeetNeed = {}): number {
  const tree = selectResearchTree(state);
  // A fee more than half an hour of gross income away is a goal, not a reason to stop building.
  const horizon = RESERVE_HORIZON_S * grossRate(state);
  let reserve = 0;
  // D32: research costs Credits too; a player saves for the next milestone's path and essential nodes.
  const { path } = milestonePath(tree);
  for (const n of tree.nodes) {
    if (n.state !== 'available' || !(ESSENTIAL.includes(n.id) || path.has(n.id))) continue;
    if (amountCompare(n.dataCost, state.wallet.data) > 0) continue;
    const fee = amountToNumber(n.creditCost);
    if (fee > 0 && fee <= horizon && (reserve === 0 || fee < reserve)) reserve = fee;
  }
  // The first GPU is a save-up goal once GPU tasks block rounds: a player stops buying levels to afford it.
  const noGpu = !state.build.systems.some((x) => x?.spec.accels.some((a) => a.kind === 'gpu'));
  // A new CPU generation that pays back within the hour comes first (the kHz package, D29); then the first GPU.
  if (reserve === 0) {
    const cpu = nextCpuSave(state);
    if (cpu > 0) reserve = cpu;
  }
  if (reserve === 0 && noGpu && (state.research.unlocks.gens.gpu & 1) !== 0 && ((need.gpuCores ?? 0) > 0 || state.round.reports.slice(-4).some((r) => r.details.some((d) => d.detail === 'gpu')))) reserve = GPU_ENTRY_PRICE;
  return reserve;
}

/** Cost of replacing the weakest system's CPU with the newest generation, when it is not affordable yet but pays back within an hour; else 0. */
// A new generation is worth more than its first-level gain (its clock headroom): save when it pays back within four hours.
const CPU_SAVE_PAYBACK_S = 14_400;
export function nextCpuSave(state: GameState): number {
  const id = sampleSystems(state)[0];
  if (id === undefined) return 0;
  const q = quote(state, { kind: 'tray', at: { level: 'system', id: systemId(id) } }).quotes.find((x) => x.action.type === 'replaceCpu');
  // Affordable but cold mid-round still counts: the reserve holds until the round ends and the bot can buy it.
  if (!q || q.locked !== null) return 0;
  const cost = amountToNumber(q.cost);
  const rich = tryAction({ ...state, round: { ...state.round, phase: 'between' }, wallet: { ...state.wallet, credits: q.cost } }, q.action);
  const gain = rich ? marketGain(state, rich) : 0;
  return gain > 0 && cost / gain <= CPU_SAVE_PAYBACK_S ? cost : 0;
}

function buyParts(state: GameState, policy: Policy, log: BotEvent[], need: MeetNeed): GameState {
  let s = state;
  const reserve = creditReserve(state, need);
  // Saving for a new CPU generation (minutes of payback) holds back everything else; saving for the first GPU lets wall answers through.
  const cpuSaving = reserve > 0 && reserve === nextCpuSave(state);
  for (let n = 0; n < policy.maxBuysPerDecision; n += 1) {
    const recovery = new Set<Quote>();
    const candidates = candidateRequests(s, need).flatMap(r => {
      const qs = quote(s, r).quotes;
      if (r.kind === 'meet') qs.forEach(q => recovery.add(q));
      return qs;
    });
    const quotes = candidates;
    const dependencies = new Set<Quote>();
    for (const q of [...quotes]) {
      if (q.locked || !q.affordable || !q.overSupply || !gpuImproves(q) || score(s, q) === null) continue;
      const prep = supplyPreparation(s, q);
      if (prep && Number(prep.cost) + Number(q.cost) + Number(s.round.reports.at(-1)?.energy ?? 0) <= Number(s.wallet.credits)) {
        quotes.push(prep); dependencies.add(prep);
      }
    }
    let best: Quote | null = null, bestScore = Infinity;
    const credits = amountToNumber(s.wallet.credits);
    const pending = log.reduce<BotEvent | undefined>((last, e) => e.researchCapacityAdded ? e : last, undefined);
    const eligible = buyable(s, quotes, recovery, true);
    const scores = new Map(eligible.map(q => [q, dependencies.has(q)
      ? GATE_PAYBACK_S * Number(q.cost) / Math.max(1, grossRate(s)) : fundedScore(s, q)]));
    for (const q of eligible) {
      const roomPort = false;
      if (!q.affordable) continue;
      // The reserve holds back gates and levels, not purchases that raise net income (a native CPU saves energy).
      // Nor purchases that answer a wall the recent rounds ended on (RAM, drives, cache): a player buys those while saving.
      const v = scores.get(q) ?? null;
      const capacityBuy = cpuTarget(q.action) !== null || q.action.type === 'addUnit' && q.action.parent.kind !== 'global';
      if (s.round.phase === 'running' && s.research.unlocks.levels.rack && capacityBuy && pending && (s.round.reports.at(-1)?.startTick ?? -1) < pending.tick) continue;
      // A funded pause reserves its completion budget, rather than forbidding every useful purchase.
      if (!roomPort && s.round.phase !== 'running' && canFinishResearch(s)) {
        const after = tryAction(s, q.action);
        if (!after || !canFinishResearch(after)) continue;
      }
      // Capital spending must leave enough to operate the build. Research CPU buys use their
      // shorter completion bill instead of reserving the old, much longer project's energy.
      if (!roomPort && s.research.unlocks.levels.system) {
        const next = cpuTarget(q.action) !== null && s.round.phase !== 'running' && s.research.active !== null ? tryAction(s, q.action) : null;
        const bill = next && researchInvestment(s, next, Number(q.cost)) !== null
          ? researchLeftS(next) * researchEnergy(next) : Number(s.round.reports.at(-1)?.energy ?? 0);
        if (credits - Number(q.cost) < bill) continue;
      }
      // A purchase that pays back within the reserve horizon brings the saved-for research sooner (D32: research costs Credits too).
      const quick = !cpuSaving && s.research.unlocks.levels.rack && v !== null && v <= RESERVE_HORIZON_S;
      const blockingGate = recovery.has(q) && !ratePurchase(s, q);
      if (!dependencies.has(q) && !blockingGate && reserve > 0 && !quick
        && (cpuSaving || (!q.gpu && !answersRecentWall(s, q.action)))
        && q.action.type !== 'replaceCpu' && credits - amountToNumber(q.cost) < reserve) continue;
      // A researched shrink is immediately useful when cores no longer fit.
      const bestIsPort = false;
      if (v !== null && (roomPort && !bestIsPort || roomPort === bestIsPort && v < bestScore)) {
        best = q;
        bestScore = v;
      }
    }
    if (!best) break;
    const next = tryAction(s, best.action);
    if (!next) break;
    const a = best.action;
    const id = (a.type === 'replacePart' || a.type === 'upgradePart')
      && a.part.unit.kind === 'system' && a.part.slot.kind === 'psu' ? a.part.unit.id : null;
    const beforeRate = s.build.systems.reduce((n, sys, i) => n + (sys?.online ? (s.compiled.sys.threadRate[i] ?? 0) * (s.compiled.sys.threads[i] ?? 0) : 0), 0);
    const afterRate = next.build.systems.reduce((n, sys, i) => n + (sys?.online ? (next.compiled.sys.threadRate[i] ?? 0) * (next.compiled.sys.threads[i] ?? 0) : 0), 0);
    log.push({ tick: s.clock.tick, kind: 'buy', label: best.label, cost: best.cost,
      ...(s.research.unlocks.levels.rack && afterRate > beforeRate * 1.01 ? { researchCapacityAdded: true } : {}),
      ...(id === null ? {} : { psu: {
        system: id, replacement: a.type === 'replacePart',
        capacityBeforeW: s.compiled.sys.psuCapW[id]!, capacityAfterW: next.compiled.sys.psuCapW[id]!,
        lossBefore: s.compiled.sys.psuLoss[id]!, lossAfter: next.compiled.sys.psuLoss[id]!,
      } }),
    });
    s = next;
  }
  return s;
}

/** D32: a node's price D: its Data, or a tenth of its Credits for Credits-only nodes. */
const priceOf = (n: ResearchNodeView): number => Math.max(amountToNumber(n.dataCost), amountToNumber(n.creditCost) / 10);
const byPrice = (a: ResearchNodeView, b: ResearchNodeView) => priceOf(a) - priceOf(b) || a.workOps - b.workOps;

/** The next milestone and its missing prerequisites. */
function milestonePath(tree: ReturnType<typeof selectResearchTree>): { path: Set<string>; target: string | undefined } {
  const byId = new Map<string, ResearchNodeView>(tree.nodes.map((n) => [n.id, n]));
  const path = new Set<string>();
  const walk = (id: string) => {
    const n = byId.get(id);
    if (!n || n.state === 'done' || path.has(id)) return;
    path.add(id);
    n.requires.forEach(walk);
  };
  const target = MILESTONES.find((id) => byId.has(id) && byId.get(id)!.state !== 'done');
  if (target) walk(target);
  return { path, target };
}

/** Off-path research that unblocks income; a sensible player takes it as soon as the budget allows. */
const ESSENTIAL = ['psu80', 'lbCapability', 'sw100k', 'gddr6', 'gpuGen2', 'meteredPdu', 'rackVarSpeed'];
/** Off-path research since the last milestone started may spend this share of the next milestone path's Data. */
const OFF_PATH_SHARE = 0.5;

/**
 * Research like a player saving for the next level: the next milestone and its missing
 * prerequisites first (cheapest first), then essential nodes and other extras within a budget.
 */
/** D27: seconds of work left on the active project, on every thread of the fleet. */
function researchLeftS(state: GameState): number {
  const r = state.research;
  if (r.active === null) return 0;
  const c = state.compiled.sys;
  let rate = 0;
  for (let id = 0; id < c.len; id += 1) if (c.alive[id] === 1 && state.build.systems[id]?.online)
    rate += (c.threadRate[id] ?? 0) * (c.threads[id] ?? 0) * (c.etaCfg[id] ?? 1);
  return rate > 0 ? Math.max(0, researchDef(r.active)!.work - r.activeProgress) / rate : Infinity;
}
/** Finish an affordable project between rounds instead of paying its energy during a losing market. */
function canFinishResearch(state: GameState): boolean {
  if (state.research.active === null || state.research.stoppedInsolvent) return false;
  const seconds = researchLeftS(state);
  const burn = researchEnergy(state);
  const wallet = Number(state.wallet.credits), operatingBill = Number(state.round.reports.at(-1)?.energy ?? 0);
  if (state.build.racks.some((r, id) => r?.opened && (researchRackHeat(state, id) > (state.compiled.rack.coolerQc[id] ?? 0)
    || researchRackHeat(state, id) > 0.9 * (state.compiled.rack.pduCapW[id] ?? 0)))) return false;
  const opportunity = seconds > RESEARCH_WAIT_S ? seconds * Math.max(0, income(state)) : 0;
  const commitment = seconds * burn + opportunity;
  return commitment <= wallet * 0.6 && (seconds <= RESEARCH_WAIT_S || commitment <= wallet - operatingBill);
}
/** A research purchase has a separate budget and completion benefit; it is never called market payback. */
function researchInvestment(before: GameState, after: GameState, cost: number): number | null {
  if (before.research.active === null || before.research.stoppedInsolvent) return null;
  const left = researchLeftS(after), previous = researchLeftS(before);
  if (!Number.isFinite(left) || previous < left * 1.01 || cost > Number(before.wallet.credits) * 0.4) return null;
  const total = cost + left * researchEnergy(after);
  const saving = previous * researchEnergy(before) - total;
  const savingPayback = saving > 0 ? cost / (saving / previous) : Infinity;
  if (savingPayback <= CPU_SAVE_PAYBACK_S) return savingPayback;
  // A long project can also be funded by continued market operation. Compare one held
  // thread per system, without assuming the CPU upgrade earns any extra task Credits.
  const report = before.round.reports.at(-1);
  const rate = (s: GameState) => s.build.systems.reduce((sum, sys, id) => sum + (sys?.online
    ? (s.compiled.sys.threadRate[id] ?? 0) * (s.compiled.sys.etaCfg[id] ?? 1) : 0), 0);
  const priorRate = rate(before), nextRate = rate(after);
  const extraEnergy = Math.max(0, marketResearchCpuEnergy(after) - marketResearchCpuEnergy(before));
  const wallet = Number(before.wallet.credits), duration = (report?.durationTicks ?? 0) / 10;
  const net = duration > 0 ? Number(report!.net) / duration : 0;
  const nextBill = Number(report?.energy ?? 0) + extraEnergy * duration;
  if (nextRate >= priorRate * 1.5 && cost <= wallet * 0.25 && cost + nextBill <= wallet && net > extraEnergy * 1.3)
    return previous * priorRate / Math.max(1, nextRate);
  return before.round.phase !== 'running' && left <= CPU_SAVE_PAYBACK_S && total <= Number(before.wallet.credits) * 0.4 ? left : null;
}
/** Between rounds, wait for a project to finish when it needs at most this long. */
const RESEARCH_WAIT_S = 300;

/** An affordable CPU blocked by a maxed PSU needs its supply research before another long milestone. */
function supplyResearchPath(state: GameState, byId: ReadonlyMap<string, ResearchNodeView>): Set<string> {
  const path = new Set<string>();
  const add = (id: string) => {
    const node = byId.get(id);
    if (!node || node.state === 'done' || path.has(id)) return;
    path.add(id); node.requires.forEach(add);
  };
  for (const id of sampleSystems(state)) for (const part of ['psu', 'pdu', 'ups'] as const) if (cpuNeedsSupply(state, id, part)) {
    const rack = state.build.systems[id]!.rack, room = state.build.racks[rack]!.room;
    const request: QuoteRequest = part === 'psu'
      ? { kind: 'part', part: { unit: { kind: 'system', id: systemId(id) }, slot: { kind: 'psu' } } }
      : part === 'pdu' ? { kind: 'infra', unit: { kind: 'rack', id: rackId(rack) }, slot: 'power' }
      : { kind: 'infra', unit: { kind: 'room', id: roomId(room) }, slot: 'power' };
    const next = quote(state, request).quotes.find(q => q.action.type === 'replacePart' && q.locked?.code === 'research' && q.locked.node);
    if (next?.locked?.node) add(next.locked.node);
  }
  for (const request of candidateRequests(state)) for (const q of quote(state, request).quotes) {
    if (q.locked || !q.affordable || !q.overSupply || score(state, q) === null) continue;
    const node = supplyResearch(state, q);
    if (node) add(node);
  }
  if (state.research.unlocks.levels.rack) add('rackVarSpeed');
  return path;
}

function startResearch(state: GameState, log: BotEvent[]): GameState {
  const tree = selectResearchTree(state);
  const byId = new Map<string, ResearchNodeView>(tree.nodes.map((n) => [n.id, n]));
  const supplyPath = supplyResearchPath(state, byId);
  const { path, target } = milestonePath(tree);
  const pathData = [...path].reduce((sum, id) => sum + priceOf(byId.get(id)!), 0);
  let since = 0;
  for (let i = log.length - 1; i >= 0; i -= 1) {
    const e = log[i]!;
    if (e.kind !== 'research') continue;
    if (MILESTONES.includes(e.label)) break;
    since += Math.max(amountToNumber(e.cost), amountToNumber(e.creditCost ?? '0') / 10);
  }
  const open = tree.nodes.filter((n) => (n.state === 'parked' || n.state === 'available'
      && quote(state, { kind: 'research', project: n.id }).quotes.some((q) => q.locked === null && q.affordable)));
  const onPath = open.filter((n) => path.has(n.id)).sort(byPrice)[0];
  const supply = open.filter(n => supplyPath.has(n.id)).sort(byPrice)[0];
  // An affordable milestone may park a side project; a short supply project may park a milestone.
  // Paid work is retained and is resumed through startResearch when the prerequisite is done.
  const recoveryActive = tree.active !== null && (/^psu/.test(tree.active) || tree.active === 'rackVarSpeed');
  if (tree.active !== null && (recoveryActive || !supply && (path.has(tree.active) || !onPath))) return state;
  const offPath = open.filter((n) => !path.has(n.id) && since + priceOf(n) <= OFF_PATH_SHARE * pathData).sort(byPrice);
  const pick = supply ?? onPath ?? offPath.find((n) => ESSENTIAL.includes(n.id)) ?? (target ? offPath[0] : open.sort(byPrice)[0]);
  if (!pick) return state;
  if (!supply && !path.has(pick.id)) {
    const next = tree.nodes.filter(n => path.has(n.id) && n.state === 'available').sort(byPrice)[0];
    if (next) {
      const report = state.round.reports.at(-1), seconds = (report?.durationTicks ?? 0) / 10;
      const dataRate = seconds > 0 ? Number(report!.data) / seconds : tree.income.dataPerSec;
      const creditRate = seconds > 0 ? Number(report!.net) / seconds : tree.income.creditsPerSec;
      const missingData = Math.max(0, Number(next.dataCost) - Number(state.wallet.data));
      const missingCredits = Math.max(0, Number(next.creditCost) - Number(state.wallet.credits));
      const eta = Math.max(missingData ? missingData / Math.max(1e-12, dataRate) : 0, missingCredits ? missingCredits / Math.max(1e-12, creditRate) : 0);
      const duration = pick.workOps * (1 - pick.progress) / Math.max(1e-12, tree.takenOpsPerSec);
      if (eta > 0 && duration > eta) return state;
    }
  }
  // D32: research Credits come out of the hardware budget; off the milestone path, a new CPU generation's save comes first.
  const save = path.has(pick.id) || supplyPath.has(pick.id) ? 0 : nextCpuSave(state), fee = pick.state === 'parked' ? 0 : amountToNumber(pick.creditCost);
  if (save > 0 && amountToNumber(state.wallet.credits) - fee < save) return state;
  const next = tryAction(state, { type: 'startResearch', project: pick.id });
  if (!next) return state;
  const paid = quote(state, { kind: 'research', project: pick.id }).quotes[0]!;
  log.push({ tick: state.clock.tick, kind: pick.state === 'parked' ? 'configure' : 'research', label: pick.id,
    cost: pick.state === 'parked' ? '0' : paid.cost, creditCost: pick.state === 'parked' ? '0' : paid.creditCost ?? '0' });
  return next;
}

/**
 * One decision between ticks: research, purchases, then Return to market when the round is over.
 * Returns the new state; every action taken is appended to `log`.
 */
/** Each opened router has its own free, researched filters, including the room above mixed racks. */
const RACK_FILTERS = ['capability', 'health'] as const;
function useFilters(state: GameState): GameState {
  let s = state;
  const units: ScopeRef[] = [
    ...firstIds(s.build.racks, SAMPLE).filter(id => s.build.racks[id]!.opened).map(id => ({ kind: 'rack' as const, id: rackId(id) })),
    ...firstIds(s.build.rooms, SAMPLE).filter(id => s.build.rooms[id]!.opened).map(id => ({ kind: 'room' as const, id: roomId(id) })),
    ...(s.research.unlocks.levels.global ? [{ kind: 'global' as const }] : []),
  ];
  for (const unit of units) {
    const lb = unit.kind === 'rack' ? s.build.racks[unit.id]!.lb : unit.kind === 'room' ? s.build.rooms[unit.id]!.lb : s.build.global.scheduler;
    if (!lb) continue;
    for (const filter of RACK_FILTERS) {
      if (lb.filters.includes(filter)) continue;
      s = tryAction(s, { type: 'setFilter', unit, filter, on: true }) ?? s;
    }
  }
  return s;
}

export type BotNeeds = { -readonly [K in keyof MeetNeed]: MeetNeed[K] };

/** Remember visible blocked requirements across Return, when cold recovery can be bought safely. */
function observeNeeds(state: GameState, need: BotNeeds): void {
  if (state.round.phase !== 'running') return;
  for (const t of selectMarketQueue(state)) {
    const field = t.blockedBy === 'cache' ? 'cacheBits' : t.blockedBy === 'ram' ? 'ramBits' : t.blockedBy === 'disk' ? 'diskBits' : null;
    if (field) need[field] = Math.max(need[field] ?? 0, t.workingSetBits);
    if (t.gpuCoresMin > 0 || t.vramBits > 0) {
      need.vramBits = Math.max(need.vramBits ?? 0, t.vramBits);
      need.gpuCores = Math.max(need.gpuCores ?? 0, t.gpuCoresMin);
    }
    if (t.blockedBy === 'ecc') need.ecc = true;
  }
}

export function decide(state: GameState, policy: Policy, log: BotEvent[], need: BotNeeds = {}): GameState {
  let s = state;
  observeNeeds(state,need);
  if (policy.researches) s = startResearch(s, log);
  if (policy.buys) s = configurePowerModes(s, log);
  if (policy.buys) s = configurePowerCtl(buyParts(useFilters(s), policy, log, need));
  // An active player dismisses a head nothing can run (free, outside the SLA); an idle one lets it fail.
  if (policy.id === 'active' && s.round.phase === 'running') {
    const head = selectMarketQueue(s)[0];
    if (head?.blockedBy && head.dismissible) {
      const next = tryAction(s, { type: 'dismissTask', task: head.task });
      if (next) s = next;
    }
  }
  const waitForResearch = canFinishResearch(s);
  if (s.round.phase !== 'running' && waitForResearch && s.round.autoReturnOn) {
    const next = tryAction(s, { type: 'setAutoReturn', on: false });
    if (next) { log.push({ tick: s.clock.tick, kind: 'configure', label: 'Auto return off · finish research', cost: '0' }); s = next; }
  }
  // D27: research holds threads and the market waits behind it, so a player lets a short project
  // finish between rounds before returning.
  if (s.round.phase !== 'running' && !(s.research.active !== null && !s.research.stoppedInsolvent && researchLeftS(s) <= RESEARCH_WAIT_S)) {
    const next = tryAction(s, { type: 'returnToMarket' });
    if (next) {
      log.push({ tick: s.clock.tick, kind: 'return', label: `round ${next.round.index}`, cost: '0' });
      s = next;
    }
  }
  return s;
}
