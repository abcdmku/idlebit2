import { amount, amountCompare, ZERO_AMOUNT, type Amount } from '../amount';
import { effectText, RESEARCH, researchDef } from '../build/research/tree';
import { G } from '../core/buffers';
import { TICKS_PER_SECOND } from '../core/constants';
import type { ResearchDef } from '../types/catalog';
import type { LevelId } from '../types/ids';
import type { ResearchBadge } from '../types/snapshot';
import type { GameState, ResearchState } from '../types/state';
import type { ResearchNodeState, ResearchNodeView, ResearchTreeView } from '../types/views';
import { researchCreditsPerMinute, researchLenders } from './lenders';

/** Research ops this tick, scaled to a second (exec tallies them in G.researchOps). */
export const researchOpsPerSec = (state: GameState): number => (state.hot.g[G.researchOps] ?? 0) * TICKS_PER_SECOND;

const progressOf = (def: ResearchDef | undefined, ops: number): number => (def && def.work > 0 ? Math.min(1, ops / def.work) : 0);

export function researchBadge(state: GameState): ResearchBadge {
  const r = state.research;
  const def = r.active ? researchDef(r.active) : undefined;
  return {
    active: r.active, name: def?.name ?? r.active, progress: progressOf(def, r.activeProgress), mode: r.mode,
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
      effect: effectText(def.id), summary: def.summary,
    });
  }
  const slots = r.unlocks.ceilings.researchQueue;
  return {
    nodes, active: r.active, mode: r.mode, opsPerSec: researchOpsPerSec(state), queue: r.queue,
    queueSlots: slots > 1 ? slots : 0, horizon: researchHorizon(state),
    lenders: researchLenders(state), creditsPerMinute: researchCreditsPerMinute(state),
  };
}
