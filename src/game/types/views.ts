import type { StartOrder } from './build';
import type { Amount } from '../amount';
import type { CoolTech, Era, FilterId, MemTier, RegionId, ResearchCategory, Resource, RouteStrategyId, WorkTier } from './catalog';
import type { FailCause, FailDetail, SupplyKind } from './events';
import type { FamilyId, LevelId, NodeRef, RackId, ResearchId, RoomId, SiteId, SystemId, UnitKind, UnitRef } from './ids';
import type { TaskRef } from './state';
import type { GpuStats } from './gpu';

/** D23. Kept structurally identical to the renderer's TaskType. */
export type TaskTypeId = 'compute' | 'parallel' | 'memory' | 'accel' | 'storage' | 'cluster' | 'zones' | 'region';
export interface FailureView {
  /** Session-unique within the failure stream, separate from completion sequence numbers. */
  readonly seq: number;
  readonly tick: number;
  readonly tau: number;
  readonly taskId: number;
  readonly type: TaskTypeId;
  readonly family: FamilyId;
  readonly cause: FailCause;
}
/**
 * A task met (D25.5): raised once, when its last shard completes, at the system, CPU/core or GPU
 * card that ran that shard. `credits` and `data` are the full task payout.
 */
export interface CompletionView {
  /** Session-unique cosmetic identity, stable when a snapshot is read again. */
  readonly seq: number;
  readonly taskId: number;
  /** Shards the task was split into (1 for an unsplit task). */
  readonly shards: number;
  /** The task's work W in ops and bits (equal to its Credits). */
  readonly work: number;
  readonly tick: number;
  readonly system: number;
  readonly rack: number | null;
  readonly room: number | null;
  readonly site: number | null;
  /** Zero-based CPU and core within it. CPU allocation is the chip view's packed projection. */
  readonly cpu: number | null;
  readonly core: number | null;
  /** Physical card slot; the first GPU slot represents a linked pool. */
  readonly gpu: number | null;
  readonly type: TaskTypeId;
  /** Display numbers only. The ledger still credits exact Amounts. */
  readonly credits: number;
  /** Fractional contribution to the ledger's Data meter, before whole-Data carry. */
  readonly data: number;
  /** Fraction of the completion tick, in [0, 1]. */
  readonly tau: number;
}
/**
 * A finished non-final shard (D25.5): its slot, threads and memory freed, no pay. Never a payout
 * pop. Same capture and retention as completions (newest 2,048), with its own sequence numbers.
 */
export interface ShardDoneView {
  readonly seq: number;
  readonly tick: number;
  readonly system: number;
  readonly cpu: number | null;
  readonly core: number | null;
  readonly gpu: number | null;
  readonly taskId: number;
  readonly shard: number;
  readonly tau: number;
}

/**
 * System modes (spec §4.3), plus `empty` for a slot with no unit. MODE_IDS index = the u8 in
 * hot `sys.mode`. `draining` = going offline with gracefulDrain, still running its tasks.
 */
/** D31: `standby` = powered off by a start controller (0 W, not a split candidate); appended so saved mode codes keep their indexes. */
export const UNIT_MODES = ['empty', 'onMarket', 'asleep', 'boot', 'goingOffline', 'draining', 'offline', 'paused', 'cold', 'crashed', 'dark', 'standby'] as const;
export type UnitMode = (typeof UNIT_MODES)[number];

export interface SupplyView {
  readonly kind: SupplyKind;
  readonly generation: number;
  readonly level: number;
  readonly capacityW: number;
  readonly deliveredW: number;
  readonly usage: number;
  /** Seconds accumulated; 0 hides the readout. */
  readonly overloadS: number;
  readonly failed: boolean;
  readonly rebootMs: number | null;
  readonly loss: number;
  readonly lossW: number;
  readonly capped: boolean;
  readonly capFactor: number;
  /** Credits per minute of its delivered watts plus loss at the region's price, float64; display only ("<1" or whole). */
  readonly creditsPerMinute: number;
}

