import { G } from '../core/buffers';
import { RATE_RING_TICKS, SLA_THRESHOLD } from '../core/constants';
import { tallyFailed } from '../core/events';
import { recordFailures } from '../core/failures';
import { pushOutcomes, resetSlaWindow, slaChecking, slaValue, slaWindow } from '../core/sla';
import type { World } from '../core/world';
import { FAIL_CAUSES, NO_DETAIL, type FailCause } from '../types/events';
import { FAMILIES } from './families';

/**
 * SLA (D28, spec §4.2): completed over completed plus failed, counting tasks, over the last 50 resolved
 * tasks of the round; the 80% check waits for 10 resolved tasks. Work sums are still kept for the round report. Every domain reports outcomes through core/events tallyMet / tallyFailed with their
 * work; the market folds this tick's tallies into the round sums at the SLA step.
 */

const CAUSES = FAIL_CAUSES.length;
export const CAUSE_INDEX = Object.fromEntries(FAIL_CAUSES.map((c, i) => [c, i])) as Readonly<Record<FailCause, number>>;

export const slaBelowThreshold = (w: World): boolean => {
  const g = w.hot.g, win = slaWindow(g);
  return slaChecking(g[G.met]! + g[G.failed]!) && slaValue(win.met, win.failed) < SLA_THRESHOLD;
};

/** Fails `count` tasks of `family` (`work` ops in total) with `cause` and a FAIL_DETAILS index (D5.3). */
export function failTasks(w: World, family: number, cause: FailCause, count: number, work: number, detail: number = NO_DETAIL, taskId?: number): void {
  if (count <= 0) return;
  tallyFailed(w, family, CAUSE_INDEX[cause], count, work, detail);
  if (w.completions?.failures && taskId !== undefined) recordFailures(w, family, CAUSE_INDEX[cause], count, taskId);
}

/** Adds this tick's met and failed tallies and work to the round counters and this tick's rate row. */
export function countOutcomes(w: World): void {
  const g = w.hot.g;
  const { metTick, failTick } = w.hot.fam;
  const ring = w.hot.ring;
  const row = w.tick % RATE_RING_TICKS;
  let met = 0, failed = 0;
  for (let c = 0; c < CAUSES; c += 1) ring.failBy[row * CAUSES + c] = 0;
  for (let f = 0; f < FAMILIES.length; f += 1) {
    met += metTick[f]!;
    for (let c = 0; c < CAUSES; c += 1) {
      const n = failTick[f * CAUSES + c]!;
      if (n === 0) continue;
      failed += n;
      g[G.fail + c] = g[G.fail + c]! + n;
      ring.failBy[row * CAUSES + c] = ring.failBy[row * CAUSES + c]! + n;
    }
  }
  ring.met[row] = met;
  ring.failed[row] = failed;
  if (met !== 0) { g[G.met] = g[G.met]! + met; g[G.lastMetTick] = w.tick; }
  if (failed !== 0) g[G.failed] = g[G.failed]! + failed;
  pushOutcomes(g, met, failed);
  g[G.deliveredWork] = g[G.deliveredWork]! + g[G.metWorkTick]!;
  g[G.failedWork] = g[G.failedWork]! + g[G.failWorkTick]!;
  g[G.metWorkTick] = 0;
  g[G.failWorkTick] = 0;
}

export function resetCounters(w: World): void {
  const g = w.hot.g;
  g[G.met] = 0; g[G.failed] = 0; g[G.taken] = 0; g[G.dismissed] = 0;
  g[G.deliveredWork] = 0; g[G.failedWork] = 0; g[G.metWorkTick] = 0; g[G.failWorkTick] = 0; g[G.ramWork] = 0; g[G.diskWork] = 0;
  for (let c = 0; c < CAUSES; c += 1) g[G.fail + c] = 0;
  resetSlaWindow(g);
  w.hot.detailRound.fill(0);
  w.hot.fam.metWorkRound.fill(0);
  w.hot.fam.failedWorkRound.fill(0);
  w.hot.fam.dismissedRound.fill(0);
}

export function failCounts(w: World): Record<FailCause, number> {
  const g = w.hot.g;
  return Object.fromEntries(FAIL_CAUSES.map((c, i) => [c, g[G.fail + i]!])) as Record<FailCause, number>;
}
