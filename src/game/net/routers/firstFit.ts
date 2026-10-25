import { equal, type RouteStrategy } from './types';

/** firstFit (base, D1.5): index order, equal shares; the remainder goes to the first. Blind to gates, load and speed. */
export const firstFit: RouteStrategy = { id: 'firstFit', weighted: false, plan: (_w, _k, _id, _r, _c, _s, weight, n) => equal(weight, n) };
