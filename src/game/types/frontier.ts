import type { ResearchId } from './ids';

/**
 * How far the player has ever got (D40). Every round restarts at I 0 (D30), so totals alone can't
 * say "farther". Saved; updated at each round end.
 */
export interface FrontierState {
  /** Best peak I of any ended round, 0 before the first end, and the round it happened in (0 = none). */
  readonly bestI: number;
  readonly bestRound: number;
  /** Most tasks completed in one round, and that round (0 = none): the report's tier ladder. */
  readonly bestMet: number;
  readonly bestMetRound: number;
}

/** Progress toward the next milestone node: funds while saving, work once its project is paid. */
export interface RunwayMark {
  readonly node: ResearchId;
  readonly phase: 'saving' | 'research';
  /** 0–1: the binding currency's share of its cost while saving, else the project's work share. */
  readonly progress: number;
}

/** Frozen into each report (D40): the frontier before the round and the runway at its start and end. */
export interface ReportFrontier {
  /** Best peak I before this round (0 on the first). */
  readonly priorBest: number;
  readonly priorBestRound: number;
  /** Most tasks completed in one round before this one (0 on the first). */
  readonly priorBestMet: number;
  readonly runwayStart: RunwayMark | null;
  readonly runwayEnd: RunwayMark | null;
}

/** The report's reach history, memoized on the reports. */
export interface FrontierView {
  readonly bestI: number;
  readonly bestRound: number;
  /** Peak I of each kept report, oldest first, with its round index. */
  readonly reaches: readonly { readonly round: number; readonly peak: number }[];
}
