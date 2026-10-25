import type { Amount } from '../amount';
import type { CompiledBuffers, HotBuffers } from '../core/buffers';
import type { BuildState, SavedConfigs } from './build';
import type { CeilingId, FilterId, PartId, QueueStrategyId, RouteStrategyId, RuleId } from './catalog';
import type { EventRing } from './events';
import type { FamilyId, LevelId, ResearchId } from './ids';
import type { RoundReport } from './report';

export type { CompiledBuffers, HotBuffers } from '../core/buffers';

/**
 * Plain state must be JSON-safe: no NaN, ±Infinity, -0 or undefined (use null).
 * Typed arrays live only in `compiled` and `hot`.
 */
export interface GameState {
  readonly schema: 'bitrouge-v3';
  /** Bumps on reset. */
  readonly epoch: number;
  readonly seed: number;
  readonly clock: Clock;
  readonly wallet: Wallet;
  readonly ledger: LedgerState;
  readonly round: RoundState;
  readonly market: MarketState;
  readonly build: BuildState;
  readonly research: ResearchState;
  readonly configs: SavedConfigs;
  /** Derived from build + research. Never written by the tick; replaced copy-on-write by actions. */
  readonly compiled: CompiledBuffers;
  /** Runtime typed arrays the tick mutates; cloned once per advance call that ticks. */
  readonly hot: HotBuffers;
  readonly events: EventRing;
}

/** `tick` = ticks completed. simTimeMs = tick × TICK_MS + carryMs. 0 <= carryMs < TICK_MS. */
export interface Clock { readonly tick: number; readonly carryMs: number }

/** Credits and Data are whole numbers (D2, D3). Meters hold the sub-unit remainder in [0, 1). */
export interface Wallet {
  readonly credits: Amount;
  readonly data: Amount;
  readonly energyMeter: number;
  readonly dataMeter: number;
}

/** One sample per second at which lifetime gross or energy changed (change points only). */
export interface LedgerSample { readonly tick: number; readonly gross: Amount; readonly energy: Amount }
export interface LedgerState {
  /** Lifetime totals, whole units. */
  readonly gross: Amount;
  readonly energy: Amount;
  readonly dataEarned: Amount;
  readonly creditsSpent: Amount;
  readonly dataSpent: Amount;
  /** Change points over at least the last 60 s, oldest first (spec §16.1 net/min). */
  readonly netRing: readonly LedgerSample[];
}

export type RoundPhase = 'running' | 'ended' | 'between';
export interface RoundState {
  readonly phase: RoundPhase;
  /** 1-based; a new game starts in round 1, running. */
  readonly index: number;
  readonly startTick: number;
  /** Tick at which the round ended, or null while running / before the first end. */
  readonly endTick: number | null;
  /** Absolute tick at which auto-return fires, or null. A named deadline, not a hardware duration. */
  readonly autoReturnTick: number | null;
  readonly autoReturnOn: boolean;
  readonly peakIntensity: number;
  /** SLA grace prior G in ops (spec §4.2): 10 × the largest opening task's work, fixed at Return. */
  readonly grace: number;
  /** Round totals so far, whole units. met/failed counters and work sums are hot (core/buffers G). */
  readonly gross: Amount;
  readonly data: Amount;
  readonly energy: Amount;
  readonly researchOps: number;
  /** Newest last, at most ROUND_REPORTS_KEPT. */
  readonly reports: readonly RoundReport[];
}

export interface TaskRef {
  readonly epoch: number;
  readonly roundIndex: number;
  readonly taskId: number;
}
/** An untaken task of the endless queue (D10.1): a reserved identity and a frozen descriptor. */
export interface QueuedTask {
  readonly taskId: number;
  readonly family: FamilyId;
  /** Task size, whole units. */
  readonly size: number;
  /** D26.5: completion window in ticks from take, frozen at the draw (ceil(windowS × j / dt)); null when the family has none. */
  readonly deadline: number | null;
}

/**
 * The endless queue (program D10, spec §5.2). Taken work that comes back sits at the queue front,
 * ahead of the window, as committed hot records (G.frontHead); the head is the first front record,
 * else `window[0]`. RNG words and per-family jitter live in hot buffers.
 */
export interface MarketState {
  /** The round the window belongs to: the running round, or the next one between rounds. */
  readonly roundIndex: number;
  /** The next QUEUE_VISIBLE untaken tasks, head first. Refilled at the back whenever one leaves. */
  readonly window: readonly QueuedTask[];
  /** First tick the head may be taken; it fails at the end of tick headTick + 99. */
  readonly headTick: number;
  /** Market intensity I. Between rounds it is the next round's start I (D12.1). */
  readonly intensity: number;
}

export type ResearchMode = 'background' | 'shared' | 'focus';
export interface ResearchState {
  readonly completed: readonly ResearchId[];
  readonly active: ResearchId | null;
  /** Work done on the active project, float64 ops. */
  readonly activeProgress: number;
  /** Projects started (Data paid) and then switched away from, with their progress. */
  readonly parked: Readonly<Record<string, number>>;
  readonly queue: readonly ResearchId[];
  readonly mode: ResearchMode;
  readonly stoppedInsolvent: boolean;
  /** Queue head waits for Data. */
  readonly needsData: boolean;
  /** Derived from `completed` by build/research/effects; cached here. */
  readonly unlocks: Unlocks;
}

/** Everything research grants, flattened for O(1) reads. */
export interface Unlocks {
  readonly levels: Readonly<Record<LevelId, boolean>>;
  /** Bit g set = generation g of the part is buyable. */
  readonly gens: Readonly<Record<PartId, number>>;
  readonly ceilings: Readonly<Record<CeilingId, number>>;
  readonly queueStrategies: readonly QueueStrategyId[];
  readonly routeStrategies: readonly RouteStrategyId[];
  readonly filters: readonly FilterId[];
  readonly rules: readonly RuleId[];
  /** Merged `params` of granted rules, by rule id. */
  readonly ruleParams: Readonly<Partial<Record<RuleId, Readonly<Record<string, number>>>>>;
  /** One boot time (D1.8), whole ticks: 100 at base. */
  readonly bootTicks: number;
  /** Auto-return delay in ticks (spec §4.6). */
  readonly autoReturnDelayTicks: number;
  readonly offlineCapHours: number;
}
