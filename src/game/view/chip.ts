import { capacity, PARTS } from '../build/catalog';
import { CEILINGS_MAX, MAX_CORES_PER_CPU, MAX_CPUS } from '../core/constants';
import type { CpuBuild, PartLevel, SystemSpec } from '../types/build';
import { QUEUE_STRATEGY_IDS, type PartId } from '../types/catalog';
import { familyId, type NodeRef, type SystemId } from '../types/ids';
import { G } from '../core/buffers';
import { MODE } from '../core/timers';
import { DRAW_NONE, DRAW_SLEEP, drawKind } from '../phys/draw';
import type { CacheLevelView, ChipSnapshot, CoreSleep, CoreView, SchedulerView } from '../types/snapshot';
import type { GameState } from '../types/state';
import type { BuildSlotView } from '../types/views';
import { modeName, psuView, systemTimerS } from './common';
import { inboundTransfer, shardOf } from './flows';
import { forEachRunning, stageProgress } from './tasks';
import { coreOccupancy } from './common';
import { spilledOutOfCache } from './memory';
import { PART_LOAD_CACHE } from '../exec/memory';
import { FAMILIES } from '../market/families';

const cstateOf = (v: number | undefined): CoreView['cstate'] => v === 1 ? 1 : 0;
const genOpen = (state: GameState, part: PartId, gen = 0): boolean => ((state.research.unlocks.gens[part] ?? 0) & (1 << gen)) !== 0;

/** Fraction of system s's threads held by the research task (D27, spec §11.2). 0 when it is not a holder. */
export function researchShare(state: GameState, s: number): number {
  const threads = state.compiled.sys.threads[s] ?? 0, held = state.hot.sys.researchThreads[s] ?? 0;
  return threads > 0 ? Math.min(1, held / threads) : 0;
}


/** Cache levels of one CPU, each at its own catalog size (compile sums the same values). */
function cacheLevels(cpu: CpuBuild | null): CacheLevelView[] {
  if (!cpu) return [];
  const parts: [CacheLevelView['kind'], PartLevel][] = [['l1', cpu.l1]];
  if (cpu.l2) parts.push(['l2', cpu.l2]);
  if (cpu.l3) parts.push(['l3', cpu.l3]);
  return parts.map(([kind, p]) => ({ kind, bits: capacity(PARTS[kind], p.gen, p.level), generation: p.gen, level: p.level }));
}

function chipSlots(state: GameState, spec: SystemSpec | null): BuildSlotView[] {
  const slots: BuildSlotView[] = [];
  const cpu = spec?.cpu ?? null;
  const sites = Math.min(state.research.unlocks.ceilings.coreSites, MAX_CORES_PER_CPU);
  const cores = cpu?.cores.length ?? 0;
  for (let i = cores; i < sites; i += 1) slots.push({ kind: 'core', index: i, locked: false });
  if (sites < Math.min(CEILINGS_MAX.coreSites, MAX_CORES_PER_CPU)) slots.push({ kind: 'core', index: sites, locked: true });
  if (cpu && !cpu.l2) slots.push({ kind: 'l2', index: 0, locked: !genOpen(state, 'l2') });
  if (cpu && !cpu.l3) slots.push({ kind: 'l3', index: 0, locked: !genOpen(state, 'l3') });
  if (spec && !spec.scheduler) slots.push({ kind: 'scheduler', index: 0, locked: !genOpen(state, 'scheduler') });
  return slots;
}

/** CPUs in the system: 1 to MAX_CPUS for a server, 0 for a storage node. */
export const cpuCountOf = (spec: SystemSpec | null): number => (spec?.cpu ? Math.max(1, Math.min(MAX_CPUS, spec.cpuCount)) : 0);

/** Cache bits of one CPU: every CPU of a system is identical (D7.3). */
const cpuCacheBits = (state: GameState, id: SystemId): number =>
  (state.compiled.sys.cacheBits[id] ?? 0) / Math.max(1, cpuCountOf(state.build.systems[id]?.spec ?? null));

