import type { Amount } from '../amount';
import type { BoardKind } from './build';
import type { QueueStrategyId, RegionId } from './catalog';
import type { FailCause, FailCounts, FailDetail, GameEvent } from './events';
import type { LevelId, NodeRef, RackId, ResearchId, RoomId, SiteId, SystemId } from './ids';
import type { RoundReport } from './report';
import type { FrontierView } from './frontier';
import type { RoundPhase } from './state';
import type {
  PowerCtlView, StartCtlView,
  BuildSlotView, ChipQueueEntryView, ResearchQueueEntryView, CompletionView, CoolerView, FailureView, LbView, LinkView, MemTierView, OutcomeView, PartView, QueueEntryView, RackSlotView,
  ServerSlotView, ShardDoneView, SiteView, SupplyView, SwitchView, TaskView, TransferView, UnitMode,
} from './views';

export interface CacheLevelView { readonly kind: 'l1' | 'l2' | 'l3'; readonly bits: number; readonly generation: number; readonly level: number }

/** What is on screen: the focus level and, during a zoom transition, its partner. */
export interface SnapshotScope { readonly focus: NodeRef; readonly partner: NodeRef | null }

export interface RenderSnapshot {
  /** Since the supplied previous snapshot; newest 2048 retained. First view starts capture; workers do not record. Not saved. */
  readonly completions: readonly CompletionView[];
  /** Same capture and retention policy as completions, with its own sequence numbers. */
  readonly failures: readonly FailureView[];
  /** D25.5: finished non-final shards, no pay. Same capture and retention as completions, own sequence numbers. */
  readonly shardsDone: readonly ShardDoneView[];
  readonly epoch: number;
  readonly tick: number;
  readonly simTimeMs: number;
  /** The current one boot time, unlocks.bootTicks × TICK_MS; pips drain timerS / bootMs. */
  readonly bootMs: number;
  readonly hud: HudSnapshot;
  readonly feed: FeedSnapshot;
  readonly round: RoundSnapshot;
  readonly research: ResearchBadge;
  readonly unlocked: Readonly<Record<LevelId, boolean>>;
  /** Default node per opened level (the player's first system, rack, room). */
  readonly home: Readonly<Partial<Record<LevelId, NodeRef>>>;
  readonly focus: LevelSnapshot;
  readonly partner: LevelSnapshot | null;
  readonly events: readonly GameEvent[];
  readonly firstSeq: number;
  readonly lastSeq: number;
}

export interface HudSnapshot {
  readonly credits: Amount;
  readonly data: Amount;
  /** Whole Credits per minute over the trailing 60 s. */
  readonly netPerMinute: Amount;
  /** Work-weighted (spec §4.2): percent = floor(SLA × 1000) / 10. met/failed are task counts; the work sums are ops. */
  /**
   * D28: met and failed count the last `window` (50) resolved tasks of the round, and percent = met / (met +
   * failed) ("SLA 92.0% · 46 / 50"); dismissals are outside it. `checking` is false until 10 tasks have
   * resolved this round ("warming up"): the round can't end before. roundMet and roundFailed are the round's totals.
   * deliveredWork, failedWork and grace are the retired work-weighted inputs, kept until the UI stops reading them.
   */
  readonly sla: {
    readonly met: number; readonly failed: number; readonly percent: number; readonly checking: boolean;
    readonly window: number; readonly roundMet: number; readonly roundFailed: number;
    readonly deliveredWork: number; readonly failedWork: number; readonly grace: number;
  };
  readonly roundState: RoundPhase;
  readonly roundIndex: number;
  readonly roundElapsedMs: number;
  readonly autoReturnInMs: number | null;
  /**
   * Round-time income per second, for ETAs (same as ResearchTreeView.income): this round's Data and
   * net Credits over its elapsed time while it runs, else the last report's; 0 until 10 s have
   * elapsed. Always set by the view; optional only until hand-built fixtures add it.
   */
  readonly income?: { readonly dataPerSec: number; readonly creditsPerSec: number };
  /**
   * Recent net income per second, for ETAs: the last 30 s of round time, energy included, so it goes
   * negative when the bill outruns pay (ResearchTreeView.income uses it). Between rounds, the last
   * report's average; 0 until 10 s have elapsed. Optional only until hand-built fixtures add it.
   */
  readonly incomeRecent?: { readonly dataPerSec: number; readonly creditsPerSec: number };
}

