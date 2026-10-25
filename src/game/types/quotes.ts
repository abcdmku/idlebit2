import type { Amount } from '../amount';
import type { GameAction } from './actions';
import type { NodeRef, PartRef, RackId, ResearchId, RoomId, ScopeRef, SwitchRef, SystemId } from './ids';
import type { GpuGeneration, GpuStats } from './gpu';

export type QuoteRequest =
  | { readonly kind: 'gpuModels'; readonly system: SystemId; readonly index: number | null; readonly generation: GpuGeneration }
  /** The 4 primary tray items, followed by per-core upgrade quotes at chip level. */
  | { readonly kind: 'tray'; readonly at: NodeRef }
  /** Upgrade, replace options, add/remove for one part. */
  | { readonly kind: 'part'; readonly part: PartRef }
  /** Configuration plate: barebones tiers, copies, saved names. */
  | { readonly kind: 'add'; readonly parent: ScopeRef; readonly slot: number }
  /** Per-port and all-port speed, port count, uplinks. */
  | { readonly kind: 'switch'; readonly sw: SwitchRef }
  | { readonly kind: 'infra'; readonly unit: { readonly kind: 'rack'; readonly id: RackId } | { readonly kind: 'room'; readonly id: RoomId }; readonly slot: 'cooling' | 'power' | 'lb' | 'switch' }
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
  | { readonly kind: 'routerQueue'; readonly unit: ScopeRef };

export type Currency = 'credits' | 'data';
export type LockCode = 'research' | 'ceiling' | 'cap' | 'fit' | 'roundState' | 'occupied';
export interface LockReason {
  readonly code: LockCode;
  /** The first missing research node, when code is 'research'. */
  readonly node: ResearchId | null;
  /** Short copy, e.g. "Needs Rack water". */
  readonly text: string;
}
export type CapacityUnit = 'ops/s' | 'bits' | 'bit/s' | 'Hz' | 'W' | 'tasks/s' | 'lanes' | 'slots' | 'cores' | 'ports' | 'ops';
export interface EffectPreview {
  readonly capacityBefore: number;
  readonly capacityAfter: number;
  readonly unit: CapacityUnit;
  readonly wattsBefore: number;
  readonly wattsAfter: number;
  /** Whole Credits per minute; negative = saves energy. */
  readonly energyPerMinuteDelta: Amount;
  /** price / net gain per second at current load; null = "No payback at this load". */
  readonly paybackS: number | null;
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
export interface Quote {
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
