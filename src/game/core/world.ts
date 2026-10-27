import type { Amount } from '../amount';
import type { BuildState, SavedConfigs } from '../types/build';
import { FAIL_CAUSES, type GameEvent } from '../types/events';
import type { ResearchId } from '../types/ids';
import type { RoundReport } from '../types/report';
import type { GameState, LedgerSample, MarketState, QueuedTask, ResearchState, RoundState } from '../types/state';
import { cloneHot, type CompiledBuffers, type HotBuffers } from './buffers';
import type { TouchLog } from './touch';
import { completionLog, type CompletionLog } from './completions';

export type Mutable<T> = { -readonly [K in keyof T]: T[K] };
/** The market draft: the window is an owned array the tick shifts and refills in place. */
export type MarketWork = Omit<Mutable<MarketState>, 'window'> & { window: QueuedTask[] };

/** Integer currencies as bigint during an advance; written back as Amount once at commit. */
export interface LedgerWork {
  credits: bigint;
  data: bigint;
  energyMeter: number;
  dataMeter: number;
  /** Lifetime totals. */
  gross: bigint;
  energy: bigint;
  dataEarned: bigint;
  /** Lifetime Credits spent, including research projects started inside a tick. */
  creditsSpent: bigint;
  /** Lifetime Data spent (research starts inside a tick). */
  dataSpent: bigint;
  /** Current round totals. */
  roundGross: bigint;
  roundEnergy: bigint;
  roundData: bigint;
  netRing: LedgerSample[];
  /** This advance call. */
  callGross: bigint;
  callEnergy: bigint;
  callData: bigint;
}
export interface EventWork { nextSeq: number; entries: GameEvent[] }
export interface ReportWork {
  activeTicks: number;
  met: number;
  failed: number[];
  roundsEnded: RoundReport[];
  researchCompleted: ResearchId[];
}

/**
 * The mutable transient one advance call works on. Cold layers (build, compiled, configs) are
 * shared read-only references; hot buffers are cloned once at open, or taken as they are when the
 * caller owns the state (advanceGameOwned); plain sub-states are shallow drafts that phases mutate
 * directly.
 */
export interface World {
  /** Cosmetic buffer for this hot-buffer owner; never committed into GameState. */
  completions?: CompletionLog;
  /** Index of the tick being run (= ticks completed before it). */
  tick: number;
  readonly seed: number;
  readonly epoch: number;
  /** Replaced (never mutated) by the research phase when effects apply; committed back. */
  build: BuildState;
  compiled: CompiledBuffers;
  readonly configs: SavedConfigs;
  readonly hot: HotBuffers;
  readonly round: Mutable<RoundState>;
  readonly market: MarketWork;
  readonly research: Mutable<ResearchState>;
  readonly ledger: LedgerWork;
  readonly events: EventWork;
  readonly report: ReportWork;
  /**
   * True from the deadline step to the end of the tick: a head promoted then can first be taken
   * next tick (spec §5.2). False between ticks, where `tick` is already the next tick.
   */
  late: boolean;
  /** Power-input change log of this advance call (core/touch.ts, R34); absent outside advance. */
  touch?: TouchLog;
}

const big = (value: Amount) => BigInt(value);

/** `owned`: the caller gives up `state`, so its hot buffers are updated in place (D9). */
export function openWorld(state: GameState, owned = false): World {
  const hot = owned ? state.hot : cloneHot(state.hot);
  return {
    // Keep World's shape stable when its first completion arrives on the exec hot path.
    completions: completionLog(hot),
    tick: state.clock.tick,
    seed: state.seed,
    epoch: state.epoch,
    build: state.build,
    compiled: state.compiled,
    configs: state.configs,
    hot,
    round: { ...state.round },
    market: { ...state.market, window: [...state.market.window] },
    research: { ...state.research },
    late: false,
    ledger: {
      credits: big(state.wallet.credits), data: big(state.wallet.data),
      energyMeter: state.wallet.energyMeter, dataMeter: state.wallet.dataMeter,
      gross: big(state.ledger.gross), energy: big(state.ledger.energy), dataEarned: big(state.ledger.dataEarned),
      dataSpent: big(state.ledger.dataSpent),
      creditsSpent: big(state.ledger.creditsSpent),
      roundGross: big(state.round.gross), roundEnergy: big(state.round.energy), roundData: big(state.round.data),
      netRing: [...state.ledger.netRing],
      callGross: 0n, callEnergy: 0n, callData: 0n,
    },
    events: { nextSeq: state.events.nextSeq, entries: [...state.events.entries] },
    report: { activeTicks: 0, met: 0, failed: FAIL_CAUSES.map(() => 0), roundsEnded: [], researchCompleted: [] },
  };
}

/** A bigint's decimal string is already a canonical integer Amount (no exponent, no -0). */
export const toAmount = (value: bigint): Amount => value.toString() as Amount;

export function commitWorld(state: GameState, w: World, carryMs: number): GameState {
  const l = w.ledger;
  return {
    ...state,
    clock: { tick: w.tick, carryMs },
    wallet: { credits: toAmount(l.credits), data: toAmount(l.data), energyMeter: l.energyMeter, dataMeter: l.dataMeter },
    ledger: {
      ...state.ledger,
      gross: toAmount(l.gross), energy: toAmount(l.energy), dataEarned: toAmount(l.dataEarned), dataSpent: toAmount(l.dataSpent),
      creditsSpent: toAmount(l.creditsSpent),
      netRing: l.netRing,
    },
    round: { ...w.round, gross: toAmount(l.roundGross), energy: toAmount(l.roundEnergy), data: toAmount(l.roundData) },
    market: { ...w.market, window: [...w.market.window] },
    research: { ...w.research },
    build: w.build,
    compiled: w.compiled,
    hot: w.hot,
    events: { nextSeq: w.events.nextSeq, entries: w.events.entries },
  };
}
