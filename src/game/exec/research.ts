import { MODE } from '../core/timers';
import type { World } from '../core/world';
import { DRAW_FULL, drawKind } from '../phys/draw';
import { hwThreads } from './est';
import { STORAGE_NODE } from './slots';

/**
 * Research share (program D10.7, spec §11.2, §11.3, architecture §1.6). The queue never runs dry,
 * so every mode reserves a share of the task rate: Background 10%, Shared 25%, Focus all of it.
 * Idle threads and unused GPU still go to research. Offline systems, and every powered system
 * between rounds, give research everything. Exec tallies research ops into G.researchOps; build
 * applies them (R22).
 */

export const BACKGROUND_TASK_SHARE = 0.9;
export const SHARED_TASK_SHARE = 0.75;

export const researchOn = (w: World): boolean => w.research.active !== null && !w.research.stoppedInsolvent;

/** The task share of compute and GPU rates for systems on the market. */
export function taskShare(w: World): number {
  if (!researchOn(w)) return 1;
  switch (w.research.mode) {
    case 'background': return BACKGROUND_TASK_SHARE;
    case 'shared': return SHARED_TASK_SHARE;
    case 'focus': return 0;
  }
}

/** Modes that share with tasks during a round (spec §11.2). */
const SHARED_MODE = new Uint8Array(32);
SHARED_MODE[MODE.onMarket] = 1; SHARED_MODE[MODE.boot] = 1; SHARED_MODE[MODE.goingOffline] = 1; SHARED_MODE[MODE.draining] = 1;
/** Modes that never research: no power or no market presence (spec §11.2, §11.3). */
const DEAD_MODE = new Uint8Array(32);
DEAD_MODE[MODE.empty] = 1; DEAD_MODE[MODE.dark] = 1; DEAD_MODE[MODE.crashed] = 1; DEAD_MODE[MODE.cold] = 1; DEAD_MODE[MODE.asleep] = 1;

/**
 * Research ops/s of system s at e = 1, plus busy cores for phys (sys.busy, R16). Pure read except
 * sys.busy. Called once per system per tick that researches.
 */
export function researchRateOf(w: World, s: number, share: number): number {
  const c = w.compiled.sys, h = w.hot.sys;
  const threads = hwThreads(w, s);
  const perThread = c.threadRate[s]! * h.clockFactor[s]! * c.etaCfg[s]!;
  const mode = h.mode[s]!;
  const busyTask = Math.min(threads, h.busyThreads[s]!);
  if (!researchOn(w) || DEAD_MODE[mode] === 1 || c.kind[s] === STORAGE_NODE) {
    h.busy[s] = (busyTask / threads) * c.cores[s]!;
    return 0;
  }
  const full = w.round.phase !== 'running' || mode === MODE.offline;
  h.busy[s] = c.cores[s]!;
  if (full) return threads * perThread;
  if (SHARED_MODE[mode] !== 1) { h.busy[s] = (busyTask / threads) * c.cores[s]!; return 0; }
  return perThread * (threads - busyTask + busyTask * (1 - share));
}

/** Accelerator research follows CPU permission, plus the full-draw power-mode rule. */
export function acceleratorResearchOn(w: World, s: number): boolean {
  const mode = w.hot.sys.mode[s]!;
  if (!researchOn(w) || drawKind(mode, true) !== DRAW_FULL || DEAD_MODE[mode] === 1 || w.compiled.sys.kind[s] === STORAGE_NODE) return false;
  return w.round.phase !== 'running' || mode === MODE.offline || SHARED_MODE[mode] === 1;
}