export interface PortView {
  readonly speedHz: number;
  /** Ladder index k. */
  readonly rung: number;
  /** Server slot or rack slot it connects, or null. */
  readonly peer: number | null;
  /** A real transfer is sending this tick. */
  readonly active: boolean;
  readonly family: FamilyId | null;
  readonly progress: number;
  readonly queued: number;
}
export interface SwitchView {
  readonly generation: number;
  readonly topHz: number;
  readonly sameSpeed: boolean;
  readonly portCeiling: number;
  readonly ports: readonly PortView[];
  readonly uplinks: readonly PortView[];
}
export interface LbView {
  readonly generation: number;
  readonly level: number;
  readonly strategy: RouteStrategyId;
  readonly filters: readonly FilterId[];
  /** D25.7: the router queue. `slots` equals `level` (1–32); entries oldest first (dispatch order). */
  readonly queue: { readonly slots: number; readonly level: number; readonly entries: readonly LbQueueEntryView[] };
  readonly routedPerSec: number;
  readonly misroutesThisRound: number;
  /** Child slot this router last routed to this tick, or null (the LB decision light). */
  readonly lastTarget: number | null;
}
/** One router-queue entry (D25.7): a whole task taken from the market, or a share sent down by a parent router. */
export interface LbQueueEntryView {
  readonly taskId: number;
  readonly family: FamilyId;
  readonly units: number;
  /** null for a whole task; otherwise the index of the first shard this share will become. */
  readonly shard: number | null;
  readonly sinceTick: number;
  /** D26.5: last tick the task may be met (takeTick + deadline − 1); null when the family has none. Router-queue time counts. */
  readonly windowEndTick: number | null;
}
export interface CoolerView {
  readonly tech: CoolTech;
  readonly generation: number;
  readonly level: number;
  readonly duty: number;
  readonly setpointF: number | null;
  readonly watts: number;
  readonly capacityW: number;
  readonly equilibriumF: number;
}

/** One shard (D25) queued or running on a system. An unsplit task is shard 0 of 1. */
export interface TaskView extends TaskRequirementsView {
  /** Lifetime assignment: 0..7 physical, 8 linked pool, null while unassigned. */
  readonly accelDomain: number | null;
  readonly taskId: number;
  /** Shard index within its task, 0-based. */
  readonly shard: number;
  /** The task's shard count. */
  readonly shards: number;
  /** Units this shard holds (`size` is the whole task's). */
  readonly units: number;
  /** Hardware threads held now; 0 while queued. */
  readonly threads: number;
  readonly gpuCoresMin: number;
  readonly vramBits: number;
  readonly key: number;
  readonly family: FamilyId;
  readonly count: number;
  readonly stage: number;
  readonly resource: Resource;
  /** Fraction of the current stage, 0..1. */
  readonly progress: number;
  /** D26.1: where this shard's working set sits, bits per tier; all 0 while queued (queued shards hold no memory). */
  readonly placement: { readonly cache: number; readonly ram: number; readonly disk: number };
  /** D26.2: the tier its current mem part runs on (a GPU stage's unified-memory parts too); null otherwise. */
  readonly memTier: MemTier | null;
  /** D26.5: last tick the task may be met (takeTick + deadline − 1); null when the family has none. */
  readonly windowEndTick: number | null;
}
/** D26.7: one memory tier of a system. */
export interface MemTierView {
  readonly tier: MemTier;
  readonly capacityBits: number;
  /** Bits held by running shards (and unified-memory VRAM overflow) in this tier. */
  readonly usedBits: number;
  /** Of usedBits, bits that sit here because they didn't fit a faster tier. */
  readonly spilledBits: number;
  /** Tier bandwidth in bit/s; null for cache (it serves at core speed). */
  readonly rateBits: number | null;
}

