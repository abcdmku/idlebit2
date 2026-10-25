import { linkSpeedOf, rated } from '../metrics';
import { RACK } from '../scope';
import type { RouteStrategy } from './types';

/** Payload bits per op of work: payload is work (D10.4). */
const BITS_PER_OP = 1;

/**
 * linkAware (topologyAware, D25.9; zone, site and global scope): index order; weight
 * min(rated(c), link(c) / bitsPerOp), so a rack behind a slow uplink gets a small share instead of
 * holding the task back. At rack scope it is firstFit.
 */
export const linkAware: RouteStrategy = {
  id: 'linkAware',
  weighted: true,
  plan(w, kind, _id, _r, cand, _slot, weight, n) {
    for (let i = 0; i < n; i += 1) {
      weight[i] = kind === RACK ? 1 : Math.max(1e-300, Math.min(rated(w, kind, cand[i]!, true), linkSpeedOf(w, kind, cand[i]!) / BITS_PER_OP));
    }
    return n;
  },
};