/** Static parts of the CPU view that change only with build, compiled or unlocks. */
export interface ChipStatic { readonly slots: readonly BuildSlotView[]; readonly levels: readonly CacheLevelView[] }
export function chipStatic(state: GameState, id: SystemId): ChipStatic {
  const spec = state.build.systems[id]?.spec ?? null;
  return { slots: chipSlots(state, spec), levels: cacheLevels(spec?.cpu ?? null) };
}

/**
 * The CPU level (D7.1): one CPU's clock, cache, scheduler and cores. The view shows CPU 1. Its cores
 * fill first from the pooled queue, so the first running records sit on it. With several CPUs its
 * busy threads come from exec's per-socket count.
 */
export function chipSnapshot(state: GameState, id: SystemId, parent: NodeRef | null, st: ChipStatic = chipStatic(state, id)): ChipSnapshot {
  const spec = state.build.systems[id]?.spec ?? null;
  const cpu = spec?.cpu ?? null;
  const c = state.compiled.sys, h = state.hot.sys;
  const cpus = cpuCountOf(spec);
  const threads = c.threads[id] ?? 0;
  const busyThreads = cpus > 1 ? (h.sockBusy[id * MAX_CPUS] ?? 0) : (h.busyThreads[id] ?? 0);
  const parts = (cpu?.cores ?? []).slice(0, MAX_CORES_PER_CPU);
  const nCores = parts.length;
  const tpc = nCores > 0 ? Math.max(1, Math.round(threads / (nCores * Math.max(1, cpus)))) : 1;
  const share = researchShare(state, id);

  // Each running record sits on the threads it was bound to at start (rec.thread0): core i shows the task on
  // core i, so a finished task never shifts the others (user, 25 Oct). CPU-stage records show their task.
  const rec = state.hot.rec;
  const oldestFirst = (a: number, b: number): number => rec.taken[a]! - rec.taken[b]! || rec.taskId[a]! - rec.taskId[b]!;
  const occ = coreOccupancy(state, id, nCores, tpc, busyThreads);
  const fam = new Int32Array(nCores).fill(-1);
  const taskIds: (number | null)[] = Array(nCores).fill(null);
  const prog = new Float64Array(nCores);
  const activity: CoreView['activity'][] = Array(nCores).fill(null);
  const shardIx = new Int32Array(nCores).fill(-1), group = new Int32Array(nCores);
  const rack = c.rack[id] ?? 0;
  const show = (r: number, core: number, held: number) => {
    fam[core] = rec.family[r] ?? 0; taskIds[core] = rec.taskId[r]!; prog[core] = stageProgress(state.hot, state.clock.tick, r, rack, id, 0);
    activity[core] = rec.part[r] === PART_LOAD_CACHE ? 'cacheLoad'
      : FAMILIES[rec.family[r] ?? 0]?.stages[rec.stage[r] ?? 0]?.resource === 'mem' ? 'cacheAccess' : 'compute';
    shardIx[core] = shardOf(state.hot, r).shard; group[core] = held;
  };
  const unbound: number[] = [];
  let loadedBits = 0;
  forEachRunning(state, id, (r, res) => {
    const loaded = rec.part[r] === PART_LOAD_CACHE ? stageProgress(state.hot, state.clock.tick, r, rack, id, 0) : 1;
    loadedBits += (rec.memC[r] ?? 0) * (rec.count[r] ?? 1) * loaded;
    if (res !== 0) return;
    const held = (rec.threads[r] ?? 1) * (rec.count[r] ?? 1), t0 = rec.thread0[r] ?? -1;
    if (t0 < 0) { unbound.push(r); return; }
    for (let core = Math.floor(t0 / tpc); core < Math.ceil((t0 + held) / tpc) && core < nCores; core += 1) if (taskIds[core] === null) show(r, core, held);
  });
  // Records without a binding (hand-built states) fill the lowest free cores, oldest taken first.
  unbound.sort(oldestFirst);
  for (const r of unbound) {
    const held = (rec.threads[r] ?? 1) * (rec.count[r] ?? 1);
    let need = Math.max(1, Math.ceil(held / tpc));
    for (let core = 0; core < nCores && need > 0; core += 1) if (taskIds[core] === null) { show(r, core, held); need -= 1; }
  }

  const cstate = cstateOf(h.cstate[id]);
  const hz = c.clockHz[id] ?? 0;
  // Live clock (spec §9.3): the socket clock × clockFactor (P-state, thermal throttle, power caps).
  // Unpowered modes run no clock; an S3-asleep system's cores all sleep; an idle core sinks to the C-state.
  const draw = drawKind(h.mode[id] ?? MODE.empty, (state.hot.g[G.researchHolders] ?? 0) > 0);
  // Paused between rounds: the ready clock (nominal); its real speed returns when the round starts.
  const paused = h.mode[id] === MODE.paused;
  const liveHz = paused ? hz : draw === DRAW_NONE || draw === DRAW_SLEEP ? 0 : hz * (h.clockFactor[id] ?? 1);
  const cores: CoreView[] = parts.map((part, i) => {
    const busy = occ[i]!;
    const sleep: CoreSleep | null = paused ? null : draw === DRAW_SLEEP ? 'S3' : draw !== DRAW_NONE && busy === 0 && cstate > 0 ? 'C-state' : null;
    return {
      socket: 0, rate: hz, generation: part.gen, level: part.level, busy,
      hz: sleep === null ? liveHz : 0, sleep,
      taskId: taskIds[i]!, family: fam[i]! >= 0 ? familyId(fam[i]!) : null, activity: activity[i]!, progress: prog[i]!, threads: tpc,
      shard: shardIx[i]! >= 0 ? shardIx[i]! : null, shardThreads: group[i]!,
      research: share > 0 ? Math.min(1 - busy, share) : 0, cstate: busy > 0 ? 0 : cstate,
    };
  });

  const sched = spec?.scheduler ?? null;
  const scheduler: SchedulerView | null = sched ? {
    generation: sched.gen, level: sched.level, strategy: QUEUE_STRATEGY_IDS[c.strategy[id] ?? 0] ?? sched.strategy,
    q: c.Q[id] ?? 0, queued: h.queueLen[id] ?? 0, k: c.K[id] ?? 0, running: h.running[id] ?? 0, reserved: h.reserved[id] ?? 0,
  } : null;
  const queued: number[] = [];
  if (scheduler) {
    for (let r = h.queueHead[id] ?? -1; r >= 0; r = rec.next[r] ?? -1) queued.push(r);
    queued.sort(oldestFirst);
  }
  const capacityBits = cpuCacheBits(state, id);
  return {
    level: 'chip', parent, systemId: id, online: modeName(h.mode[id]), timerS: systemTimerS(state.hot, id), tier: cpu?.cpu.gen ?? 0, cpuCount: cpus,
    clock: { hz, effectiveHz: hz * (h.clockFactor[id] ?? 1), generation: cpu?.clock.gen ?? 0, level: cpu?.clock.level ?? 1 },
    coreSites: Math.min(state.research.unlocks.ceilings.coreSites, MAX_CORES_PER_CPU), cores,
    cache: {
      levels: st.levels, usedBits: Math.min(capacityBits, (h.usedCache[id] ?? 0) / Math.max(1, cpus)), capacityBits,
      loadedBits: Math.min(capacityBits, loadedBits / Math.max(1, cpus)),
      spilledOutBits: spilledOutOfCache(state, id),
    },
    scheduler, queue: queued.slice(0, scheduler?.q ?? 0).map((r) => ({ taskId: rec.taskId[r]!, family: familyId(rec.family[r]!) })),
    researchShare: share, slots: st.slots,
    pipe: {
      speed: c.pipeSpeed[id] ?? 0, transfer: inboundTransfer(state, id),
      waiting: (h.pipeRec[id] ?? -1) >= 0 && (h.running[id] ?? 0) === 0 && (h.queueLen[id] ?? 0) === 0,
    },
    psu: psuView(state, id, spec?.psu ?? { gen: 0, level: 1, capped: false }),
  };
}
