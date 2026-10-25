import { amountAdd } from '../game/amount';
import { FAIL_CAUSES, type AdvanceReport, type FailCounts } from '../game';

const addFails = (a: FailCounts, b: FailCounts): FailCounts =>
  Object.fromEntries(FAIL_CAUSES.map(cause => [cause, a[cause] + b[cause]])) as FailCounts;

/** Folds consecutive advance reports into one, as if a single call had covered both spans. */
export function mergeReports(total: AdvanceReport | null, next: AdvanceReport): AdvanceReport {
  if (!total) return next;
  return {
    ticks: total.ticks + next.ticks,
    activeTicks: total.activeTicks + next.activeTicks,
    met: total.met + next.met,
    failedByCause: addFails(total.failedByCause, next.failedByCause),
    gross: amountAdd(total.gross, next.gross),
    data: amountAdd(total.data, next.data),
    energy: amountAdd(total.energy, next.energy),
    net: amountAdd(total.net, next.net),
    roundsEnded: next.roundsEnded.length ? [...total.roundsEnded, ...next.roundsEnded] : total.roundsEnded,
    researchCompleted: next.researchCompleted.length ? [...total.researchCompleted, ...next.researchCompleted] : total.researchCompleted,
  };
}
