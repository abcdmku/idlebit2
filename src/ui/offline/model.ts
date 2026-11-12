// What the offline return report shows (spec §15) and when it is worth showing at all.
import { FAIL_CAUSES, TICK_MS } from '../../game';
import type { AdvanceReport, FailCause } from '../../game';

/** A report for less credited time than this is a hiccup (a stalled frame, a tab switch), not an absence. */
export const MIN_REPORT_MS = 60_000;
/** A catch-up of at least this much sim time gets the progress plate; shorter ones finish within a frame or two. */
export const LONG_CATCH_UP_MS = 10 * 60_000;

export const creditedMs = (report: AdvanceReport): number => report.ticks * TICK_MS;

export const failedTotal = (report: AdvanceReport): number =>
  FAIL_CAUSES.reduce((sum, cause) => sum + report.failedByCause[cause], 0);

/** The causes that failed at least one task, most first. */
export function failedCauses(report: AdvanceReport): { cause: FailCause; count: number }[] {
  return FAIL_CAUSES.map(cause => ({ cause, count: report.failedByCause[cause] }))
    .filter(row => row.count > 0).sort((a, b) => b.count - a.count);
}

/** False for a trivially short absence, or one where nothing happened: the player is told nothing. */
export function worthShowing(report: AdvanceReport): boolean {
  if (creditedMs(report) < MIN_REPORT_MS) return false;
  return report.met > 0 || failedTotal(report) > 0 || report.roundsEnded.length > 0 || report.researchCompleted.length > 0
    || Number(report.gross) !== 0 || Number(report.data) !== 0 || Number(report.energy) !== 0;
}

/** The full absence when the offline cap cut it short by a minute or more, else null. */
export function cappedAwayMs(report: AdvanceReport, seen: { readonly awayMs: number; readonly totalMs: number } | null): number | null {
  return seen && seen.awayMs - seen.totalMs >= MIN_REPORT_MS && seen.awayMs - creditedMs(report) >= MIN_REPORT_MS ? seen.awayMs : null;
}

/** Completed research in one short value: the first three names, then how many more. */
export function researchedText(names: readonly string[], shown = 3): string {
  const more = names.length - shown;
  // No-break spaces keep "· +4" on the last name's line.
  return names.slice(0, shown).join(' · ') + (more > 0 ? `\u00a0·\u00a0+${more}` : '');
}

/** Whole minutes of sim time: "42m", "8h 05m", "1d 4h". */
export function durationText(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / 60_000);
  const d = Math.floor(minutes / 1440), h = Math.floor((minutes % 1440) / 60), m = minutes % 60;
  if (d > 0) return h > 0 ? `${d}d ${h}h` : `${d}d`;
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
}
