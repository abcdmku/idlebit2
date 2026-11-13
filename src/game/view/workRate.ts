import { G } from '../core/buffers';
import { TICKS_PER_SECOND } from '../core/constants';
import { PART_DISK, PART_LOAD_CACHE, PART_LOAD_DISK, PART_LOAD_RAM, PART_MAIN, PART_RAM } from '../exec/memory';
import { RAM, shapeOf, stageWorkAt } from '../exec/shape';
import { FAMILIES } from '../market/families';
import type { HudRates, WorkSample } from '../types/snapshot';
import type { GameState } from '../types/state';
import { preloadForRecord } from './preload';
import { forEachRunning, stageProgress } from './tasks';

/**
 * Live rates (D90). A task pays when it completes, so paid Credits per second lag the hardware by
 * a task's length. Work does not: every running shard's progress is on its resource clock. The
 * earned value here is paid work plus each running shard's payout × the share of its work done, so
 * it moves the tick a setting changes. Work on a task that later fails is lost and the figure dips.
 */

/** Share of one task of record r done, 0..1: loads, earlier stages, then the current part's clock progress. */
function doneShare(state: GameState, s: number, rack: number, r: number, res: number): number {
  const rec = state.hot.rec;
  const shape = shapeOf(rec.family[r] ?? 0), units = rec.units[r] ?? 0;
  const loadC = rec.memC[r] ?? 0, loadR = (rec.memR[r] ?? 0) + (rec.vramR[r] ?? 0), loadD = (rec.memD[r] ?? 0) + (rec.vramD[r] ?? 0);
  const loads = loadC + loadR + loadD;
  let total = loads;
  for (let st = 0; st < shape.stages; st += 1) total += stageWorkAt(shape, st, units);
  if (!(total > 0)) return 0;
  const part = rec.part[r] ?? PART_MAIN, stage = rec.stage[r] ?? 0;
  const at = stageProgress(state.hot, state.clock.tick, r, rack, s, res);
  let done: number;
  if (part >= PART_LOAD_CACHE) {
    const preloaded = Math.min(loadC, rec.preloadDone[r] ?? 0);
    done = part === PART_LOAD_CACHE ? preloaded + at * (loadC - preloaded)
      : part === PART_LOAD_RAM ? loadC + at * loadR : part === PART_LOAD_DISK ? loadC + loadR + at * loadD : loads;
  } else {
    done = loads;
    for (let st = 0; st < stage && st < shape.stages; st += 1) done += stageWorkAt(shape, st, units);
    const work = stage < shape.stages ? stageWorkAt(shape, stage, units) : 0;
    if (shape.res[stage] === RAM) {
      // D26.2: a mem stage runs its cache share, then its RAM share, then its disk share.
      const tr = rec.trafR[r] ?? 0, td = rec.trafD[r] ?? 0, main = Math.max(0, 1 - tr - td);
      done += work * (part === PART_MAIN ? at * main : part === PART_RAM ? main + at * tr : part === PART_DISK ? main + tr + at * td : 1);
    } else done += work * (part === PART_MAIN ? at : 1); // a GPU stage's spill parts are extra traffic after its paid work
  }
  return Math.max(0, Math.min(1, done / total));
}

/** Credits and Data of work done on tasks that have not paid yet. */
function inFlight(state: GameState): { credits: number; data: number } {
  const { hot, compiled } = state, rec = hot.rec, par = hot.parent;
  let credits = 0, data = 0;
  const add = (family: number, value: number) => {
    const ratio = hot.fam.dataRatio[family] || FAMILIES[family]?.dataRatio || 0;
    credits += value;
    if (ratio > 0) data += value / ratio;
  };
  const parents = new Set<number>();
  for (let s = 0; s < compiled.sys.len; s += 1) {
    const rack = compiled.sys.rack[s] ?? 0;
    forEachRunning(state, s, (r, res) => {
      add(rec.family[r] ?? 0, (rec.count[r] ?? 1) * (rec.payout[r] ?? 0) * doneShare(state, s, rack, r, res));
      const p = rec.parent[r] ?? -1;
      if (p >= 0) parents.add(p);
    });
    // Bits a queued task has preloaded into cache are paid reads already done (one Credit per bit).
    for (let q = hot.sys.queueHead[s] ?? -1; q >= 0; q = rec.next[q] ?? -1) {
      const loaded = preloadForRecord(state, s, q)?.loadedBits ?? 0;
      if (loaded > 0) add(rec.family[q] ?? 0, (rec.count[q] ?? 1) * Math.min(rec.payout[q] ?? 0, loaded));
    }
  }
  // D25.5: a finished shard leaves its system but pays only with its task. Shares are near equal.
  for (const p of parents) {
    const shards = (par.placed[p] ?? 0) + (par.pending[p] ?? 0);
    if (shards > 0) add(par.family[p] ?? 0, (par.work[p] ?? 0) * (par.done[p] ?? 0) / shards);
  }
  return { credits, data };
}

