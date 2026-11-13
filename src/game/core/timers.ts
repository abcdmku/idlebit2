import { UNIT_MODES } from '../types/views';
import { wakeRouters } from './routerQueue';
import { MODE, noteModeChange } from './modes';
import { dirtySystem, touchSummary } from './touch';
import type { World } from './world';

export { MODE } from './modes';

/** Modes whose `timer` counts down to a transition end (spec §4.3, §4.4, §4.5). */
const TIMED = new Uint8Array(UNIT_MODES.length);
TIMED[MODE.boot] = 1;
TIMED[MODE.goingOffline] = 1;
TIMED[MODE.cold] = 1;

/**
 * Timer columns the last timers phase found with no transition counting down (derived, never state).
 * setUnitMode is the only writer of a live timer, and it drops the column when it starts one, so a
 * listed column needs no scan. A copied, loaded or regrown column is a new array and is scanned.
 */
const idleTimers = new WeakSet<Int32Array>();

/** Sets a system's mode and transition timer (ticks). Dirties the rack on a change. */
export function setUnitMode(w: World, sys: number, mode: number, timerTicks = 0): void {
  if (timerTicks > 0) idleTimers.delete(w.hot.sys.timer);
  if (w.hot.sys.mode[sys] !== mode) {
    noteModeChange(w.hot.sys.mode[sys]!, mode);
    dirtySystem(w, sys);
    touchSummary(w, w.compiled.sys.rack[sys]!);
    wakeRouters(w, 0, w.compiled.sys.rack[sys]!);
  }
  w.hot.sys.mode[sys] = mode;
  w.hot.sys.timer[sys] = timerTicks;
}

/**
 * The mode a system rests in when no transition holds it (spec §4.3):
 * paused between rounds, offline if its switch or an ancestor's is off, otherwise on market.
 * S3 sleep and research use are layered on by phys and exec.
 */
export function restingMode(w: World, sys: number): number {
  if (w.compiled.sys.alive[sys] !== 1) return MODE.empty;
  if (w.round.phase !== 'running') return MODE.paused;
  if (w.compiled.sys.intent[sys] !== 1) return MODE.offline;
  // D31: a rack a start controller holds powered off keeps its systems in standby.
  return w.hot.rack.powered[w.compiled.sys.rack[sys]!] === 0 ? MODE.standby : MODE.onMarket;
}

/** Starts the one boot time (D1.8) on a system: online boot, going offline, or a cold change. */
export function startTransition(w: World, sys: number, mode: 'boot' | 'goingOffline' | 'cold'): void {
  setUnitMode(w, sys, MODE[mode], w.research.unlocks.bootTicks);
}

/**
 * Timers phase (tick step 1): counts down system transitions and applies those that end.
 * Auto-return fires right after it, still in step 1 (core/tick.ts).
 */
export function timerPhase(w: World): void {
  const { mode, timer } = w.hot.sys;
  if (idleTimers.has(timer)) return;
  const n = w.hot.sys.len;
  let counting = false;
  for (let s = 0; s < n; s += 1) {
    const t = timer[s]!;
    if (t <= 0 || TIMED[mode[s]!] !== 1) continue;
    if (t > 1) { timer[s] = t - 1; counting = true; continue; }
    timer[s] = 0;
    const next = mode[s] === MODE.goingOffline ? MODE.offline : restingMode(w, s);
    if (next !== mode[s]) {
      noteModeChange(mode[s]!, next);
      dirtySystem(w, s); touchSummary(w, w.compiled.sys.rack[s]!); wakeRouters(w, 0, w.compiled.sys.rack[s]!);
    }
    mode[s] = next;
  }
  if (!counting) idleTimers.add(timer);
}

/** True when auto-return is due this tick (a named deadline, spec §4.6). */
export function autoReturnDue(w: World): boolean {
  const at = w.round.autoReturnTick;
  return at !== null && w.tick >= at && w.round.phase !== 'running';
}

/** True when any system transition is pending (the quiescent skip must not jump it). */
export function timersPending(w: World): boolean {
  const { mode, timer } = w.hot.sys;
  for (let s = 0; s < w.hot.sys.len; s += 1) if (timer[s]! > 0 && TIMED[mode[s]!] === 1) return true;
  return false;
}