/** The market: the endless queue's visible window, the head clock and the work in transfer (spec §16.2). */
export interface FeedSnapshot {
  /** The round the window belongs to. Between rounds it is the next round, shown "after Return". */
  readonly roundIndex: number;
  readonly timing: 'running' | 'onReturn';
  /** The queue's first QUEUE_VISIBLE entries, head first: returned work at the front, then the window tasks. */
  readonly window: readonly QueueEntryView[];
  /**
   * D27: the research task, when a project is active. With `running` false it is the head, in front of
   * `window` (whose first task then waits and has no clock); with `running` true it has been taken.
   */
  readonly research: ResearchQueueEntryView | null;
  /** The head may be taken through the end of this tick (headTick + 99); null between rounds or while research is the head. */
  readonly headDeadlineTick: number | null;
  /** Outgrown: the market took nothing more this round; work already taken is finishing before the round ends. */
  /** The head's first missing requirement on the static capability set; null when it can run. */
  readonly blockedBy: FailDetail | null;
  /** Tasks moving over links: the lone system's pipe and each link's sending transfer, at most 16. */
  readonly transfers: readonly TransferView[];
  readonly inTransfer: number;
  readonly queued: number;
  readonly running: number;
  /** This round. */
  readonly taken: number;
  readonly dismissed: number;
  readonly intensity: number;
  /** Measured takes per second over the trailing 10 s. */
  readonly takesPerSec: number;
  /** At most RECENT_OUTCOMES, newest last. */
  readonly recentOutcomes: readonly OutcomeView[];
  /** Failures this round by cause; null until `telemetry`. */
  readonly liveFailures: FailCounts | null;
  /** Tasks per second, met and failed over the last 2 s. */
  readonly rates: { readonly met: number; readonly fail: number };
  /** The dominant cause over the last 2 s, or null when nothing failed. */
  readonly failBin: { readonly cause: FailCause; readonly perSec: number } | null;
}

export interface RoundSnapshot {
  readonly index: number;
  readonly state: RoundPhase;
  readonly lastReport: RoundReport | null;
  /** D40: the best reach and every kept round's reach, for the report; the same reference until a round ends. */
  readonly frontier: FrontierView;
  readonly canReturn: boolean;
  readonly autoReturn: { readonly available: boolean; readonly on: boolean; readonly inMs: number | null };
}

export interface ResearchBadge {
  readonly active: ResearchId | null;
  readonly name: string | null;
  readonly progress: number;
  readonly stoppedInsolvent: boolean;
  readonly needsData: boolean;
  readonly queued: number;
  readonly opsPerSec: number;
}

export type LevelSnapshot = ChipSnapshot | SystemSnapshot | RackSnapshot | RoomSnapshot | GlobalSnapshot;

