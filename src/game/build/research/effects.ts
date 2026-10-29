import { secondsToTicks } from '../../core/constants';
import { baseRouter } from '../../core/defaults';
import { baseUnlocks } from '../../core/state';
import type { BuildState } from '../../types/build';
import type { CeilingId, FilterId, PartId, QueueStrategyId, RouteStrategyId, RuleId } from '../../types/catalog';
import type { LevelId, ResearchId } from '../../types/ids';
import type { GameState, Unlocks } from '../../types/state';
import { researchDef, TREE_INDEX } from './tree';

/** Offline catch-up cap: 8 h, raised by research to 12 h and 24 h (D1.10). */
export const offlineCapMs = (state: GameState): number => state.research.unlocks.offlineCapHours * 3_600_000;

type Params = Record<string, number>;

/**
 * Flattens every completed node's effects (spec Appendix C) into Unlocks, in tree order so the
 * result does not depend on completion order. Ceilings take the maximum; rule params merge with
 * later nodes winning. Memory technologies specify total multipliers, GDDR6 4 and HBM 16.
 */
export function deriveUnlocks(completed: readonly ResearchId[]): Unlocks {
  const base = baseUnlocks();
  const levels: Record<LevelId, boolean> = { ...base.levels };
  const gens: Record<PartId, number> = { ...base.gens };
  const ceilings: Record<CeilingId, number> = { ...base.ceilings };
  const queue = new Set<QueueStrategyId>(base.queueStrategies);
  const route = new Set<RouteStrategyId>(base.routeStrategies);
  const filters = new Set<FilterId>(base.filters);
  const rules = new Set<RuleId>(base.rules);
  const params: Partial<Record<RuleId, Params>> = {};

  const ordered = [...completed].sort((a, b) => (TREE_INDEX.get(a) ?? 0) - (TREE_INDEX.get(b) ?? 0));
  for (const id of ordered) {
    const node = researchDef(id);
    if (!node) continue;
    for (const e of node.effects) {
      switch (e.kind) {
        case 'gen': gens[e.part] = (gens[e.part] ?? 0) | (1 << e.gen); break;
        case 'ceiling':
          ceilings[e.key] = Math.max(ceilings[e.key], e.value);
          if (e.key === 'sites') ceilings.regions = Math.max(ceilings.regions, e.value);
          break;
        case 'strategy':
          if (e.scope === 'system') queue.add(e.id as QueueStrategyId); else route.add(e.id as RouteStrategyId);
          break;
        case 'filter': filters.add(e.id); break;
        case 'view': levels[e.level] = true; break;
        case 'rule': {
          rules.add(e.id);
          const prev = params[e.id];
          const next: Params = { ...prev, ...e.params };
          if (e.params || prev) params[e.id] = next;
          break;
        }
      }
    }
  }
  if (levels.system) levels.chip = true;
  const p = (rule: RuleId, key: string) => params[rule]?.[key];
  return {
    levels, gens, ceilings,
    queueStrategies: [...queue], routeStrategies: [...route], filters: [...filters],
    rules: [...rules], ruleParams: params,
    bootTicks: p('bootSeconds', 'seconds') !== undefined ? secondsToTicks(p('bootSeconds', 'seconds')!) : base.bootTicks,
    autoReturnDelayTicks: p('autoReturn', 'delayS') !== undefined ? secondsToTicks(p('autoReturn', 'delayS')!) : base.autoReturnDelayTicks,
    offlineCapHours: p('offlineCap', 'hours') ?? base.offlineCapHours,
  };
}

/**
 * Applies the structural part of the unlocks to the build (spec §3.2): a `view` effect opens its
 * hidden container (rack 0 with system 0 in server slot 1, room 0, site 0) and `gen: site 0`
 * grants the free global scheduler. Idempotent; returns the same object when nothing changes.
 */
export function openContainers(build: BuildState, unlocks: Unlocks): BuildState {
  let next = build;
  const open = <T extends { opened: boolean }>(list: readonly (T | null)[], key: 'racks' | 'rooms' | 'sites', on: boolean) => {
    const first = list[0];
    if (!on || !first || first.opened) return;
    next = { ...next, [key]: list.map((x, i) => (i === 0 && x ? { ...x, opened: true } : x)) };
  };
  open(build.racks, 'racks', unlocks.levels.rack);
  open(build.rooms, 'rooms', unlocks.levels.room);
  open(build.sites, 'sites', unlocks.levels.global);
  if (!next.global.scheduler && (unlocks.gens.site & 1) !== 0) next = { ...next, global: { ...next.global, scheduler: baseRouter(0) } };
  return next === build ? build : { ...next, revision: build.revision + 1 };
}