export type PartViewKind = 'cpu' | 'core' | 'clock' | 'l1' | 'l2' | 'l3' | 'scheduler' | 'ram' | 'gpu' | 'npu' | 'drive' | 'psu';
export interface PartView {
  /** Capacity of this RAM stick or drive, in bits. Set for ram and drive. */
  readonly capacityBits?: number;
  /** This RAM stick's channel rate or drive's IO rate, in bit/s. Set for ram and drive. */
  readonly rateBits?: number;
  /** Physical memory hold; linked GPU holds are striped in proportion to card capacity. */
  readonly vramUsedBits?: number;
  /** D26.4 unifiedMemory, GPU parts: VRAM need of its running shards placed outside VRAM (in RAM and on disk), bits. */
  readonly unifiedSpillBits?: number;
  readonly gpu?: GpuStats;
  readonly slot: number;
  readonly kind: PartViewKind;
  readonly generation: number;
  readonly level: number;
  /** Doing work this tick. */
  readonly active: boolean;
  /** Utilization 0..1 of the resource it provides. */
  readonly resourceBusy: number;
  readonly ecc?: boolean;
}

/** Placeholder site for a buildable part or unit on the world (Board price labels rule, program §12). */
export interface BuildSlotView {
  readonly kind: PartViewKind | 'server' | 'rack' | 'zone' | 'site';
  readonly index: number;
  readonly locked: boolean;
}

export interface ServerSlotView {
  readonly systemId: SystemId | null;
  readonly kind: 'server' | 'storageNode' | null;
  readonly state: UnitMode;
  /**
   * Switched onto the market (its own, rack, room and site switches all on); false while it sits out.
   * Tells sitting-out sleds apart between rounds, when every system is paused. The view always sets
   * it; optional only until hand-built fixtures add it.
   */
  readonly onMarket?: boolean;
  readonly load: number;
  readonly running: number;
  /** Family of the oldest running task, or null when none. */
  readonly family: FamilyId | null;
  readonly admitted: number;
  readonly reserved: number;
  /** Seconds left in boot / goingOffline / cold, else null. */
  readonly timerS: number | null;
  /** Full length of that timer; null when timerS is null. */
  readonly timerTotalS: number | null;
  /** Cores across all CPUs (cpuCount × cores per CPU); 0 for a storage node or an empty slot. */
  readonly cores: number;
  /** Cores busy with tasks this tick, 0..cores. */
  readonly busyCores: number;
  readonly port: PortView | null;
  /** D31: ms left while an asleep system is waking (its wake countdown), else null. Optional only until hand-built fixtures add it. */
  readonly wakeMs?: number | null;
}
/** D31.2: a start controller (rack Power control, room on the UPS, global on the scheduler). */
export interface StartCtlView {
  readonly generation: number;
  readonly level: number;
  readonly startWith: number;
  readonly headWaitS: number;
  /** Generation 1 only; null at generation 0 or when unset. */
  readonly busyPct: number | null;
  readonly order: StartOrder;
  /** Units awake (systems) or powered (racks, sites) under this controller now, of total. */
  readonly awake: number;
  readonly total: number;
  /** Time until the controller's next wake lands, or null when none is pending. */
  readonly nextWakeInMs: number | null;
}
/** D31.3: rack Power control: the battery (time until billed) and the rack's start controller. */
export interface PowerCtlView {
  readonly generation: number;
  readonly level: number;
  readonly battery: {
    readonly capacityJ: number;
    readonly chargeJ: number;
    /** chargeJ ÷ current PDU input; null when the rack draws nothing. */
    readonly secondsLeft: number | null;
    /** True while the round runs, the rack is powered and the battery is not empty. */
    readonly discharging: boolean;
  };
  readonly start: StartCtlView;
}
/** D31.4: a site's off-grid generation. */
export interface GenerationView {
  readonly kind: 'solar' | 'wind' | 'fuelCell' | 'ownPlant';
  readonly level: number;
  readonly outputW: number;
  readonly usedW: number;
  /** Credits per joule at the margin: 0 for renewables with headroom, the fuel price, or the region price. */
  readonly marginalPrice: number;
}
export interface RackSlotView {
  readonly rackId: RackId | null;
  readonly state: UnitMode;
  readonly load: number;
  readonly tempF: number;
  readonly pduUsage: number;
  /** 12 UnitMode codes (UNIT_MODES index). */
  readonly servers: Uint8Array;
  /**
   * 12 flags beside `servers`: 1 when that slot's system is switched onto the market
   * (ServerSlotView.onMarket), 0 when it sits out or the slot is empty. Always set by the view;
   * optional only until hand-built fixtures add it.
   */
  readonly serversOnMarket?: Uint8Array;
  /**
   * D31: false while a room start controller holds the rack in standby; wakeMs counts down a power-on in
   * progress. Always set by the view; optional only until hand-built fixtures add them.
   */
  readonly powered?: boolean;
  readonly wakeMs?: number | null;
}
export interface ZoneView {
  readonly roomId: RoomId | null;
  readonly zone: number;
  readonly state: UnitMode;
  readonly tempF: number;
  readonly load: number;
  readonly upsUsage: number;
  /** D31: false while the global start controller holds the zone in standby (optional until fixtures add it). */
  readonly powered?: boolean;
  readonly wakeMs?: number | null;
}
export interface LinkView {
  readonly siteId: SiteId;
  readonly speedHz: number;
  readonly latencyMs: number;
  readonly active: boolean;
  readonly generation: number;
}
export interface SiteView {
  readonly siteId: SiteId | null;
  readonly region: RegionId;
  readonly open: boolean;
  readonly online: UnitMode;
  readonly zones: readonly ZoneView[];
  readonly grid: SupplyView | null;
  readonly dataPlane: { readonly generation: number; readonly bitsPerSec: number; readonly latencyMs: number; readonly active: boolean } | null;
  readonly energyPrice: number;
  readonly outsideF: number;
  readonly hottestF: number;
  /** Seconds left in boot / goingOffline / cold, else null. */
  readonly timerS: number | null;
  /** D31: false while the global start controller holds the site in standby (optional until fixtures add it). */
  readonly powered?: boolean;
  readonly wakeMs?: number | null;
  /** D31.4: off-grid generation, or null (optional until fixtures add it). */
  readonly generation?: GenerationView | null;
}

