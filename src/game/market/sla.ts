import { G } from '../core/buffers';
import { RATE_RING_TICKS, SLA_THRESHOLD } from '../core/constants';
import { tallyFailed } from '../core/events';
import { slaValue } from '../core/sla';
import type { World } from '../core/world';
import { FAIL_CAUSES, NO_DETAIL, type FailCause } from '../types/events';
import { FAMILIES } from './families';

/**
 * Work-weighted SLA (program D10.6, spec §4.2): SLA = (delivered + G) / (delivered + failed + G),
 * in ops. Every domain reports outcomes through core/events tallyMet / tallyFailed with their
 * work; the market folds this tick's tallies into the round sums at the SLA step.
 */

const CAUSES = FAIL_CAUSES.length;
export const CAUSE_INDEX = Object.fromEntries(FAIL_CAUSES.map((c, i) => [c, i])) as Readonly<Record<FailCause, number>>;

export const slaBelowThreshold = (w: World): boolean =>
  slaValue(w.hot.g[G.deliveredWork]!, w.hot.g[G.failedWork]!, w.round.grace) < SLA_THRESHOLD;

/** Fails `count` tasks of `family` (`work` ops in total) with `cause` and a FAIL_DETAILS index (D5.3). */
export function failTasks(w: World, family: number, cause: FailCause, count: number, work: number, detail: number = NO_DETAIL): void {
  if (count > 0) tallyFailed(w, family, CAUSE_INDEX[cause], count, work, detail);
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
  if (met !== 0) g[G.met] = g[G.met]! + met;
  if (failed !== 0) g[G.failed] = g[G.failed]! + failed;
  g[G.deliveredWork] = g[G.deliveredWork]! + g[G.metWorkTick]!;
  g[G.failedWork] = g[G.failedWork]! + g[G.failWorkTick]!;
  g[G.metWorkTick] = 0;
  g[G.failWorkTick] = 0;
}

export function resetCounters(w: World): void {
  const g = w.hot.g;
  g[G.met] = 0; g[G.failed] = 0; g[G.taken] = 0; g[G.dismissed] = 0;
  g[G.deliveredWork] = 0; g[G.failedWork] = 0; g[G.metWorkTick] = 0; g[G.failWorkTick] = 0;
  for (let c = 0; c < CAUSES; c += 1) g[G.fail + c] = 0;
  w.hot.detailRound.fill(0);
}

export function failCounts(w: World): Record<FailCause, number> {
  const g = w.hot.g;
  return Object.fromEntries(FAIL_CAUSES.map((c, i) => [c, g[G.fail + i]!])) as Record<FailCause, number>;
}
