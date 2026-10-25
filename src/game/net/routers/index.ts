import { ROUTE_STRATEGY_IDS, type RouteStrategyId } from '../../types/catalog';
import { affinity } from './affinity';
import { binPacking } from './binPacking';
import { firstFit } from './firstFit';
import { latency } from './latency';
import { leastConn } from './leastConn';
import { leastWork } from './leastWork';
import { linkAware } from './linkAware';
import { price } from './price';
import { roundRobin } from './roundRobin';
import type { RouteStrategy } from './types';
import { weighted } from './weighted';

const BY_ID: Readonly<Record<RouteStrategyId, RouteStrategy>> = {
  firstFit, roundRobin, leastConn, weighted, leastWork, binPack: binPacking, latency, price, affinity, linkAware,
};
/** Indexed by the compiled strategy byte (ROUTE_STRATEGY_IDS order). */
export const ROUTE_STRATEGIES: readonly RouteStrategy[] = ROUTE_STRATEGY_IDS.map((id) => BY_ID[id]);
export const routeStrategy = (byte: number): RouteStrategy => ROUTE_STRATEGIES[byte] ?? firstFit;