export interface TaskRequirementsView {
  readonly family: FamilyId;
  readonly label: string;
  readonly stages: readonly { readonly resource: Resource; readonly work: number }[];
  /** D25.1: the fewest units that must run together (the family grain). */
  readonly grain: number;
  /** The task's size in whole units. Stage work and the gates here are for the whole task. */
  readonly size: number;
  readonly workingSetBits: number;
  readonly gpuCoresMin: number;
  readonly vramBits: number;
  /** D26.5: completion window in ticks from take (windowS × j / dt, the task's frozen draw); null when the family has none. */
  readonly deadline: number | null;
  /** D25.6 minimum split: at least this many shards on distinct systems. */
  readonly members: number;
  readonly minZones: number;
  readonly region: RegionId | null;
  readonly ecc: boolean;
  readonly tensor: boolean;
}
/** One occupied well in the chip's scheduler queue. */
export interface ChipQueueEntryView {
  readonly taskId: number;
  readonly family: FamilyId;
}

/** One queue entry (spec §16.2): a stable identity, its work and requirements, and whether it can be dismissed. */
export interface QueueEntryView extends TaskRequirementsView {
  readonly kind: 'task';
  readonly task: TaskRef;
  readonly key: number;
  readonly icons: readonly TaskIcon[];
  /** Taken work returned to the front: committed, never dismissible. */
  readonly committed: boolean;
  readonly dismissible: boolean;
  /** First missing requirement on current hardware, or null. */
  readonly blockedBy: FailDetail | null;
  /** Σ stage work over every member, in ops and bits: the payout and the payload. */
  readonly work: number;
  /** Seconds the transfer takes at the current first-link speed (work / speed); null without a link. */
  readonly transferS: number | null;
  /**
   * The player's online systems whose fixed hardware can run this task: the router's can-run gates
   * that don't depend on its size (fixed working set, GPU and GPU cores, VRAM, ECC, region), never load.
   */
  readonly capableSystems: number;
  /** D26.5: for taken work returned to the front, the last tick it may be met (takeTick + deadline − 1); null when untaken or the family has none. */
  readonly windowEndTick: number | null;
}
/**
 * D27: the research task in the market line. While `running` is false it is the head: it waits at
 * the front of the queue, ahead of `FeedSnapshot.window`, with no clock, and the tasks behind it wait.
 * Once taken it runs on `holders` systems until the project completes; it pays nothing.
 */
