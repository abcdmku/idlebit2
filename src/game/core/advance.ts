import { FAIL_CAUSES } from '../types/events';
import type { FailCounts } from '../types/events';
import type { AdvanceReport, AdvanceResult } from '../types/report';
import type { GameState } from '../types/state';
import { physSettled } from '../phys';
import { flushPowerStamps } from '../phys/powerCache';
import { cloneHot, G } from './buffers';
import { TICK_MS } from './constants';
import { runTick } from './tick';
import { timersPending } from './timers';
import { newTouchLog, retireTouchLog } from './touch';
import { commitWorld, openWorld, toAmount, type World } from './world';

/** Vite sets this; Node scripts (bench, probes) run as production. */
const DEV = import.meta.env?.DEV === true;
const CONSUMED = 'advanceGameOwned: this state was consumed by an owned advance; use the returned state';

/** DEV only: every later read of a consumed state throws, so a stale reference fails loudly. */
function consume(state: GameState): void {
  for (const key of Object.keys(state)) {
    Object.defineProperty(state, key, { get() { throw new Error(CONSUMED); }, enumerable: true, configurable: false });
  }
}

const failCounts = (failed: readonly number[]): FailCounts =>
  Object.fromEntries(FAIL_CAUSES.map((cause, i) => [cause, failed[i] ?? 0])) as FailCounts;

const ZERO_FAILS = failCounts([]);

function emptyReport(): AdvanceReport {
  const zero = toAmount(0n);
  return { ticks: 0, activeTicks: 0, met: 0, failedByCause: ZERO_FAILS, gross: zero, data: zero, energy: zero, net: zero, roundsEnded: [], researchCompleted: [] };
}

/**
 * A tick changes nothing but the tick index when the round is not running, research does not
 * run, no transition is pending, no record exists and phys is settled (architecture §1.1).
 */
export function isQuiescent(w: World): boolean {
  if (w.round.phase === 'running') return false;
  if (w.research.active !== null && !w.research.stoppedInsolvent) return false;
  // QA-04: a stopped project with Credits back resumes at the next ledger step.
  if (w.research.stoppedInsolvent && w.ledger.credits >= 0n) return false;
  if (w.hot.g[G.recUsed] !== 0 || w.hot.g[G.parentUsed] !== 0 || w.hot.g[G.rqTotal] !== 0) return false;
  if (timersPending(w)) return false;
  return physSettled(w);
}

/** The first tick at which a quiescent world wakes by itself (auto-return), or Infinity. */
export const nextWakeTick = (w: World): number => w.round.autoReturnTick ?? Infinity;

/**
 * Advances by a non-negative integer number of ms (architecture §1.1). Runs floor((carry + ms) /
 * TICK_MS) identical ticks and keeps the remainder, so advance(a + b) ≡ advance(b) ∘ advance(a).
 * Pure: `state` is left unchanged. The reference for advanceGameOwned.
 */
export function advanceGame(state: GameState, elapsedMs: number): AdvanceResult {
  return advance(state, elapsedMs, false);
}

/**
 * advanceGame for the sole holder of `state` (decisions D9): updates its hot buffers in place
 * instead of copying them, and returns the same result advanceGame would. `state` is consumed;
 * in DEV builds any later read of it throws.
 */
export function advanceGameOwned(state: GameState, elapsedMs: number): AdvanceResult {
  const result = advance(state, elapsedMs, true);
  if (DEV) consume(state);
  return result;
}

function advance(state: GameState, elapsedMs: number, owned: boolean): AdvanceResult {
  if (!Number.isSafeInteger(elapsedMs) || elapsedMs < 0) {
    throw new RangeError(`advanceGame: elapsedMs must be a non-negative safe integer, got ${elapsedMs}`);
  }
  const carry = state.clock.carryMs + elapsedMs;
  const ticks = Math.floor(carry / TICK_MS);
  const carryMs = carry % TICK_MS;
  if (ticks === 0) return { state: { ...state, clock: { tick: state.clock.tick, carryMs } }, report: emptyReport() };

  const w = openWorld(state, owned);
  w.touch = newTouchLog();
  const target = state.clock.tick + ticks;
  while (w.tick < target) {
    if (isQuiescent(w)) {
      const wake = nextWakeTick(w);
      if (wake > w.tick) { w.tick = Math.min(target, wake); continue; }
    }
    runTick(w);
  }
  flushPowerStamps(w);
  retireTouchLog(w.touch);
  w.touch = undefined;

  const l = w.ledger;
  const report: AdvanceReport = {
    ticks, activeTicks: w.report.activeTicks, met: w.report.met, failedByCause: failCounts(w.report.failed),
    gross: toAmount(l.callGross), data: toAmount(l.callData), energy: toAmount(l.callEnergy),
    net: toAmount(l.callGross - l.callEnergy),
    roundsEnded: w.report.roundsEnded, researchCompleted: w.report.researchCompleted,
  };
  return { state: commitWorld(state, w, carryMs), report };
}

/**
 * A state equal to `state` whose hot buffers are its own (the only layer an owned advance writes),
 * so it can go to advanceGameOwned while `state` stays live.
 */
export const copyGameState = (state: GameState): GameState => ({ ...state, hot: cloneHot(state.hot) });

/** An owned offline session never inherits the live view's completion/failure observer. */
export const copyOfflineState = (state: GameState): GameState => ({ ...state, hot: cloneHot(state.hot, false) });
