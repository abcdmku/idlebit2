import type { World } from '../../core/world';
import { QUEUE_STRATEGY_IDS, type QueueStrategyId } from '../../types/catalog';
import { fifo } from './fifo';
import { mlfq } from './mlfq';
import { priority } from './priority';
import { sjf } from './sjf';
import { timeSlice } from './timeSlice';
import type { QueueStrategy } from './types';

const BY_ID: Readonly<Record<QueueStrategyId, QueueStrategy>> = { fifo, sjf, timeSlice, priority, mlfq };
/** Indexed by the compiled strategy byte (QUEUE_STRATEGY_IDS order). */
export const QUEUE_STRATEGIES: readonly QueueStrategy[] = QUEUE_STRATEGY_IDS.map((id) => BY_ID[id]);

export const strategyOf = (w: World, s: number): QueueStrategy => QUEUE_STRATEGIES[w.compiled.sys.strategy[s]!] ?? fifo;
export type { QueueStrategy } from './types';
