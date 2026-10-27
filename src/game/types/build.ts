import type { FilterId, QueueStrategyId, RegionId, RouteStrategyId } from './catalog';
import type { RackId, RoomId, SiteId, SystemId } from './ids';
import type { AccelBuild } from './gpu';
export type { AccelBuild, GpuBuild, NpuBuild } from './gpu';

/**
 * The player's configuration tree (architecture §1.3 `build`). Plain immutable objects.
 * Arrays are indexed by id; a removed unit leaves `null` and its id is never reused.
 * Changes only through actions and research effects. Owner of content: S5 (build/).
 */
export interface PartLevel { readonly gen: number; readonly level: number }
export interface SupplyBuild extends PartLevel {
  /** Power-cap switch (spec §9.5); only meaningful with the `powerCap` rule. */
  readonly capped: boolean;
}
/** One CPU. Every socket of a system holds an identical copy (D7.3); `cores` has at most 32 entries. */
export interface CpuBuild {
  readonly cpu: PartLevel;
  readonly cores: readonly PartLevel[];
  readonly clock: PartLevel;
  readonly l1: PartLevel;
  readonly l2: PartLevel | null;
  readonly l3: PartLevel | null;
}
/** general: ≤ 4 CPUs, ≤ 4 RAM, ≤ 2 GPUs. accelerator: ≤ 2 CPUs, 8 RAM, 8 GPUs, no DIMM penalty (D7.6). */
export type BoardKind = 'general' | 'accelerator';
export interface SchedulerBuild extends PartLevel { readonly strategy: QueueStrategyId }
export interface RamModuleBuild extends PartLevel { readonly ecc: boolean }
export interface SystemSettings {
  readonly dvfs: boolean;
  readonly turbo: boolean;
  /** C-state enabled (1) or disabled (0); research supplies the idle-power factor. */
  readonly cStateLimit: 0 | 1;
}
/**
 * A system's hardware and settings, without identity. Immutable and shared by reference: a copied
 * or config-built system points at the same SystemSpec object, and an edit replaces the whole
 * spec of that one system. Saves and structured clones keep the sharing (R20), so 6,912 identical
 * servers cost one spec.
 */
export interface SystemSpec {
  readonly kind: 'server' | 'storageNode';
  readonly board: BoardKind;
  /** The one CPU design; null for a storage node. */
  readonly cpu: CpuBuild | null;
  /** Identical CPUs, 1–4 (accelerator ≤ 2); 0 for a storage node. */
  readonly cpuCount: number;
  /** One queue and one set of running slots for every core of every CPU. */
  readonly scheduler: SchedulerBuild | null;
  readonly ram: readonly RamModuleBuild[];
  readonly accels: readonly AccelBuild[];
  readonly drives: readonly PartLevel[];
  readonly psu: SupplyBuild;
  readonly settings: SystemSettings;
}
export interface SystemBuild {
  readonly id: SystemId;
  readonly rack: RackId;
  /** Server slot in the rack, 0..11. */
  readonly slot: number;
  /** Online switch (intent). */
  readonly online: boolean;
  readonly spec: SystemSpec;
}

export interface RouterBuild extends PartLevel {
  readonly strategy: RouteStrategyId;
  readonly filters: readonly FilterId[];
  /** D25.7: router queue slots, 1–32 (`upgradeRouterQueue`, one slot per level). */
  readonly queueLevel: number;
}
export interface SwitchBuild {
  readonly gen: number;
  /** Ladder index k per port (spec §7.3). Length = port count. */
  readonly ports: readonly number[];
  readonly uplinks: readonly number[];
  readonly sameSpeed: boolean;
}
/** D31.2: the start controller's wake order. Rack: slot or fastest; room: slot or coolest; global: slot, cheapest or nearest. */
export type StartOrder = 'slot' | 'fastest' | 'coolest' | 'cheapest' | 'nearest';
/** D31.2: wake when the head has waited headWaitS (1–9 s), or (generation 1) the awake units' 10 s busy fraction reaches busyPct (50–95). */
export interface StartTrigger { readonly headWaitS: number; readonly busyPct: number | null }
/**
 * D31.2 start controller: generation, level (wake latency; at the rack also battery capacity) and its saved
 * configuration. startWith: units awake or powered at Return to market (1 … the unit count).
 */