export type CoreSleep = 'C-state' | 'S3';
export interface CoreView {
  readonly socket: number;
  /** This core's own rate in ops/s: its socket's clock (D34: one thread per core, no lanes). */
  readonly rate: number;
  /**
   * The core's live clock in Hz: the socket clock × its active modifiers (spec §9.3: DVFS or turbo,
   * thermal throttle, power caps). Paused between rounds: the nominal (ready) clock. 0 while it sleeps,
   * and while its system is asleep or powered off.
   */
  readonly hz: number;
  /** The sleep state while the core sleeps: an idle core's C-state, or 'S3' with its whole system asleep; else null. */
  readonly sleep: CoreSleep | null;
  readonly generation: number;
  readonly level: number;
  readonly busy: number;
  /** CPU-stage task assigned here, oldest taken first then taskId; null when idle. */
  readonly taskId: number | null;
  readonly family: number | null;
  /** CPU work on this core; null while it has no CPU-stage task. */
  readonly activity: 'cacheLoad' | 'cacheAccess' | 'compute' | null;
  readonly progress: number;
  readonly threads: number;
  /** D25: the shard index of that task (null when idle); cores with equal taskId and shard run one shard. */
  readonly shard: number | null;
  /** Threads that shard holds in total (its group size); 0 when idle. */
  readonly shardThreads: number;
  readonly research: number;
  readonly cstate: 0 | 1;
}
export interface SchedulerView {
  readonly generation: number; readonly level: number; readonly strategy: QueueStrategyId;
  readonly q: number; readonly queued: number; readonly k: number; readonly running: number; readonly reserved: number;
}
export interface ChipSnapshot {
  readonly level: 'chip';
  /** The node one level up (its system), or null when that level is not opened. Same on every level below global. */
  readonly parent: NodeRef | null;
  readonly systemId: SystemId;
  readonly online: UnitMode;
  /**
   * Seconds left in the system's boot / cold / goingOffline transition, else null (same as
   * SystemSnapshot.timerS). The view always sets it; optional only until hand-built fixtures add it.
   */
  readonly timerS?: number | null;
  readonly tier: number;
  /** Identical CPUs in the system; the view shows one, cores pool under one scheduler. */
  readonly cpuCount: number;
  readonly clock: { readonly hz: number; readonly effectiveHz: number; readonly generation: number; readonly level: number };
  readonly coreSites: number;
  readonly cores: readonly CoreView[];
  /** usedBits reserves capacity; loadedBits fills as actual loading completes, then stays held until release. */
  readonly cache: { readonly levels: readonly CacheLevelView[]; readonly usedBits: number; readonly loadedBits: number; readonly capacityBits: number; readonly spilledOutBits: number };
  readonly scheduler: SchedulerView | null;
  /** Occupied scheduler wells, oldest taken first then taskId; remaining wells are empty. */
  readonly queue: readonly ChipQueueEntryView[];
  readonly researchShare: number;
  /**
   * The inbound pipe (D10.4, D13): the system's rack-switch port. Before Rack it carries every task;
   * `waiting` is true while the cores sit idle on its transfer.
   */
  readonly pipe: { readonly speed: number; readonly transfer: TransferView | null; readonly waiting: boolean };
  /** The system's board PSU (the CPU has no supply of its own). */
  readonly psu: SupplyView;
  readonly slots: readonly BuildSlotView[];
}

export interface SystemSnapshot {
  readonly level: 'system';
  readonly parent: NodeRef | null;
  readonly systemId: SystemId;
  readonly kind: 'server' | 'storageNode';
  readonly board: BoardKind;
  /** Identical CPUs, 1 to 4 (accelerator: up to 2). */
  readonly cpuCount: number;
  /** DIMM slots this board offers now: the ramSlots ceiling (≤ 4) on general, 8 on accelerator. */
  readonly ramSlots: number;
  /** Configuration efficiency η_cfg (compiled.sys.etaCfg), shown on the system plate. */
  readonly etaCfg: number;
  /** The CPU level's snapshot of CPU 1 (every CPU is an identical copy), for the package minis. */
  readonly chip: ChipSnapshot;
  /** Busy fraction per CPU, length cpuCount (hot sys.sockBusy). */
  readonly cpuBusy: readonly number[];
  readonly online: UnitMode;
  readonly timerS: number | null;
  /** Full length of the running boot / goingOffline / cold timer; null when timerS is null. */
  readonly timerTotalS: number | null;
  readonly cpu: PartView;
  readonly ram: readonly PartView[];
  readonly gpu: readonly PartView[];
  readonly storage: readonly PartView[];
  readonly psu: SupplyView;
  readonly running: readonly TaskView[];
  readonly queue: { readonly cap: number; readonly count: number; readonly sample: readonly TaskView[] };
  readonly reserved: number;
  readonly rates: { readonly ops: number; readonly ramBits: number; readonly gpuOps: number; readonly ioBits: number };
  readonly capacities: { readonly cache: number; readonly ram: number; readonly vram: number; readonly storage: number };
  readonly used: { readonly memory: number; readonly vram: number; readonly storage: number };
  /** D26.7: the hierarchy, cache, RAM, disk in that order (always three; capacity 0 for a tier the system lacks). */
  readonly memory: { readonly tiers: readonly MemTierView[] };
  readonly drawW: number;
  readonly saveable: boolean;
  readonly slots: readonly BuildSlotView[];
  /** D25: the front shard on the system's port (the pipe before Rack), or null. Same as `chip.pipe.transfer`. */
  readonly inbound: TransferView | null;
}

