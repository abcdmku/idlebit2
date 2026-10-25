import { G } from '../core/buffers';
import { ROUND_REPORTS_KEPT, TICK_MS } from '../core/constants';
import { pushEvent, roundDetails } from '../core/events';
import { energyBreakdown, resetRoundTotals, roundTotals } from '../core/ledger';
import { MODE, restingMode, setUnitMode } from '../core/timers';
import type { World } from '../core/world';
import type { RoundEndedBy, RoundReport } from '../types/report';
import { dropAllWork } from '../exec';
import { clearFront, graceOf, prepareQueue } from './queue';
import { countOutcomes, failCounts, resetCounters, slaBelowThreshold } from './sla';
import { familyType, TASK_TYPE_IDS } from './taskTypes';
import { FAMILIES } from './families';

function roundTypes(w: World): RoundReport['byType'] {
  const fam = w.hot.fam;
  const rows = TASK_TYPE_IDS.map(type => ({ type, metWork: 0, failedWork: 0, dismissed: 0 }));
  for (let f = 0; f < FAMILIES.length; f += 1) {
    const row = rows[TASK_TYPE_IDS.indexOf(familyType(f))]!;
    row.metWork += fam.metWorkRound[f]!;
    row.failedWork += fam.failedWorkRound[f]!;
    row.dismissed += fam.dismissedRound[f]!;
  }
  return rows.filter(r => r.metWork > 0 || r.failedWork > 0 || r.dismissed > 0);
}

/**
 * Rounds (program §3, D12.1, spec §4.1, §4.6, §4.7). A round starts at Return to market (the
 * action or auto-return), runs while SLA >= 80%, and ends inside the SLA step of the tick that
 * drops it below. Each round opens at the intensity the last one earned.
 */

/** Every system not held by a supply failure or a crash takes its §4.3 resting mode at once. */
function settleModes(w: World): void {
  const mode = w.hot.sys.mode;
  const alive = w.compiled.sys.alive;
  for (let s = 0; s < w.hot.sys.len; s += 1) {
    if (alive[s] !== 1 || mode[s] === MODE.dark || mode[s] === MODE.crashed) continue;
    setUnitMode(w, s, restingMode(w, s));
  }
}

/**
 * Return to market (spec §4.1), legal in `ended` and `between`. Called by the action between ticks
 * and by auto-return inside the timers step; the prepared queue starts at tick `w.tick` either way.
 */
export function startRound(w: World): void {
  if (w.round.phase === 'running') return;
  const r = w.round;
  r.phase = 'running';
  r.index += 1;
  r.startTick = w.tick;
  r.endTick = null;
  r.autoReturnTick = null;
  r.peakIntensity = 0;
  r.grace = graceOf(w.market.window);
  r.researchOps = 0;
  w.market.headTick = w.tick;
  resetRoundTotals(w);
  resetCounters(w);
  settleModes(w);
  w.research.stoppedInsolvent = false;
  pushEvent(w, { kind: 'roundStarted', round: r.index });
}

function freezeReport(w: World, endTick: number, endedBy: RoundEndedBy): RoundReport {
  const r = w.round, g = w.hot.g;
  const durationTicks = endTick - r.startTick;
  return {
    index: r.index, startTick: r.startTick, durationTicks, durationMs: durationTicks * TICK_MS, endedBy,
    byType: roundTypes(w),
    met: g[G.met]!, failedByCause: failCounts(w), ...roundDetails(w.hot.detailRound), peakIntensity: r.peakIntensity,
    dismissed: g[G.dismissed]!, deliveredWork: g[G.deliveredWork]!, failedWork: g[G.failedWork]!,
    spill: { ramWork: g[G.ramWork]!, diskWork: g[G.diskWork]! },
    ...roundTotals(w), researchOps: r.researchOps, energyBreakdown: energyBreakdown(w),
  };
}

/**
 * Ends the running round: drops every task and the rest of the queue without counting them,
 * completes every transition, pauses the hardware, freezes the report, prepares the next round's
 * queue from I = 0 (D30) and arms auto-return. The SLA step ends it inside the tick being run; the
 * endRound action ends it between ticks, after the last tick run (`w.tick` is already the next one).
 */
export function endRound(w: World, endedBy: RoundEndedBy = 'sla'): void {
  const r = w.round;
  const endTick = endedBy === 'player' ? w.tick : w.tick + 1;
  const report = freezeReport(w, endTick, endedBy);
  clearFront(w);
  dropAllWork(w);
  r.phase = 'ended';
  const m = w.market;
  // D30: every round starts from the beginning.
  m.roundIndex = r.index + 1;
  const next = prepareQueue(w.hot, w.seed, r.index + 1, 0);
  m.window = next.tasks;
  m.intensity = next.intensity;
  r.endTick = endTick;
  r.reports = [...r.reports, report].slice(-ROUND_REPORTS_KEPT);
  w.report.roundsEnded.push(report);
  const unlocks = w.research.unlocks;
  r.autoReturnTick = r.autoReturnOn && unlocks.rules.includes('autoReturn') ? r.endTick + unlocks.autoReturnDelayTicks : null;
  settleModes(w);
  pushEvent(w, { kind: 'roundEnded', round: r.index });
}

/** SLA step (tick step 11): count this tick's outcomes; below 80% the round ends now. */
export function roundPhase(w: World): void {
  if (w.round.phase !== 'running') return;
  countOutcomes(w);
  if (slaBelowThreshold(w)) endRound(w);
}
