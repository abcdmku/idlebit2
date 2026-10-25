import { UNIT_MODES } from '../types/views';
import { wakeRouters } from './routerQueue';
import { MODE } from './modes';
import { dirtySystem, touchSummary } from './touch';
import type { World } from './world';

export { MODE } from './modes';

/** Modes whose `timer` counts down to a transition end (spec §4.3, §4.4, §4.5). */
const TIMED = new Uint8Array(UNIT_MODES.length);
TIMED[MODE.boot] = 1;
TIMED[MODE.goingOffline] = 1;
TIMED[MODE.cold] = 1;

/** Sets a system's mode and transition timer (ticks). Phys uses this for dark and crashed. Dirties the rack on a change. */
export function setUnitMode(w: World, sys: number, mode: number, timerTicks = 0): void {
  if (w.hot.sys.mode[sys] !== mode) {
    dirtySystem(w, sys);
    touchSummary(w, w.compiled.sys.rack[sys]!);
    wakeRouters(w, 0, w.compiled.sys.rack[sys]!);
  }
  w.hot.sys.mode[sys] = mode;
  w.hot.sys.timer[sys] = timerTicks;
}

/**
 * The mode a system rests in when no transition, failure or crash holds it (spec §4.3):
 * paused between rounds, offline if its switch or an ancestor's is off, otherwise on market.
 * S3 sleep and research use are layered on by phys and exec.
 */
export function restingMode(w: World, sys: number): number {
  if (w.compiled.sys.alive[sys] !== 1) return MODE.empty;
  if (w.round.phase !== 'running') return MODE.paused;
  return w.compiled.sys.intent[sys] === 1 ? MODE.onMarket : MODE.offline;
}

/** Starts the one boot time (D1.8) on a system: online boot, going offline, or a cold change. */
export function startTransition(w: World, sys: number, mode: 'boot' | 'goingOffline' | 'cold'): void {
  setUnitMode(w, sys, MODE[mode], w.research.unlocks.bootTicks);
}

/**
 * Timers phase (tick step 1): counts down system transitions and applies those that end.
 * Auto-return fires right after it, still in step 1 (core/tick.ts). Supply reboots and crash
 * recoveries are phys timers (power and thermal phases).
 */
export function timerPhase(w: World): void {
  const { mode, timer } = w.hot.sys;
  const n = w.hot.sys.len;
  for (let s = 0; s < n; s += 1) {
    const t = timer[s]!;
    if (t <= 0 || TIMED[mode[s]!] !== 1) continue;
    if (t > 1) { timer[s] = t - 1; continue; }
    timer[s] = 0;
    const next = mode[s] === MODE.goingOffline ? MODE.offline : restingMode(w, s);
    if (next !== mode[s]) { dirtySystem(w, s); touchSummary(w, w.compiled.sys.rack[s]!); wakeRouters(w, 0, w.compiled.sys.rack[s]!); }
    mode[s] = next;
  }
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
