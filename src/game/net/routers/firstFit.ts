import type { RouteStrategy } from './types';

/** firstFit (base, D1.5): the lowest-slot candidate that can admit now. Blind to gates, load and speed. */
export const firstFit: RouteStrategy = { id: 'firstFit', choose: () => 0 };
