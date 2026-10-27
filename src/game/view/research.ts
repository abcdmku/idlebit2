import { amount, amountCompare, ZERO_AMOUNT, type Amount } from '../amount';
import { effectText, RESEARCH, researchDef } from '../build/research/tree';
import { G } from '../core/buffers';
import { MODE } from '../core/timers';
import { TICK_MS, TICKS_PER_SECOND } from '../core/constants';
import type { ResearchDef } from '../types/catalog';
import type { LevelId, NodeRef } from '../types/ids';
import type { ResearchBadge } from '../types/snapshot';
import type { GameState, ResearchState } from '../types/state';
import type { ResearchNodeState, ResearchNodeView, ResearchTreeView } from '../types/views';
import { researchChange } from './researchChange';
import { researchRoot } from './researchParts';
import { researchPartSpecs } from './researchSpecs';
import { researchCreditsPerMinute, researchLenders } from './lenders';
import { answerTypes } from '../market/taskTypes';
import { DVFS_CLOCK } from '../phys/constants';

/** The trailing window of the recent income rate (round time). */
const RECENT_MS = 30_000;

/** Ledger totals (gross, energy) at `tick`, from the net ring (60 s of change points). */
function ledgerAt(ring: GameState['ledger']['netRing'], tick: number): { gross: number; energy: number } {
  let gross = 0, energy = 0;
  for (const sample of ring) {
    if (sample.tick > tick) break;
    gross = Number(sample.gross); energy = Number(sample.energy);
  }
  return { gross, energy };
}

/**
 * Recent round-time income per second (HudSnapshot.incomeRecent, ResearchTreeView.income): net
 * Credits (gross − energy) over the last 30 s of the running round, or since its start; negative
 * when energy outruns pay. Data is the recent gross at this round's Data-per-Credit (the ledger
 * keeps no Data history). Between rounds, the last report's average. 0 until 10 s have elapsed.
 */
export function recentIncome(state: GameState): ResearchTreeView['income'] {
  const round = state.round;
  if (round.phase !== 'running') return roundIncome(state);
  const now = state.clock.tick;
  if ((now - round.startTick) * TICK_MS < INCOME_MIN_MS) return { dataPerSec: 0, creditsPerSec: 0 };
  const from = Math.max(round.startTick, now - RECENT_MS / TICK_MS);
  const base = ledgerAt(state.ledger.netRing, from), seconds = ((now - from) * TICK_MS) / 1000;
  const gross = Number(state.ledger.gross) - base.gross, energy = Number(state.ledger.energy) - base.energy;
  const roundGross = Number(round.gross), dataPerCredit = roundGross > 0 ? Number(round.data) / roundGross : 0;
  return { dataPerSec: (gross * dataPerCredit) / seconds, creditsPerSec: (gross - energy) / seconds };
}

/** Income needs this much elapsed round time before it means anything. */
const INCOME_MIN_MS = 10_000;
/**
 * Round-time income for research ETAs (ResearchTreeView.income): the running round's totals over
 * its elapsed time, else the last report's over its duration.
 */
export function roundIncome(state: GameState): ResearchTreeView['income'] {
  const round = state.round;
  const running = round.phase === 'running';
  const last = running ? null : round.reports.at(-1) ?? null;
  const ms = running ? Math.max(0, state.clock.tick - round.startTick) * TICK_MS : last?.durationMs ?? 0;
  if (ms < INCOME_MIN_MS) return { dataPerSec: 0, creditsPerSec: 0 };
  const data = running ? Number(round.data) : Number(last!.data);
  const net = running ? Number(round.gross) - Number(round.energy) : Number(last!.net);
  return { dataPerSec: data / (ms / 1000), creditsPerSec: net / (ms / 1000) };
}

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
  return heldOpsPerSec(state, true);
}

/**
 * Research ops/s once systems take the project, whichever slots are busy now
 * (ResearchTreeView.takenOpsPerSec): ROUND_THREADS on every system that can hold it during a round,
 * every thread between rounds; while a project runs, its current rate.
 */
export function takenOpsPerSec(state: GameState): number {
  return heldOpsPerSec(state, false);
}

function modeRates(state: GameState): { roundOpsPerSec: number; pausedOpsPerSec: number } {
  const c = state.compiled.sys, h = state.hot.sys;
  let roundOpsPerSec = 0, pausedOpsPerSec = 0;
  for (let s = 0; s < c.len; s += 1) {
    if (c.alive[s] !== 1 || c.kind[s] !== 0 || c.intent[s] !== 1) continue;
    if (state.compiled.rack.opened[c.rack[s]!] === 1 && c.port[s]! < 0) continue;
    if (h.mode[s] !== MODE.onMarket && h.mode[s] !== MODE.paused && h.mode[s] !== MODE.asleep) continue;
    const rate = c.threadRate[s]! * researchClock(state, s) * c.etaCfg[s]!;
    roundOpsPerSec += rate * Math.min(1, c.threads[s]!);
    pausedOpsPerSec += rate * c.threads[s]!;
  }
  return { roundOpsPerSec, pausedOpsPerSec };
}

