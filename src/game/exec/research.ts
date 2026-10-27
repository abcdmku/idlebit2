import { G } from '../core/buffers';
import { MODE } from '../core/timers';
import type { World } from '../core/world';
import { hwThreads } from './est';

/**
 * Research rate (D27, spec §11.2). Research is a task that cuts the line: it runs only on the
 * systems that took it (`hot.sys.researchThreads`), on the threads they hold for it, during a round
 * and between rounds alike. There are no research shares: tasks always run at full rate, and idle
 * threads and GPUs do not research. Exec tallies research ops into G.researchOps; build applies
 * them (R22). Taking, holding and releasing live in researchTask.ts.
 */

/** Some system holds the research task this tick. */
export const researchOn = (w: World): boolean => w.hot.g[G.researchHolders]! > 0;

/** The task share of compute and GPU rates. D27 retired the research shares: always 1. */
export const taskShare = (_w: World): number => 1;

/** Modes in which a holder researches: on the market, or paused between rounds (D27.4). */
const RESEARCH_MODE = new Uint8Array(32);
RESEARCH_MODE[MODE.onMarket] = 1; RESEARCH_MODE[MODE.paused] = 1;
export const researchesInMode = (mode: number): boolean => RESEARCH_MODE[mode] === 1;

/**
 * Research ops/s of system s at e = 1, plus busy cores for phys (sys.busy, R16). Pure read except
 * sys.busy. Reservations persist through GPU, RAM and IO stages, but only CPU-stage
 * threads and research consume core load power. Waiting for a device is not CPU work.
 */
export function researchRateOf(w: World, s: number, _share: number): number {
  const c = w.compiled.sys, h = w.hot.sys;
  const threads = hwThreads(w, s);
  const held = h.researchThreads[s]!;
  let working = held;
  const rec = w.hot.rec;
  for (let r = h.head[s * 4]!; r >= 0; r = rec.next[r]!) working += rec.count[r]! * rec.threads[r]!;
  h.busy[s] = threads > 0 ? (Math.min(threads, working) / threads) * c.cores[s]! : 0;
  if (held === 0 || RESEARCH_MODE[h.mode[s]!] !== 1) return 0;
  // QA-03: a holder that took research while every thread ran a task researches only on threads tasks have freed.
  const ready = Math.min(held, Math.max(0, threads - (h.busyThreads[s]! - held)));
  return c.threadRate[s]! * h.clockFactor[s]! * c.etaCfg[s]! * ready;
}

/** Accelerators never research under D27: the work is compute. */
export const acceleratorResearchOn = (_w: World, _s: number): boolean => false;
