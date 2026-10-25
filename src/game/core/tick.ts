import { researchPhase } from '../build';
import { admitPhase, runPhase } from '../exec';
import { latePhase } from '../exec/outcome';
import { deadlinePhase, marketPhase, promoteHead, roundPhase, startRound } from '../market';
import { researchTakePhase } from '../exec/researchTask';
import { linkPhase, routePhase } from '../net';
import { powerPhase, thermalPhase } from '../phys';
import { eventPhase } from './events';
import { ledgerPhase } from './ledger';
import { autoReturnDue, timerPhase } from './timers';
import type { World } from './world';

export type Phase = (w: World) => void;

/**
 * Step 1: system transitions, then auto-return (Return to market inside the tick, spec §4.6).
 * Auto-return lives here, not in core/timers, so core/timers never imports a domain and any
 * domain may import core/timers at load time.
 */
export function timersStep(w: World): void {
  timerPhase(w);
  if (autoReturnDue(w)) {
    w.round.autoReturnTick = null;
    startRound(w);
  }
}

/**
 * Step 4: the research task first (D27: it cuts the line; once taken, the next task is head with a
 * fresh 10 s), then routing.
 */
export function routeStep(w: World): void {
  if (researchTakePhase(w) && w.round.phase === 'running') promoteHead(w);
  routePhase(w);
}

/** Step 7: the head's clock, then completion windows (D26.5). */
export function deadlinesStep(w: World): void {
  deadlinePhase(w);
  latePhase(w);
}

/**
 * The 13 tick phases in their fixed order (architecture §1.2, spec §14.1). A tick reads only
 * state at its start and earlier phases of the same tick; rates hold for the whole tick.
 */
export const PHASES: readonly (readonly [name: string, phase: Phase])[] = [
  ['timers', timersStep],
  ['market', marketPhase],
  ['links', linkPhase],
  ['route', routeStep],
  ['admit', admitPhase],
  ['run', runPhase],
  ['deadlines', deadlinesStep],
  ['power', powerPhase],
  ['thermal', thermalPhase],
  ['ledger', ledgerPhase],
  ['round', roundPhase],
  ['research', researchPhase],
  ['events', eventPhase],
];

/** Runs tick `w.tick`, then advances `w.tick` by one. */
export function runTick(w: World): void {
  w.late = false;
  if (w.round.phase === 'running') w.report.activeTicks += 1;
  timersStep(w);
  marketPhase(w);
  linkPhase(w);
  routeStep(w);
  admitPhase(w);
  runPhase(w);
  deadlinesStep(w);
  powerPhase(w);
  thermalPhase(w);
  ledgerPhase(w);
  roundPhase(w);
  researchPhase(w);
  eventPhase(w);
  w.tick += 1;
}
