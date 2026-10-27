import type { BoardKind, StartOrder } from './build';
import type { FilterId, QueueStrategyId, RouteStrategyId } from './catalog';
import type { PartRef, RackId, ResearchId, RoomId, ScopeRef, SwitchRef, SystemId, UnitKind, UnitRef } from './ids';
import type { GameState, TaskRef } from './state';
import type { GpuModelId } from './gpu';

export type TierId = number;

export type BoardPartKind = 'core' | 'socket' | 'l2' | 'l3' | 'scheduler' | 'ram' | 'gpu' | 'npu' | 'drive';

export type ConfigSource =
  | { readonly kind: 'barebones'; readonly tier?: TierId; readonly storageNode?: boolean; readonly board?: BoardKind }
  | { readonly kind: 'copy'; readonly from: UnitRef }
  | { readonly kind: 'saved'; readonly name: string };

/**
 * Every player command. The sim never accepts a client price: handlers re-quote.
 * Actions apply between ticks. Navigation is UI view state and never reaches the sim.
 */
export type GameAction =
  | { readonly type: 'returnToMarket' }
  | { readonly type: 'endRound' }
  | { readonly type: 'dismissReport' }
  | { readonly type: 'dismissTask'; readonly task: TaskRef }
  | { readonly type: 'setAutoReturn'; readonly on: boolean }
  | { readonly type: 'setOnline'; readonly unit: UnitRef; readonly online: boolean }
  | { readonly type: 'upgradePart'; readonly part: PartRef }
  /** Every level from the part's current one up to `level`, atomically, for the summed price (hot like upgradePart). */
  | { readonly type: 'upgradePartTo'; readonly part: PartRef; readonly level: number }
  | { readonly type: 'installGpu'; readonly system: SystemId; readonly model: GpuModelId; readonly index: number | null }
  /** Cold replacement of all non-ECC RAM at the same generation, capacity and bandwidth. */
  | { readonly type: 'convertRamToEcc'; readonly system: SystemId }
  | { readonly type: 'upgradeAll'; readonly system: SystemId; readonly kind: 'ram' | 'gpu' | 'drive'; readonly gen: number }
  | { readonly type: 'replacePart'; readonly part: PartRef; readonly generation: number; readonly preserveCapacity: boolean; readonly minimumCapacity?: number }
  | { readonly type: 'replaceCpu'; readonly system: SystemId }
  | { readonly type: 'addPart'; readonly system: SystemId; readonly kind: BoardPartKind; readonly generation: number; readonly ecc?: boolean }
  | { readonly type: 'removePart'; readonly part: PartRef }
  | { readonly type: 'addUnit'; readonly parent: ScopeRef; readonly slot: number; readonly source: ConfigSource }
  | { readonly type: 'removeUnit'; readonly unit: UnitRef }
  | { readonly type: 'addRow'; readonly room: RoomId }
  | { readonly type: 'applyConfig'; readonly unit: UnitRef; readonly name: string; readonly rolling?: boolean }
  | { readonly type: 'saveConfig'; readonly unit: UnitRef; readonly name: string }
  | { readonly type: 'deleteConfig'; readonly kind: UnitKind; readonly name: string }
  | { readonly type: 'upgradePort'; readonly sw: SwitchRef; readonly port: number | 'all' }
  | { readonly type: 'upgradeUplink'; readonly sw: SwitchRef; readonly uplink: number }
  | { readonly type: 'setSameSpeed'; readonly sw: SwitchRef; readonly on: boolean }
  | { readonly type: 'addPorts'; readonly sw: SwitchRef }
  | { readonly type: 'addUplink'; readonly sw: SwitchRef }
  | { readonly type: 'setStrategy'; readonly unit: ScopeRef; readonly strategy: QueueStrategyId | RouteStrategyId }
  | { readonly type: 'setFilter'; readonly unit: ScopeRef; readonly filter: FilterId; readonly on: boolean }
  /** D31.2: a start controller's configuration (hot), validated against the part's generation. Rack, room or global. */
  | { readonly type: 'setStartConfig'; readonly unit: ScopeRef; readonly startWith: number; readonly headWaitS: number; readonly busyPct: number | null; readonly order: StartOrder }
  /** D25.7: one more router queue slot (L → L + 1, at most 32). Hot. */
  | { readonly type: 'upgradeRouterQueue'; readonly unit: ScopeRef }
  | { readonly type: 'setSetpoint'; readonly unit: { readonly kind: 'rack'; readonly id: RackId } | { readonly kind: 'room'; readonly id: RoomId }; readonly setpointF: number }
  | { readonly type: 'setPowerCap'; readonly part: PartRef; readonly on: boolean }
  | { readonly type: 'setSystemSetting'; readonly system: SystemId; readonly setting: 'dvfs' | 'turbo'; readonly on: boolean }
  | { readonly type: 'setCStateLimit'; readonly system: SystemId; readonly limit: 0 | 1 }
  | { readonly type: 'startResearch'; readonly project: ResearchId }
  | { readonly type: 'queueResearch'; readonly project: ResearchId }
  | { readonly type: 'unqueueResearch'; readonly project: ResearchId }
  | { readonly type: 'cancelResearch' }
  | { readonly type: 'resumeResearch' }
  | { readonly type: 'reset' };
export type GameActionType = GameAction['type'];
export type ActionOf<T extends GameActionType> = Extract<GameAction, { readonly type: T }>;

export type RejectionCode = 'locked' | 'funds' | 'cap' | 'occupied' | 'invalid' | 'roundState';
export interface Rejection { readonly code: RejectionCode; readonly reason: string }
export type ActionOutcome =
  | { readonly ok: true; readonly state: GameState }
  | { readonly ok: false; readonly state: GameState; readonly rejection: Rejection };