export interface ResearchQueueEntryView {
  readonly kind: 'research';
  /** Stable while the project is in line or running: −1 − the project's tree index (never a task ID). */
  readonly key: number;
  readonly project: ResearchId;
  readonly name: string;
  /** The project's compute work, ops. */
  readonly work: number;
  /** Work done, 0–1 (kept across losses and rounds). */
  readonly progress: number;
  /** Taken: some system holds it. False: it is the head, waiting for a system with room. */
  readonly running: boolean;
  /** Systems holding it, and the threads they hold. */
  readonly holders: number;
  readonly threads: number;
  /** Research ops per second this tick (0 while waiting). */
  readonly opsPerSec: number;
}
/**
 * One shard moving over a link at its real speed (D10.4, D12.4, D25.4). All shards of one take
 * appear in the same tick with the same `taskId` and consecutive `shard` indices.
 */
export interface TransferView {
  readonly taskId: number;
  readonly family: FamilyId;
  /** Target system. */
  readonly systemId: SystemId;
  /** 'pipe' before Rack; else the link the transfer is on ('uplink': the rack's uplinks). */
  readonly link: 'pipe' | 'server' | 'uplink' | 'rack' | 'zone' | 'backbone';
  /** Bits of this shard sent on this link so far, of `bits`. */
  readonly bitsSent: number;
  readonly bits: number;
  /** bit/s. */
  readonly speed: number;
  /** Shard index, the task's shard count and this shard's units (an unsplit task is shard 0 of 1). */
  readonly shard: number;
  readonly shards: number;
  readonly units: number;
  /**
   * The router the link leaves (null on the shard's first link, from the market) and the node it enters:
   * server → system, rack/uplink → rack, zone → room, backbone → the room the shard is bound for.
   */
  readonly from: NodeRef | null;
  readonly to: NodeRef;
  /** Stable per shard transfer, across ticks, links and levels: taskId × 256 + shard. */
  readonly key: number;
}
export type TaskIcon = Resource | 'vram' | 'window' | 'ecc' | 'tensor' | 'zones' | 'region';
export interface OutcomeView {
  readonly family: FamilyId;
  readonly count: number;
  readonly outcome: 'met' | FailCause;
  readonly detail: FailDetail | null;
  readonly tick: number;
}


/* ---------- Lazy selector results (not part of the snapshot) ---------- */

export type ResearchNodeState = 'done' | 'active' | 'parked' | 'queued' | 'available' | 'locked';
/**
 * The owned part a research node grows from (research screen concept C). `fab`: the CPU fabs (a
 * whole CPU generation). `structure`: the nodes that open a level (system board, rack, room, data center, regions).
 */
export type ResearchPartId =
  | 'cores' | 'clock' | 'cache' | 'queue' | 'fab'
  | 'cpu' | 'ram' | 'drive' | 'gpu' | 'psu' | 'board'
  | 'switch' | 'lb' | 'rackCooling' | 'rackPower'
  | 'netRack' | 'roomCooling' | 'ups'
  | 'dataPlane' | 'backbone' | 'site' | 'globalScheduler'
  | 'structure';
