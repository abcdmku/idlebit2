import { keyedStrategy } from './types';

/**
 * Time slicing (timeSlice): earliest take first, Keff = 2K (compiled), running tasks share the cores
 * equally (clocks.ts cpu rate × min(1, threads / Σ threads)), and no in-tick chaining.
 */
export const timeSlice = keyedStrategy('timeSlice', () => 0, true);
