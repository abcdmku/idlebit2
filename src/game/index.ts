/**
 * The sim's public barrel: the only import path for render, ui and platform
 * (architecture §2.1). Everything else under src/game is private.
 */
export type * from './types';

export { createInitialState } from './core/state';
export { advanceGame, advanceGameOwned, copyGameState, copyOfflineState } from './core/advance';
export { applyAction } from './core/actions';
export { selectBankruptcy } from './core/bankruptcy';
export { deriveRenderSnapshot } from './view/snapshot';
export { quote } from './build/quotes';
export { SETPOINT_MIN_F, SETPOINT_MAX_F } from './build/settings';
export { selectSystemPower } from './view/systemPower';
export { tierOf, tierValue } from './view/frontier';
export { ROUTE_NAMES, FILTER_NAMES, QUEUE_NAMES, rackLetter, zoneLetter, regionName } from './view/labels';
export { selectResearchTree, selectContextualResearchTree, selectSavedConfigs, selectUnitLabel } from './view/selectors';
export { queueWindow as selectMarketQueue } from './view/feed';
export { selectSystemQueue } from './view/systemQueue';
export { selectRoundRewards } from './view/roundRewards';
export { selectFleetHealth, HEALTH_LIMIT } from './view/health';
export { serializeSave, deserializeSave } from './save/serialize';
export { offlineCapMs } from './build/research/effects';
export { partName } from './build/catalog/names';
export { FAMILIES, familyKey } from './market/families';
export { payoutCreditsAt, payloadAt } from './market/families';
export { selectTaskBreakdown } from './view/taskBreakdown';
export { formatClock, formatEnergy, formatHertz, formatOps, formatSize, formatWatts } from './format';

export { TICK_MS, HEAD_TICKS, REGIONS, LEVEL_NAMES, RACK_SLOTS_PER_ROW, MAX_ROWS, SAVED_CONFIGS_PER_KIND } from './core/constants';
export { FAIL_CAUSES } from './types/events';
export { UNIT_MODES } from './types/views';
export { REGION_IDS } from './types/catalog';
export { systemId, rackId, roomId, siteId, familyId, researchId } from './types/ids';
export { POOL_DOMAIN, ROUTER_QUEUE_MAX } from './core/constants';

export { amount } from './amount';
export { MUSIC_TRACKS, selectMusicTracks, type MusicTrackView } from './music';
export { wakeLatencyS } from './build/catalog/infra';
