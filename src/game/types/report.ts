import type { Amount } from '../amount';
import type { FailCause, FailCounts, FailDetail } from './events';
import type { GameState } from './state';
import type { ResearchId } from './ids';

/** Frozen at round end (spec §4.7). Credits and Data are integer Amounts. */
export interface RoundReport {
  readonly index: number;
  readonly startTick: number;
  readonly durationTicks: number;
  readonly durationMs: number;
  readonly met: number;
  readonly failedByCause: FailCounts;
  /** Most common detail per cause this round, or null. */
  readonly failDetail: Readonly<Record<FailCause, FailDetail | null>>;
  /** (cause, detail) counts, count descending, at most 6. */
  readonly details: readonly { readonly cause: FailCause; readonly detail: FailDetail; readonly count: number }[];
  readonly peakIntensity: number;
  /** Tasks dismissed this round (free; outside the SLA). */
  readonly dismissed: number;
  /** The SLA sums in ops (spec §4.2). */
  readonly deliveredWork: number;
  readonly failedWork: number;
  readonly gross: Amount;
  readonly data: Amount;
  readonly energy: Amount;
  readonly net: Amount;
  readonly researchOps: number;
}

export interface AdvanceReport {
  readonly ticks: number;
  /** Ticks where the round was running. */
  readonly activeTicks: number;
  readonly met: number;
  readonly failedByCause: FailCounts;
  readonly gross: Amount;
  readonly data: Amount;
  readonly energy: Amount;
  readonly net: Amount;
  readonly roundsEnded: readonly RoundReport[];
  readonly researchCompleted: readonly ResearchId[];
}

export interface AdvanceResult {
  readonly state: GameState;
  readonly report: AdvanceReport;
}