export interface RackSnapshot {
  readonly level: 'rack';
  readonly parent: NodeRef | null;
  readonly rackId: RackId;
  /** Room slot, row-major; the starter rack reports its hidden room's slot (0). */
  readonly slot: number;
  /** RACK_SLOTS_PER_ROW views in column order, including this rack and empty neighbours. */
  readonly row: readonly RackSlotView[];
  readonly online: UnitMode;
  readonly timerS: number | null;
  readonly tempF: number;
  readonly eff: number;
  readonly crashS: number;
  readonly crashed: boolean;
  readonly throttled: boolean;
  readonly cooler: CoolerView;
  readonly pdu: SupplyView;
  readonly lb: LbView;
  readonly switch: SwitchView;
  /** D31.3: the fifth infrastructure slot, under the cooler; null when not installed (optional until fixtures add it). */
  readonly powerCtl?: PowerCtlView | null;
  /** Always 12. */
  readonly servers: readonly ServerSlotView[];
  readonly saveable: boolean;
  /**
   * D25: the rack uplink ('uplink': its first 4 × uplinks FIFO shards, sending first, then waiting with
   * bitsSent 0), then each port's front shard ('server'). At most 12 + uplinks × 4.
   */
  /** D31: true until the `powerCtl` research is done; an open empty slot then draws as an empty bay. Optional only until hand-built fixtures add it. */
  readonly powerCtlLocked?: boolean;
  readonly flows: readonly TransferView[];
}

export interface RoomSnapshot {
  readonly level: 'room';
  readonly parent: NodeRef | null;
  readonly roomId: RoomId;
  readonly siteId: SiteId;
  readonly zone: number;
  /** Zone indices of the site, for the in-world zone switcher. */
  readonly zones: readonly (RoomId | null)[];
  readonly online: UnitMode;
  readonly timerS: number | null;
  readonly tempF: number;
  readonly outsideF: number;
  readonly crashS: number;
  readonly crashed: boolean;
  readonly cooler: CoolerView;
  readonly ups: readonly SupplyView[];
  /** D31.2: the room start controller on the UPS, or null (optional until fixtures add it). */
  readonly power?: { readonly start: StartCtlView | null };
  readonly network: { readonly switch: SwitchView; readonly lb: LbView };
  readonly rows: number;
  readonly maxRows: number;
  /** rows × 8. */
  readonly racks: readonly RackSlotView[];
  readonly saveable: boolean;
  /** D25: the zone link (first 4 × channels FIFO shards, waiting included), then each rack link's first `channels` ('rack'). At most 128. */
  readonly flows: readonly TransferView[];
}

export interface GlobalSnapshot {
  readonly level: 'global';
  /** Always 8, one per region, REGION_IDS order. */
  readonly sites: readonly SiteView[];
  readonly backbone: { readonly links: readonly LinkView[] };
  readonly scheduler: LbView | null;
  /** D31.2: the global start controller on the scheduler, or null (optional until fixtures add it). */
  readonly start?: StartCtlView | null;
  readonly regionsOpen: number;
  readonly gateway: RegionId;
  /**
   * D25: each backbone link (first 4 shards, waiting included), then each site's data plane per zone
   * ('zone': first 4 × channels at the gateway site, where they are first links, else `channels`). At most 128.
   */
  readonly flows: readonly TransferView[];
}