/** Lifetime paid totals plus work in flight, at the current tick. */
export function workSample(state: GameState): WorkSample {
  const flight = state.round.phase === 'running' && (state.hot.g[G.running] ?? 0) + (state.hot.g[G.queued] ?? 0) > 0 ? inFlight(state) : { credits: 0, data: 0 };
  return {
    tick: state.clock.tick, round: state.round.index,
    credits: Number(state.ledger.gross) + flight.credits,
    data: Number(state.ledger.dataEarned) + flight.data,
    energy: Number(state.ledger.energy),
  };
}

/** Kept samples: one per simulation second, spanning RATE_WINDOW_S. */
const RATE_WINDOW_S = 2;
const NO_RATES: HudRates = { live: false, creditsPerSec: 0, dataPerSec: 0, workPerSec: 0, efficiency: null, samples: [] };

/** Share of work value left after energy; null without work. */
const efficiencyOf = (work: number, energy: number): number | null => (work > 0 ? (work - energy) / work : null);

/**
 * Running: net Credits, Data and work value per second over the last RATE_WINDOW_S seconds of
 * simulation. Otherwise the last round's averages, so a change made between rounds has a figure to beat.
 * Reuses `prev` within a simulation second.
 */
export function hudRates(state: GameState, prev: HudRates | undefined): HudRates {
  const round = state.round;
  if (round.phase !== 'running') {
    const last = round.reports.at(-1);
    if (!last || last.durationTicks <= 0) return prev && !prev.live && prev.samples.length === 0 && prev.workPerSec === 0 ? prev : NO_RATES;
    const seconds = last.durationTicks / TICKS_PER_SECOND, gross = Number(last.gross), energy = Number(last.energy);
    const creditsPerSec = (gross - energy) / seconds, dataPerSec = Number(last.data) / seconds, workPerSec = gross / seconds;
    if (prev && !prev.live && prev.creditsPerSec === creditsPerSec && prev.dataPerSec === dataPerSec && prev.workPerSec === workPerSec) return prev;
    return { live: false, creditsPerSec, dataPerSec, workPerSec, efficiency: efficiencyOf(gross, energy), samples: [] };
  }
  const second = Math.floor(state.clock.tick / TICKS_PER_SECOND);
  const kept = prev?.live ? prev.samples.filter((x) => x.round === round.index && x.tick <= state.clock.tick) : [];
  const newest = kept.at(-1);
  if (prev?.live && newest && Math.floor(newest.tick / TICKS_PER_SECOND) === second) return prev;
  const now = workSample(state);
  // Keep back to the newest sample a full window old. After a jump in simulation time that is the last one taken.
  let base = 0;
  for (let i = 0; i < kept.length; i += 1) if (now.tick - kept[i]!.tick >= RATE_WINDOW_S * TICKS_PER_SECOND) base = i;
  const samples = [...kept.slice(base), now];
  const from = samples[0]!, seconds = (now.tick - from.tick) / TICKS_PER_SECOND;
  if (!(seconds > 0)) return { live: true, creditsPerSec: 0, dataPerSec: 0, workPerSec: 0, efficiency: null, samples };
  const work = Math.max(0, now.credits - from.credits) / seconds, energy = (now.energy - from.energy) / seconds;
  return {
    live: true, workPerSec: work, creditsPerSec: work - energy, dataPerSec: Math.max(0, now.data - from.data) / seconds,
    efficiency: efficiencyOf(work, energy), samples,
  };
}
