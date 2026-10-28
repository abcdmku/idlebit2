import { FILTER_NAMES, QUEUE_NAMES, ROUTE_NAMES } from '../view/labels';
import type { BuildState, QueueOptimization, RouterBuild, SystemSettings } from '../types/build';
import { QUEUE_STRATEGY_IDS, type FilterId, type QueueStrategyId, type RouteStrategyId } from '../types/catalog';
import type { PartRef, RackId, RoomId, ScopeRef, SystemId } from '../types/ids';
import type { GameState } from '../types/state';
import { ROUTER_QUEUE_MAX } from '../core/constants';
import { lbQueueStep } from './catalog/network';
import { optionLock, ruleLock } from './locks';
import { withSpec } from './partAccess';
import { fail, locked, planned, type Plan } from './plan';

/* Strategy, filter, setpoint and switch changes are hot and free (program D1.6, spec §4.5). */

export const SETPOINT_MIN_F = 55;
export const SETPOINT_MAX_F = 80;

export function planQueueLoaderLimit(state: GameState, system: SystemId, limit: 1 | 2 | 4): Plan {
  const spec = state.build.systems[system]?.spec;
  if (!spec?.scheduler) return fail('invalid', 'Needs a queue');
  if (![1, 2, 4].includes(limit) || limit > state.compiled.sys.preloadLoaders[system]!) return fail('locked', 'Research more parallel loaders');
  return planned({ build: withSpec(state.build, system, { ...spec, settings: { ...spec.settings, queueLoaderLimit: limit } }), price: 0n }, 'Cache loader budget');
}

function routerOf(build: BuildState, unit: ScopeRef): RouterBuild | null {
  switch (unit.kind) {
    case 'rack': return build.racks[unit.id]?.opened ? build.racks[unit.id]!.lb : null;
    case 'room': return build.rooms[unit.id]?.opened ? build.rooms[unit.id]!.lb : null;
    case 'site': return build.sites[unit.id]?.opened ? build.sites[unit.id]!.dataPlane.router : null;
    case 'global': return build.global.scheduler;
    default: return null;
  }
}
function withRouter(build: BuildState, unit: ScopeRef, lb: RouterBuild): BuildState {
  const at = <T>(list: readonly (T | null)[], id: number, f: (x: T) => T) => list.map((x, i) => (i === id && x ? f(x) : x));
  switch (unit.kind) {
    case 'rack': return { ...build, racks: at(build.racks, unit.id, (r) => ({ ...r, lb })) };
    case 'room': return { ...build, rooms: at(build.rooms, unit.id, (z) => ({ ...z, lb })) };
    case 'site': return { ...build, sites: at(build.sites, unit.id, (s) => ({ ...s, dataPlane: { ...s.dataPlane, router: lb } })) };
    default: return { ...build, global: { ...build.global, scheduler: lb } };
  }
}
const editRouter = (state: GameState, unit: ScopeRef, f: (lb: RouterBuild) => RouterBuild, label: string): Plan => {
  const lb = routerOf(state.build, unit);
  return lb ? planned({ build: withRouter(state.build, unit, f(lb)), price: 0n }, label) : fail('invalid', 'No router here');
};
const toggle = <T>(list: readonly T[], id: T, on: boolean): T[] => (on ? (list.includes(id) ? [...list] : [...list, id]) : list.filter((x) => x !== id));

export function planStrategy(state: GameState, unit: ScopeRef, strategy: QueueStrategyId | RouteStrategyId): Plan {
  const u = state.research.unlocks;
  if (unit.kind === 'system') {
    const spec = state.build.systems[unit.id]?.spec;
    if (!spec?.scheduler) return fail('invalid', 'Needs a scheduler');
    if (!(QUEUE_STRATEGY_IDS as readonly string[]).includes(strategy)) return fail('invalid', 'Not a system strategy');
    const name = QUEUE_NAMES[strategy as QueueStrategyId];
    const lock = strategy === 'fifo' ? null : optionLock(u, strategy, 'queue');
    if (lock) return locked(lock, name, 0n);
    return planned({ build: withSpec(state.build, unit.id, { ...spec, scheduler: { ...spec.scheduler, strategy: strategy as QueueStrategyId } }), price: 0n }, name);
  }
  if ((QUEUE_STRATEGY_IDS as readonly string[]).includes(strategy)) return fail('invalid', 'Not a network strategy');
  const name = ROUTE_NAMES[strategy as RouteStrategyId].name;
  const lock = strategy === 'firstFit' ? null : optionLock(u, strategy, 'route');
  if (lock) return locked(lock, name, 0n);
  return editRouter(state, unit, (lb) => ({ ...lb, strategy: strategy as RouteStrategyId }), name);
}

/** Free, hot scheduler choices, available as soon as a queue is installed. */
export function planQueueSetting(state: GameState, system: SystemId, setting: 'optimization' | 'batching', value: QueueOptimization | boolean): Plan {
  const spec = state.build.systems[system]?.spec;
  if (!spec?.scheduler) return fail('invalid', 'Needs a queue');
  if (setting === 'optimization' ? value !== 'utilization' && value !== 'preload' : typeof value !== 'boolean')
    return fail('invalid', 'Invalid queue setting');
  const scheduler = setting === 'optimization' ? { ...spec.scheduler, optimization: value as QueueOptimization }
    : { ...spec.scheduler, batching: value as boolean };
  return planned({ build: withSpec(state.build, system, { ...spec, scheduler }), price: 0n }, 'Queue');
}

