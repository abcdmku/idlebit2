/**
 * The sim's public barrel: the only import path for render, ui and platform
 * (architecture §2.1). Everything else under src/game is private.
 */
export type * from './types';

export { createInitialState } from './core/state';
export { advanceGame, advanceGameOwned, copyGameState, copyOfflineState } from './core/advance';
export { applyAction } from './core/actions';
export { deriveRenderSnapshot } from './view/snapshot';
export { quote } from './build/quotes';
export { selectResearchTree, selectContextualResearchTree, selectSavedConfigs, selectQueuePage, selectUnitLabel } from './view/selectors';
export { serializeSave, deserializeSave, SAVE_SCHEMA } from './save/serialize';
export { offlineCapMs } from './build/research/effects';
export { netPerMinute } from './core/ledger';
export { slaPercent } from './core/sla';
export { partName } from './build/catalog/names';
export { FAMILIES, familyKey } from './market/families';
export { formatEnergy, formatHertz, formatOps, formatSize } from './format';

export { TICK_MS, HEAD_TICKS, QUEUE_VISIBLE, RECENT_OUTCOMES, REGIONS, LEVEL_NAMES, MAX_CORES_PER_CPU, MAX_CPUS, SERVERS_PER_RACK, RACK_SLOTS_PER_ROW, MAX_ROWS, MAX_ZONES_PER_SITE, MAX_SITES } from './core/constants';
export { FAIL_CAUSES, FAIL_DETAILS } from './types/events';
export { UNIT_MODES } from './types/views';
export {
  QUEUE_STRATEGY_IDS, ROUTE_STRATEGY_IDS, FILTER_IDS, REGION_IDS, RESOURCES, MEM_TIERS, PART_IDS,
} from './types/catalog';
export { systemId, rackId, roomId, siteId, familyId, researchId } from './types/ids';
export { MAX_ACCELS, ACCEL_DOMAINS, ACCEL_CLOCKS, POOL_DOMAIN, GENERAL_MAX_GPUS, ACCEL_GPU_SLOTS, ROUTER_QUEUE_MAX, MAX_SHARDS } from './core/constants';
