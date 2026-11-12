import type { FailCause, FailDetail } from './events';
import type { LevelId, NodeRef, UnitRef } from './ids';

/**
 * What is wrong with a unit now, in the order the list sorts by:
 * `hot`: a rack above 80 °F, losing speed through e(T) or thermal throttle (§10.4, §10.7);
 * `offMarket`: its own online switch is off (§4.4).
 * Supplies cannot overload or fail (purchases are refused at the PDU, UPS and grid limits, §9.2) and
 * heat never crashes a unit (§10.7), so there are no such rows.
 */
export const HEALTH_ISSUES = ['hot', 'offMarket'] as const;
export type HealthIssue = (typeof HEALTH_ISSUES)[number];

/** `risk` is a fault; `idle` is a unit the player took off the market. */
export type HealthSeverity = 'risk' | 'idle';

export interface HealthProblem {
  readonly unit: UnitRef;
  /** Where the view shows the unit: its own level (a site is on the World map; a system before System opens is its CPU). */
  readonly target: NodeRef;
  /** In-world names from the outermost opened container to the unit: ["US East", "Zone A", "Rack C", "Server 3"]. */
  readonly path: readonly string[];
  readonly issue: HealthIssue;
  readonly severity: HealthSeverity;
  /** Player words for the unit's most severe issue: "Running hot", "Thermal throttle", "Off market", "7 servers off market". */
  readonly text: string;
  /** The unit's lesser issues, in the same words: ["3 servers off market"]. Usually empty. */
  readonly also: readonly string[];
  /** `hot`: the rack's speed factor e(T). Else null. */
  readonly factor: number | null;
  /** `hot`: the rack's temperature. Else null. */
  readonly tempF: number | null;
}

/** Fleet health (spec §16.1): a bounded list of the units with a problem now, and this round's failures. */
export interface FleetHealthView {
  /** One row per unit, at most the requested limit, most severe first. */
  readonly problems: readonly HealthProblem[];
  /** Every problem unit by its worst severity, the ones beyond the limit included. */
  readonly counts: Readonly<Record<HealthSeverity, number>>;
  /** `risk` while a rack runs hot, or null when no unit is faulty. Off-market units are not faults. */
  readonly fault: 'risk' | null;
  /** The fault among the units each ladder level shows: only racks can be faulty. */
  readonly levels: Readonly<Record<LevelId, 'risk' | null>>;
  /** This round's resolved tasks. `byCause` (most first, zero causes left out) is null until `telemetry` (§16.2). */
  readonly round: {
    readonly met: number; readonly failed: number;
    readonly byCause: readonly { readonly cause: FailCause; readonly count: number; readonly detail: FailDetail | null }[] | null;
  };
}