export function planFilter(state: GameState, unit: ScopeRef, filter: FilterId, on: boolean): Plan {
  const name = FILTER_NAMES[filter].name;
  const lock = on ? optionLock(state.research.unlocks, filter, 'filter') : null;
  if (lock) return locked(lock, name, 0n);
  return editRouter(state, unit, (lb) => ({ ...lb, filters: toggle(lb.filters, filter, on) }), name);
}

/** The router's queue one slot larger, L → L + 1 (at most 8). Hot; never research-gated. */
export function planRouterQueue(state: GameState, unit: ScopeRef): Plan {
  const lb = routerOf(state.build, unit);
  if (!lb || unit.kind === 'system') return fail('invalid', 'No router here');
  const level = lb.queueLevel;
  const label = `Queue ${level} → ${level + 1}`;
  if (level >= ROUTER_QUEUE_MAX) return fail('cap', 'Max', `Queue ${level}`);
  const price = lbQueueStep(unit.kind, level);
  return planned({ build: withRouter(state.build, unit, { ...lb, queueLevel: level + 1 }), price }, label);
}

/** Cooler setpoint, 55–80 °F, with rackSetpoint / roomSetpoint (spec §10.5). */
export function planSetpoint(state: GameState, unit: { kind: 'rack'; id: RackId } | { kind: 'room'; id: RoomId }, setpointF: number): Plan {
  const lock = ruleLock(state.research.unlocks, unit.kind === 'rack' ? 'rackSetpoint' : 'roomSetpoint');
  if (lock) return locked(lock, 'Setpoint', 0n);
  if (!(setpointF >= SETPOINT_MIN_F && setpointF <= SETPOINT_MAX_F)) return fail('invalid', `Setpoint is ${SETPOINT_MIN_F}–${SETPOINT_MAX_F} °F`);
  const b = state.build;
  if (unit.kind === 'rack') {
    if (!b.racks[unit.id]) return fail('invalid', 'No such rack');
    return planned({ build: { ...b, racks: b.racks.map((r, i) => (i === unit.id && r ? { ...r, cooler: { ...r.cooler, setpointF } } : r)) }, price: 0n }, 'Setpoint');
  }
  if (!b.rooms[unit.id]) return fail('invalid', 'No such zone');
  return planned({ build: { ...b, rooms: b.rooms.map((z, i) => (i === unit.id && z ? { ...z, cooler: { ...z.cooler, setpointF } } : z)) }, price: 0n }, 'Setpoint');
}

/** The power-cap switch on a board PSU or rack PDU (spec §9.5). */
export function planPowerCap(state: GameState, part: PartRef, on: boolean): Plan {
  const lock = on ? ruleLock(state.research.unlocks, 'powerCap') : null;
  if (lock) return locked(lock, 'Power cap', 0n);
  const b = state.build;
  if (part.unit.kind === 'system' && part.slot.kind === 'psu') {
    const spec = b.systems[part.unit.id]?.spec;
    return spec ? planned({ build: withSpec(b, part.unit.id, { ...spec, psu: { ...spec.psu, capped: on } }), price: 0n }, 'Power cap') : fail('invalid', 'No such system');
  }
  if (part.unit.kind === 'rack' && part.slot.kind === 'pdu') {
    const id = part.unit.id;
    return b.racks[id] ? planned({ build: { ...b, racks: b.racks.map((r, i) => (i === id && r ? { ...r, pdu: { ...r.pdu, capped: on } } : r)) }, price: 0n }, 'Power cap') : fail('invalid', 'No such rack');
  }
  return fail('invalid', 'Only a power supply or PDU can cap');
}

function editSettings(state: GameState, system: SystemId, patch: Partial<SystemSettings>, label: string): Plan {
  const spec = state.build.systems[system]?.spec;
  if (!spec) return fail('invalid', 'No such system');
  return planned({ build: withSpec(state.build, system, { ...spec, settings: { ...spec.settings, ...patch } }), price: 0n }, label);
}

export function planSystemSetting(state: GameState, system: SystemId, setting: 'dvfs' | 'turbo', on: boolean): Plan {
  const lock = on ? ruleLock(state.research.unlocks, setting) : null;
  if (lock) return locked(lock, setting, 0n);
  return editSettings(state, system, { [setting]: on }, setting);
}

/** C-state is available after its first level is purchased. */
export const deepestCState = (state: GameState): 0 | 1 => (state.research.unlocks.ruleParams.coreIdle?.level ?? 0) > 0 ? 1 : 0;

export function planCStateLimit(state: GameState, system: SystemId, limit: 0 | 1): Plan {
  if (limit !== 0 && limit !== 1) return fail('invalid', 'C-state must be on or off');
  if (limit > deepestCState(state)) {
    const lock = ruleLock(state.research.unlocks, 'coreIdle') ?? { code: 'research' as const, node: null, text: 'Needs C-state' };
    return locked(lock, 'C-state', 0n);
  }
  return editSettings(state, system, { cStateLimit: limit }, `C-state ${limit ? 'on' : 'off'}`);
}