/** exec/researchTask: a holder keeps one thread during a round (D27 amendment), all of them between rounds. */
const ROUND_THREADS = 1;
/** Taking research wakes DVFS on the next physical tick; retain current caps and thermal limits. */
const researchClock = (state: GameState, s: number) => state.hot.sys.clockFactor[s]! / (state.hot.sys.dvfsOn[s] === 1 ? DVFS_CLOCK : 1);

/**
 * exec/researchTask's take rule, read only. A live, linked server switched online can hold research:
 * on the market (or asleep, woken by the take) during a round, paused between rounds. With
 * `roomNow` it also needs a free slot and free threads now, and takes only those.
 */
function heldOpsPerSec(state: GameState, roomNow: boolean): number {
  if ((state.hot.g[G.researchHolders] ?? 0) > 0) return researchOpsPerSec(state);
  const c = state.compiled.sys, h = state.hot.sys, running = state.round.phase === 'running';
  let ops = 0;
  for (let s = 0; s < c.len; s += 1) {
    if (c.alive[s] !== 1 || c.kind[s] !== 0 || c.intent[s] !== 1) continue;
    if (state.compiled.rack.opened[c.rack[s]!] === 1 && c.port[s]! < 0) continue;
    const mode = h.mode[s]!, threads = Math.max(1, c.threads[s]!);
    let take = threads;
    if (running) {
      if (mode !== MODE.onMarket && mode !== MODE.asleep) continue;
      take = Math.min(ROUND_THREADS, threads);
      if (roomNow) {
        const slots = Math.max(1, c.slots[s]!, c.keff[s]!);
        if (h.running[s]! + h.queueLen[s]! + h.reserved[s]! >= slots) continue;
        take = Math.min(take, threads - h.busyThreads[s]!);
      }
    } else if (mode !== MODE.paused) continue;
    if (take > 0) ops += c.threadRate[s]! * researchClock(state, s) * c.etaCfg[s]! * take;
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
/** `at`: the node the part specs are read at (default: the player's first system). */
export function researchTree(state: GameState, at: NodeRef | null = null): ResearchTreeView {
  const r = state.research;
  const done = new Set<string>(r.completed);
  const nodes: ResearchNodeView[] = [];
  const levels = new Map<string, number>();
  for (const def of RESEARCH) if (def.purchase && done.has(def.id)) levels.set(def.purchase.series, Math.max(levels.get(def.purchase.series) ?? 0, def.purchase.level));
  for (const def of RESEARCH) {
    if (!def.implemented) continue;
    if (def.purchase && def.purchase.level !== Math.min(def.purchase.maxLevel, (levels.get(def.purchase.series) ?? 0) + 1)) continue;
    const st = nodeState(r, done, def);
    const ops = st === 'active' ? r.activeProgress : st === 'parked' ? (r.parked[def.id] ?? 0) : st === 'done' ? def.work : 0;
    const cost = dataCost(def);
    const creditCost = def.creditCost ?? ZERO_AMOUNT;
    const feePending = st === 'available' || st === 'queued' || st === 'locked';
    nodes.push({
      id: def.id, name: def.name, category: def.category, state: st, progress: progressOf(def, ops), purchase: def.purchase,
      dataCost: cost, workOps: def.work, requires: def.requires,
      requiredResearch: def.requires.filter(id => !done.has(id)).map(id => {
        const required = researchDef(id)!;
        const purchase = required.purchase;
        const next = purchase && RESEARCH.find(d => d.purchase?.series === purchase.series
          && d.purchase.level === Math.min(purchase.maxLevel, (levels.get(purchase.series) ?? 0) + 1));
        return { id: next?.id ?? id, name: required.name + (purchase ? ` · Level ${purchase.level}` : '') };
      }),
      creditCost, needsCredits: feePending && amountCompare(creditCost, state.wallet.credits) > 0,
      lockedBy: st === 'locked' ? (def.requires.find((p) => !done.has(p)) ?? null) : null,
      level: def.level, era: def.era, tier: def.tier,
      needsData: st === 'queued' && amountCompare(cost, state.wallet.data) > 0,
      effect: effectText(def.id), summary: def.summary, answers: answerTypes(def.answers),
      ...researchRoot(def.id), change: researchChange(state, def),
    });
  }
  const slots = r.unlocks.ceilings.researchQueue;
  return {
    nodes, parts: researchPartSpecs(state, at), income: recentIncome(state), active: r.active, opsPerSec: researchOpsPerSec(state), holdOpsPerSec: holdOpsPerSec(state), takenOpsPerSec: takenOpsPerSec(state), queue: r.queue,
    ...modeRates(state), queueSlots: slots > 1 ? slots : 0, horizon: researchHorizon(state),
    lenders: researchLenders(state), creditsPerMinute: researchCreditsPerMinute(state),
  };
}
