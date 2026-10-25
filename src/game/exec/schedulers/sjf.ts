import { estRecord } from '../est';
import { keyedStrategy } from './types';

/** Shortest job first (sjf): the smallest est at this system's rates, in the queue. */
export const sjf = keyedStrategy('sjf', (w, s, r) => estRecord(w, s, r));
