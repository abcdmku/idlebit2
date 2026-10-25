import { amount, amountCompare, ZERO_AMOUNT, type Amount } from '../amount';
import { effectText, RESEARCH, researchDef } from '../build/research/tree';
import { G } from '../core/buffers';
import { MODE } from '../core/timers';
import { TICKS_PER_SECOND } from '../core/constants';
import type { ResearchDef } from '../types/catalog';
import type { LevelId } from '../types/ids';
import type { ResearchBadge } from '../types/snapshot';
import type { GameState, ResearchState } from '../types/state';
import type { ResearchNodeState, ResearchNodeView, ResearchTreeView } from '../types/views';
import { researchRoot } from './researchParts';
import { researchCreditsPerMinute, researchLenders } from './lenders';
import { answerTypes } from '../market/taskTypes';

/**
 * Research ops of the last tick, scaled to a second. Exec writes each holder's tally to sys.researchOps;
 * G.researchOps is consumed by the research step within the tick, so it reads 0 between ticks.
 */
export function researchOpsPerSec(state: GameState): number {
  if ((state.hot.g[G.researchHolders] ?? 0) === 0) return 0;
  const ops = state.hot.sys.researchOps;
  let sum = 0;
  for (let s = 0; s < state.compiled.sys.len; s += 1) if ((state.hot.sys.researchThreads[s] ?? 0) > 0) sum += ops[s] ?? 0;
  return sum * TICKS_PER_SECOND;
}

/**
 * D27: ops/s the research task would get if taken now (ResearchTreeView.holdOpsPerSec). Mirrors
 * exec/researchTask: during a round, each system with a free slot and free threads holds those
 * threads; between rounds every paused, linked server holds all of its threads.
 */
export function holdOpsPerSec(state: GameState): number {
  if ((state.hot.g[G.researchHolders] ?? 0) > 0) return researchOpsPerSec(state);
  const c = state.compiled.sys, h = state.hot.sys, running = state.round.phase === 'running';
  let ops = 0;
  for (let s = 0; s < c.len; s += 1) {
    if (c.alive[s] !== 1 || c.kind[s] !== 0) continue;
    if (state.compiled.rack.opened[c.rack[s]!] === 1 && c.port[s]! < 0) continue;
    const mode = h.mode[s]!, threads = Math.max(1, c.threads[s]!);
    let free = threads;
    if (running) {
      if (mode !== MODE.onMarket && mode !== MODE.asleep) continue;
      const slots = Math.max(1, c.slots[s]!, c.keff[s]!);
      if (h.running[s]! + h.queueLen[s]! + h.reserved[s]! >= slots) continue;
      free = threads - h.busyThreads[s]!;
    } else if (mode !== MODE.paused) continue;
    if (free > 0) ops += c.threadRate[s]! * h.clockFactor[s]! * c.etaCfg[s]! * free;
  }
  return ops;
}

const progressOf = (def: ResearchDef | undefined, ops: number): number => (def && def.work > 0 ? Math.min(1, ops / def.work) : 0);

export function researchBadge(state: GameState): ResearchBadge {
  const r = state.research;
  const def = r.active ? researchDef(r.active) : undefined;
  return {
    active: r.active, name: def?.name ?? r.active, progress: progressOf(def, r.activeProgress),
    stoppedInsolvent: r.stoppedInsolvent, needsData: r.needsData, queued: r.queue.length, opsPerSec: researchOpsPerSec(state),
  };
}

export function nodeState(r: ResearchState, done: ReadonlySet<string>, def: ResearchDef): ResearchNodeState {
  if (done.has(def.id)) return 'done';
  if (r.active === def.id) return 'active';
  if (r.parked[def.id] !== undefined) return 'parked';
  if (r.queue.includes(def.id)) return 'queued';
  return def.requires.every((p) => done.has(p)) ? 'available' : 'locked';
}

/** Data costs are static: one Amount per node, built once. */
const DATA_COST = new Map<string, Amount>();
const dataCost = (def: ResearchDef): Amount => {
  let v = DATA_COST.get(def.id);
  if (v === undefined) { v = amount(def.data); DATA_COST.set(def.id, v); }
  return v;
};

const LEVEL_ORDER: readonly LevelId[] = ['chip', 'system', 'rack', 'room', 'global'];
/** Highest opened level. */
export const researchHorizon = (state: GameState): LevelId =>
  LEVEL_ORDER.reduce<LevelId>((top, l) => (state.research.unlocks.levels[l] ? l : top), 'chip');

/**
 * The research wafer (mockup core/research-wafer.js): every node in tree order with its die state,
 * plus the fab line. Nodes whose mechanic has not landed stay hidden (architecture §8).
 */
export function researchTree(state: GameState): ResearchTreeView {
  const r = state.research;
  const done = new Set<string>(r.completed);
  const nodes: ResearchNodeView[] = [];
  for (const def of RESEARCH) {
    if (!def.implemented) continue;
    const st = nodeState(r, done, def);
    const ops = st === 'active' ? r.activeProgress : st === 'parked' ? (r.parked[def.id] ?? 0) : st === 'done' ? def.work : 0;
    const cost = dataCost(def);
    const creditCost = def.creditCost ?? ZERO_AMOUNT;
    const feePending = st === 'available' || st === 'queued' || st === 'locked';
    nodes.push({
      id: def.id, name: def.name, category: def.category, state: st, progress: progressOf(def, ops),
      dataCost: cost, workOps: def.work, requires: def.requires,
      creditCost, needsCredits: feePending && amountCompare(creditCost, state.wallet.credits) > 0,
      lockedBy: st === 'locked' ? (def.requires.find((p) => !done.has(p)) ?? null) : null,
      level: def.level, era: def.era, tier: def.tier,
      needsData: st === 'queued' && amountCompare(cost, state.wallet.data) > 0,
      effect: effectText(def.id), summary: def.summary, answers: answerTypes(def.answers),
      ...researchRoot(def.id),
    });
  }
  const slots = r.unlocks.ceilings.researchQueue;
  return {
    nodes, active: r.active, opsPerSec: researchOpsPerSec(state), holdOpsPerSec: holdOpsPerSec(state), queue: r.queue,
    queueSlots: slots > 1 ? slots : 0, horizon: researchHorizon(state),
    lenders: researchLenders(state), creditsPerMinute: researchCreditsPerMinute(state),
  };
}
