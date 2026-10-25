import { keyedStrategy } from './types';

/** FIFO (fifoSched): earliest take first. Also the behavior of a system with no scheduler. */
export const fifo = keyedStrategy('fifo', () => 0);
