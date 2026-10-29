import type { Amount } from '../amount';
import type { InfraSlot } from './catalog';
import type { GameAction } from './actions';
import type { NodeRef, PartRef, RackId, ResearchId, RoomId, ScopeRef, SwitchRef, SystemId } from './ids';
import type { GpuGeneration, GpuStats } from './gpu';

export type QuoteRequest =
  | { readonly kind: 'gpuModels'; readonly system: SystemId; readonly index: number | null; readonly generation: GpuGeneration }
  /** The 4 primary tray items, followed by per-core upgrade quotes at chip level. */
  | { readonly kind: 'tray'; readonly at: NodeRef }
  /** Upgrade, replace options, add/remove for one part. */
  | { readonly kind: 'part'; readonly part: PartRef; readonly minimumCapacity?: number }
  /** Configuration plate: barebones tiers, copies, saved names. */
  | { readonly kind: 'add'; readonly parent: ScopeRef; readonly slot: number }
  /** Per-port and all-port speed, port count, uplinks. */
  | { readonly kind: 'switch'; readonly sw: SwitchRef }
  | { readonly kind: 'infra'; readonly unit: { readonly kind: 'rack'; readonly id: RackId } | { readonly kind: 'room'; readonly id: RoomId }; readonly slot: InfraSlot }
  | { readonly kind: 'research'; readonly project: ResearchId }
  /** D13, D15: the system's pipe, its rack-switch port: the next speed step, locked until Rack ("Upgrade at the Rack switch"). */
  | { readonly kind: 'pipe'; readonly system: SystemId }
  /**
   * R43, D15.5: the level's inbound link, one quote: its next speed step with a 'bit/s' effect, or
   * that step locked with where it upgrades. chip, system: the system's pipe (as 'pipe'); rack: the
   * rack's slowest uplink; room: the room's slowest uplink; global: the cheapest backbone step.
   * Empty when the level has no such link.
   */
  | { readonly kind: 'inbound'; readonly at: NodeRef }
  /**
   * D25.7: the router's queue, one quote: `upgradeRouterQueue` to the next level, cost
   * lbQueueStep(L → L + 1), effect `slots` L → L + 1; locked (code 'cap') at 32.
   */
  | { readonly kind: 'routerQueue'; readonly unit: ScopeRef }
  /**
   * D31: a scope's optional power part (rack Power control, room start control on the UPS, global start
   * control on the scheduler, site generation): one install per generation while the slot is empty;
   * once installed, the level upgrade then a replace per other generation. Empty for a unit with no such slot.
   */
  | { readonly kind: 'power'; readonly unit: ScopeRef }
  /**
   * What a blocked task needs from one system, and the cheapest way to each: per missing component, the
   * minimal multi-level upgrade (`upgradePartTo`), an add or install, a replace past the generation's top,
   * or the same quote locked with the research it needs.
   */
  | { readonly kind: 'meet'; readonly system: SystemId; readonly need: MeetNeed };

/** A task's gates on one system (spec §6.1, D26.1): cache = CPU cache bits; ram; disk; GPU VRAM and cores; core count; ECC. */
export interface MeetNeed {
  readonly cacheBits?: number;
  readonly ramBits?: number;
  readonly diskBits?: number;
  readonly vramBits?: number;
  readonly gpuCores?: number;
  readonly cores?: number;
  readonly ecc?: boolean;
}

export type Currency = 'credits' | 'data';
export type LockCode = 'research' | 'power' | 'ceiling' | 'cap' | 'fit' | 'roundState' | 'occupied';
export interface LockReason {
  readonly code: LockCode;
  /** The first missing research node, including Rack at a starter power limit. */
  readonly node: ResearchId | null;
  /** Short copy, e.g. "Needs Rack water". */
  readonly text: string;
}
/** 'J': energy (a Power control battery's capacity). */
export type CapacityUnit = 'ops/s' | 'bits' | 'bit/s' | 'Hz' | 'W' | 'J' | 'tasks/s' | 'slots' | 'cores' | 'ports' | 'ops';
export interface EffectPreview {
  /** A generation replacement can raise the ceiling while preserving current speed. */
  readonly capacityLabel?: 'Limit';
  readonly capacityBefore: number;
  readonly capacityAfter: number;
  readonly unit: CapacityUnit;
  readonly wattsBefore: number;
  readonly wattsAfter: number;
  /** Whole Credits per minute; negative = saves energy. */
  readonly energyPerMinuteDelta: Amount;
  /** price / net gain per second at current load; null = "No payback at this load". */
  readonly paybackS: number | null;
  /** Market estimate: recent paid work and energy per unit at the saved sleep settings. */
  readonly marketEstimate?: boolean;
  /** False means no return model applies, rather than a computed nonpositive return. */
  readonly paybackEvaluated?: boolean;
  /** A supply warning invalidates a market forecast until the supply is prepared. */
  readonly paybackBlockedBySupply?: boolean;
  /** The purchase's added energy exceeds its added task earnings in the estimate. */
  readonly marginalLoss?: boolean;
  /** Research capacity is shown separately and never valued as Credit income. */
  readonly researchOpsBefore?: number;
  readonly researchOpsAfter?: number;
  /** Sustained CPU research after this buy exceeds the rack cooler's rated heat removal. View W. */
  readonly researchCooling?: { readonly rack: RackId; readonly heatW: number; readonly capacityW: number };
  /** RAM bandwidth or drive IO for this part, bit/s, when capacity alone would hide a trade-off. */
  readonly throughputBefore?: number;
  readonly throughputAfter?: number;
  /**
   * A power supply change only: its loss before and after, in percent of delivered watts at
   * typical load (×1 up to 90% usage; exact, the UI rounds). wattsBefore/After are then the
   * system's input power at its current draw (delivered + loss), so the energy delta and payback
   * are the saving.
   */
  readonly lossPctBefore?: number;
  readonly lossPctAfter?: number;
}
/** Full-load system power at the current research and environment. */
export interface GpuPowerPoint {
  readonly deliveredW: number;
  readonly capacityW: number;
  readonly lossW: number;
  readonly inputW: number;
  /** Supply capacity minus delivered load; may be negative. */
  readonly headroomW: number;
}
export interface GpuPowerPreview {
  readonly before: GpuPowerPoint;
  readonly after: GpuPowerPoint;
}
/** A hardware purchase blocked by its rack or room full-load allocation, in view watts. */
export interface OverSupply { readonly part: 'psu' | 'pdu' | 'ups'; readonly capW: number; readonly afterW: number; readonly rack?: RackId; readonly room?: RoomId }

export interface Quote {
  /** Set when the plan's full-load draw would exceed a supply; absent otherwise. */
  readonly overSupply?: OverSupply;
  readonly gpuPower?: GpuPowerPreview;
  readonly gpu?: { readonly before: GpuStats | null; readonly after: GpuStats };
  /** Additional Credit fee when the primary currency is Data. */
  readonly creditCost?: Amount;
  readonly action: GameAction;
  readonly label: string;
  readonly cost: Amount;
  readonly currency: Currency;
  readonly affordable: boolean;
  readonly locked: LockReason | null;
  readonly cold: boolean;
  readonly downtimeMs: number;
  readonly effect: EffectPreview | null;
  /** Research only: compute work volume in ops. */
  readonly workOps: number | null;
}
export interface QuoteResult {
  /** build.revision the static parts were computed at. */
  readonly configRevision: number;
  readonly quotes: readonly Quote[];
}