export interface StartCtl extends PartLevel {
  readonly startWith: number;
  readonly trigger: StartTrigger;
  readonly order: StartOrder;
}
export interface CoolerBuild extends PartLevel {
  /** Only used with rackSetpoint / roomSetpoint; default 70. */
  readonly setpointF: number;
}

/** Common to every container. `opened` false = a hidden container (architecture §1.3). */
interface ContainerBuild { readonly online: boolean; readonly opened: boolean }

export interface RackBuild extends ContainerBuild {
  readonly id: RackId;
  readonly room: RoomId;
  /** Rack slot in the room grid, row-major, 0..23. */
  readonly slot: number;
  /** 12 server slots; system or storage node id, or null. */
  readonly servers: readonly (SystemId | null)[];
  readonly cooler: CoolerBuild;
  readonly pdu: SupplyBuild;
  readonly lb: RouterBuild;
  readonly switch: SwitchBuild;
  /** D31.3: Power control, the fifth infrastructure slot under the cooling: battery plus smart start (gen 0–2). */
  readonly powerCtl: StartCtl | null;
}
export interface RoomBuild extends ContainerBuild {
  readonly id: RoomId;
  readonly site: SiteId;
  /** Zone index within the site, 0..2. */
  readonly zone: number;
  readonly rows: number;
  /** rows × 8 rack slots, row-major. */
  readonly racks: readonly (RackId | null)[];
  readonly switch: SwitchBuild;
  readonly lb: RouterBuild;
  readonly cooler: CoolerBuild;
  /** One UPS, two with dualFeed. */
  readonly ups: readonly SupplyBuild[];
  /** D31.2: the room start controller on the UPS (`roomStart`): which racks are powered at round start. */
  readonly start: StartCtl | null;
}
export interface DataPlaneBuild { readonly gen: number; readonly k: number; readonly router: RouterBuild }
export interface LinkBuild { readonly gen: number; readonly k: number }
export interface SiteBuild extends ContainerBuild {
  readonly id: SiteId;
  readonly region: RegionId;
  readonly zones: readonly (RoomId | null)[];
  readonly dataPlane: DataPlaneBuild;
  readonly grid: SupplyBuild;
  /** Link to the gateway; null for the gateway (site 0). */
  readonly backbone: LinkBuild | null;
  /** D31.4: off-grid generation, gen 0–3 = solar, wind, fuel cell, own plant. */
  readonly generation: PartLevel | null;
}
export interface GlobalBuild {
  /** Exists from the `regions` research. */
  readonly scheduler: RouterBuild | null;
  /** D31.2: the global start controller on the scheduler (`globalStart`): which sites come online at round start. */
  readonly start: StartCtl | null;
}

export interface BuildState {
  readonly systems: readonly (SystemBuild | null)[];
  readonly racks: readonly (RackBuild | null)[];
  readonly rooms: readonly (RoomBuild | null)[];
  readonly sites: readonly (SiteBuild | null)[];
  readonly global: GlobalBuild;
  /** Bumps on every build or research-effect change; quotes cache on it. */
  readonly revision: number;
}

/* ---------- Saved configurations (spec §13) ---------- */

/** A system configuration: its online switch and its (shared) spec. */
export type SystemConfig = Omit<SystemBuild, 'id' | 'rack' | 'slot'>;
export interface RackConfig extends Omit<RackBuild, 'id' | 'room' | 'slot' | 'servers' | 'opened'> {
  readonly servers: readonly (SystemConfig | null)[];
}
export interface RoomConfig extends Omit<RoomBuild, 'id' | 'site' | 'zone' | 'racks' | 'opened'> {
  readonly racks: readonly (RackConfig | null)[];
}
export interface SiteConfig extends Omit<SiteBuild, 'id' | 'region' | 'zones' | 'opened' | 'backbone'> {
  readonly zones: readonly (RoomConfig | null)[];
}
export interface SavedConfig<T> { readonly name: string; readonly config: T }
export interface SavedConfigs {
  readonly system: readonly SavedConfig<SystemConfig>[];
  readonly rack: readonly SavedConfig<RackConfig>[];
  readonly room: readonly SavedConfig<RoomConfig>[];
  readonly site: readonly SavedConfig<SiteConfig>[];
}
