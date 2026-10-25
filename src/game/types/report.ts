import type { Amount } from '../amount';
import type { FailCause, FailCounts, FailDetail } from './events';
import type { GameState } from './state';
import type { ResearchId } from './ids';
import type { TaskTypeId } from './views';

export interface RoundTypeTally {
  readonly type: TaskTypeId;
  readonly metWork: number;
  readonly failedWork: number;
  readonly dismissed: number;
}

/** Why a round ended: SLA fell below 80%, the player ended it (endRound, spec §4.1), or nothing was met for 2 min (D33). */
export type RoundEndedBy = 'sla' | 'player' | 'stall';

/** Frozen at round end (spec §4.7). Credits and Data are integer Amounts. */
export interface RoundReport {
  readonly endedBy: RoundEndedBy;
  /** Only types with met/failed work or dismissals, in D23 display order. */
  readonly byType: readonly RoundTypeTally[];
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
  /**
   * D26: of deliveredWork, the work of met tasks weighted by their RAM and disk traffic share: Σ bits
   * their shards touched in RAM and on disk. "From disk: 18% of work" is diskWork / deliveredWork.
   */
  readonly spill: { readonly ramWork: number; readonly diskWork: number };
  readonly gross: Amount;
  readonly data: Amount;
  readonly energy: Amount;
  readonly net: Amount;
  readonly researchOps: number;
  /**
   * D31: where the round's energy came from. billed = energy (imported and fuel, plus the battery refill);
   * fromBattery and fromGeneration are joules-worth of Credits not billed at the region price.
   */
  readonly energyBreakdown: EnergyBreakdown;
}
/** D31 round energy lines, whole Credits. */
export interface EnergyBreakdown {
  readonly billed: Amount;
  /** Unbilled: drawn from rack batteries, at the region price. */
  readonly fromBattery: Amount;
  /** Billed at Return: rack battery refills at 25% of the site marginal price. */
  readonly batteryRefill: Amount;
  /** Unbilled at the region price: met by site generation. */
  readonly fromGeneration: Amount;
  /** Billed: generation fuel. */
  readonly fuel: Amount;
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
