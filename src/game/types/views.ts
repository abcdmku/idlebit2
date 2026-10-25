import type { Amount } from '../amount';
import type { CoolTech, Era, FilterId, PlacementId, RegionId, ResearchCategory, Resource, RouteStrategyId, WorkTier } from './catalog';
import type { FailCause, FailDetail, SupplyKind } from './events';
import type { FamilyId, LevelId, RackId, ResearchId, RoomId, SiteId, SystemId, UnitKind, UnitRef } from './ids';
import type { ResearchMode, TaskRef } from './state';
import type { GpuStats } from './gpu';

/**
 * System modes (spec §4.3), plus `empty` for a slot with no unit. MODE_IDS index = the u8 in
 * hot `sys.mode`. `draining` = going offline with gracefulDrain, still running its tasks.
 */
export const UNIT_MODES = ['empty', 'onMarket', 'asleep', 'boot', 'goingOffline', 'draining', 'offline', 'paused', 'cold', 'crashed', 'dark'] as const;
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
  readonly placements: readonly PlacementId[];
  readonly reserveOnRoute: boolean;
  readonly routedPerSec: number;
  readonly misroutesThisRound: number;
  /** Child slot this router last routed to this tick, or null (the LB decision light). */
  readonly lastTarget: number | null;
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

export interface TaskView extends TaskRequirementsView {
  /** Lifetime assignment: 0..7 physical, 8 linked pool, null while unassigned. */
  readonly accelDomain: number | null;
  readonly gpuCoresMin: number;
  readonly vramBits: number;
  readonly key: number;
  readonly family: FamilyId;
  readonly count: number;
  readonly stage: number;
  readonly resource: Resource;
  /** Fraction of the current stage, 0..1. */
  readonly progress: number;
  readonly deadlineTick: number | null;
}

export type PartViewKind = 'cpu' | 'core' | 'clock' | 'l1' | 'l2' | 'l3' | 'scheduler' | 'ram' | 'gpu' | 'npu' | 'drive' | 'psu';
export interface PartView {
  /** Capacity of this RAM stick or drive, in bits. Set for ram and drive. */
  readonly capacityBits?: number;
  /** This RAM stick's channel rate or drive's IO rate, in bit/s. Set for ram and drive. */
  readonly rateBits?: number;
  /** Physical memory hold; linked GPU holds are striped in proportion to card capacity. */
  readonly vramUsedBits?: number;
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
}
export interface RackSlotView {
  readonly rackId: RackId | null;
  readonly state: UnitMode;
  readonly load: number;
  readonly tempF: number;
  readonly pduUsage: number;
  /** 12 UnitMode codes (UNIT_MODES index). */
  readonly servers: Uint8Array;
}
export interface ZoneView {
  readonly roomId: RoomId | null;
  readonly zone: number;
  readonly state: UnitMode;
  readonly tempF: number;
  readonly load: number;
  readonly upsUsage: number;
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
}

export interface TaskRequirementsView {
  readonly family: FamilyId;
  readonly label: string;
  readonly stages: readonly { readonly resource: Resource; readonly work: number }[];
  readonly threads: number;
  readonly workingSetBits: number;
  readonly gpuCoresMin: number;
  readonly vramBits: number;
  readonly storageBits: number;
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
}
/** A task moving over a link at its real speed (D10.4, D12.4). */
export interface TransferView {
  readonly taskId: number;
  readonly family: FamilyId;
  /** Target system. */
  readonly systemId: SystemId;
  /** 'pipe' before Rack; else the link the transfer is on. */
  readonly link: 'pipe' | 'server' | 'rack' | 'zone' | 'backbone';
  readonly bitsSent: number;
  readonly bits: number;
  /** bit/s. */
  readonly speed: number;
}
export type TaskIcon = Resource | 'vram' | 'storageCap' | 'ecc' | 'tensor' | 'gang' | 'zones' | 'region';
export interface OutcomeView {
  readonly family: FamilyId;
  readonly count: number;
  readonly outcome: 'met' | FailCause;
  readonly detail: FailDetail | null;
  readonly tick: number;
}


/* ---------- Lazy selector results (not part of the snapshot) ---------- */

export type ResearchNodeState = 'done' | 'active' | 'parked' | 'queued' | 'available' | 'locked';
export interface ResearchNodeView {
  readonly needsCredits?: boolean;
  readonly creditCost?: Amount;
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
  readonly active: ResearchId | null;
  readonly mode: ResearchMode;
  readonly opsPerSec: number;
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