/** A research root's current spec, as a heading line ("4 cores · 2 lanes", "657 Hz"; "none" when not owned). */
export interface ResearchPartView { readonly spec: string }
/** The hardware level a part belongs to: the research tab, whatever era the node unlocks in. */
export type ResearchTabId = 'cpu' | 'system' | 'rack' | 'room' | 'global';
/** A node's concrete before → after on the part it upgrades, as display strings ("Cores per CPU", "1", "2"). */
export interface ResearchChangeView { readonly label: string; readonly before: string; readonly after: string }
export interface ResearchNodeView {
  /** The root it grows from, and that root's hardware tab (a CPU part's node is on the CPU tab in every era). */
  readonly part: ResearchPartId;
  readonly tab: ResearchTabId;
  /** Before → after against the current unlocks and build; null when the node has no clean scalar (fabs, structure, most rules). */
  readonly change: ResearchChangeView | null;
  /** Deduplicated D23 task types answered by this node's catalog bands. */
  readonly answers: readonly TaskTypeId[];
  readonly needsCredits?: boolean;
  /** D32: Credits paid at Start alongside dataCost (0 Data for Credits-only nodes). */
  readonly creditCost: Amount;
  readonly id: ResearchId;
  readonly name: string;
  readonly category: ResearchCategory;
  readonly state: ResearchNodeState;
  readonly progress: number;
  readonly dataCost: Amount;
  readonly workOps: number;
  readonly requires: readonly ResearchId[];
  /** First missing prerequisite, or null. */
  readonly lockedBy: ResearchId | null;
  readonly level: LevelId;
  readonly era: Era;
  readonly tier: WorkTier;
  readonly needsData: boolean;
  /** One-line effect copy. */
  readonly effect: string;
  /** R45: the short effect line for the research sheet, at most about 40 characters. */
  readonly summary: string;
}
export interface LenderView {
  readonly unit: UnitRef;
  readonly label: string;
  readonly online: boolean;
  /** Fraction of the unit's threads on tasks, and the fraction lent to research, 0..1. */
  readonly task: number;
  readonly lent: number;
}
export interface ResearchTreeView {
  readonly nodes: readonly ResearchNodeView[];
  /** Each root's current spec at the focused system (and its rack, room, site); "none" for parts not owned yet. */
  readonly parts: Readonly<Record<ResearchPartId, ResearchPartView>>;
  /**
   * Recent round-time income for ETAs, per second (same as HudSnapshot.incomeRecent): net Credits
   * (gross − energy) over the last 30 s of the running round, negative when energy outruns pay; else
   * the last report's average. 0 until 10 s have elapsed.
   */
  readonly income: { readonly dataPerSec: number; readonly creditsPerSec: number };
  readonly active: ResearchId | null;
  readonly opsPerSec: number;
  /**
   * D27: research ops/s a project would get if taken now: the free threads of the systems with room
   * during a round, or every paused server's threads between rounds. While a project runs, its current rate.
   */
  readonly holdOpsPerSec: number;
  /**
   * Research ops/s once systems take the project, whichever slots are busy now: one thread on every
   * system that can hold it during a round (D27 amendment), every thread of paused, linked, online
   * servers between rounds; while a project runs, its current rate. For the hold estimate.
   */
  readonly takenOpsPerSec: number;
  readonly queue: readonly ResearchId[];
  /** 0 until researchQueue. */
  readonly queueSlots: number;
  /** Highest opened level: the wafer shows nodes up to the next level. */
  readonly horizon: LevelId;
  /** At most 24: one per system, or one per rack / room when there are more. */
  readonly lenders: readonly LenderView[];
  /** Whole Credits/min the active project's energy costs between rounds; '0' when stopped. */
  readonly creditsPerMinute: Amount;
}
export interface SavedConfigsView { readonly kind: UnitKind; readonly names: readonly string[] }
export interface QueuePage {
  readonly systemId: SystemId;
  readonly offset: number;
  readonly total: number;
  readonly tasks: readonly TaskView[];
}
