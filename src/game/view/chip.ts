import { CEILINGS_MAX, MAX_CORES_PER_CPU, MAX_CPUS } from '../core/constants';
import type { CpuBuild, PartLevel, SystemSpec } from '../types/build';
import { QUEUE_STRATEGY_IDS, type PartId } from '../types/catalog';
import { familyId, type NodeRef, type SystemId } from '../types/ids';
import type { CacheLevelView, ChipSnapshot, CoreView, SchedulerView } from '../types/snapshot';
import type { GameState } from '../types/state';
import type { BuildSlotView } from '../types/views';
import { modeName, psuView } from './common';
import { pipeTransfer } from './feed';
import { forEachRunning, stageProgress } from './tasks';

const CSTATES = [0, 1, 3, 6] as const;
const cstateOf = (v: number | undefined): CoreView['cstate'] => (CSTATES.includes(v as 0) ? (v as CoreView['cstate']) : 0);
const genOpen = (state: GameState, part: PartId, gen = 0): boolean => ((state.research.unlocks.gens[part] ?? 0) & (1 << gen)) !== 0;

/**
 * Fraction of this system's threads lent to research (program D10.7, spec §11.2): idle threads plus
 * 10% (Background) or 25% (Shared) of busy ones; Focus lends everything. 0 without a project.
 */
export function researchShare(state: GameState, busyFrac: number): number {
  if (state.research.active === null || state.research.stoppedInsolvent) return 0;
  if (state.research.mode === 'focus' || state.round.phase !== 'running') return 1;
  return 1 - busyFrac * (state.research.mode === 'shared' ? 0.75 : 0.9);
}

/** Lanes of a core. TODO(S5): base[g] × L from the core catalog row; base[g] = 1 assumed. */
const coreLanes = (state: GameState, core: PartLevel): number => Math.min(core.level, state.research.unlocks.ceilings.lanesPerCore);

/** Cache levels of the CPU. TODO(S5): per-level bits from the catalog; the CPU's total is split evenly. */
function cacheLevels(cpu: CpuBuild | null, cpuBits: number): CacheLevelView[] {
  if (!cpu) return [];
  const parts: [CacheLevelView['kind'], PartLevel][] = [['l1', cpu.l1]];
  if (cpu.l2) parts.push(['l2', cpu.l2]);
  if (cpu.l3) parts.push(['l3', cpu.l3]);
  return parts.map(([kind, p]) => ({ kind, bits: cpuBits / parts.length, generation: p.gen, level: p.level }));
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
  return { slots: chipSlots(state, spec), levels: cacheLevels(spec?.cpu ?? null, cpuCacheBits(state, id)) };
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
  const busyFrac = nCores > 0 ? Math.min(1, busyThreads / (nCores * tpc)) : 0;
  const share = researchShare(state, busyFrac);

  // Oldest CPU-stage records fill cores first; each takes rec.threads × count threads.
  const rec = state.hot.rec;
  const oldestFirst = (a: number, b: number): number => rec.taken[a]! - rec.taken[b]! || rec.taskId[a]! - rec.taskId[b]!;
  const running: number[] = [];
  forEachRunning(state, id, (r, res) => { if (res === 0) running.push(r); });
  running.sort(oldestFirst);
  const fam = new Int32Array(nCores).fill(-1);
  const taskIds: (number | null)[] = Array(nCores).fill(null);
  const prog = new Float64Array(nCores);
  const rack = c.rack[id] ?? 0;
  let core = 0;
  for (const r of running) {
    if (core >= nCores) break;
    const take = Math.max(1, Math.ceil(((rec.threads[r] ?? 1) * (rec.count[r] ?? 1)) / tpc));
    const p = stageProgress(state.hot, state.clock.tick, r, rack, id, 0);
    for (let k = 0; k < take && core < nCores; k += 1, core += 1) {
      fam[core] = rec.family[r] ?? 0; taskIds[core] = rec.taskId[r]!; prog[core] = p;
    }
  }

  const cstate = cstateOf(h.cstate[id]);
  const cores: CoreView[] = parts.map((part, i) => {
    const busy = Math.max(0, Math.min(tpc, busyThreads - i * tpc)) / tpc;
    return {
      socket: 0, lanes: coreLanes(state, part), generation: part.gen, level: part.level, busy,
      taskId: taskIds[i]!, family: fam[i]! >= 0 ? familyId(fam[i]!) : null, progress: prog[i]!, threads: tpc,
      research: share > 0 ? Math.min(1 - busy, share) : 0, cstate: busy > 0 ? 0 : cstate,
    };
  });

  const hz = c.clockHz[id] ?? 0;
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
    level: 'chip', parent, systemId: id, online: modeName(h.mode[id]), tier: cpu?.cpu.gen ?? 0, cpuCount: cpus,
    clock: { hz, effectiveHz: hz * (h.clockFactor[id] ?? 1), generation: cpu?.clock.gen ?? 0, level: cpu?.clock.level ?? 1 },
    coreSites: Math.min(state.research.unlocks.ceilings.coreSites, MAX_CORES_PER_CPU), cores,
    cache: { levels: st.levels, usedBits: (c.hasRam[id] ?? 0) === 1 ? 0 : Math.min(capacityBits, h.usedMem[id] ?? 0), capacityBits },
    scheduler, queue: queued.slice(0, scheduler?.q ?? 0).map((r) => ({ taskId: rec.taskId[r]!, family: familyId(rec.family[r]!) })),
    researchShare: share, slots: st.slots,
    pipe: {
      speed: c.pipeSpeed[id] ?? 0, transfer: pipeTransfer(state, id),
      waiting: (h.pipeRec[id] ?? -1) >= 0 && (h.running[id] ?? 0) === 0 && (h.queueLen[id] ?? 0) === 0,
    },
    psu: psuView(state, id, spec?.psu ?? { gen: 0, level: 1, capped: false }),
  };
}
