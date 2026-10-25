import { G } from '../../core/buffers';
import type { World } from '../../core/world';
import { FANOUT, RACK, ROOM, SITE } from '../scope';
import { equal, type RouteStrategy } from './types';

function cursor(w: World, kind: number, id: number): number {
  switch (kind) {
    case RACK: return w.hot.rack.lbCursor[id]!;
    case ROOM: return w.hot.room.lbCursor[id]!;
    case SITE: return w.hot.site.lbCursor[id]!;
    default: return w.hot.g[G.globalCursor]!;
  }
}

function setCursor(w: World, kind: number, id: number, value: number): void {
  switch (kind) {
    case RACK: w.hot.rack.lbCursor[id] = value; break;
    case ROOM: w.hot.room.lbCursor[id] = value; break;
    case SITE: w.hot.site.lbCursor[id] = value; break;
    default: w.hot.g[G.globalCursor] = value;
  }
}

/**
 * roundRobin: the walk starts at the first candidate at or after the router's pointer, cyclically;
 * equal shares. After the split the pointer is the last child used + 1, so when the grain limits
 * the shard count, the children that get shares (and the remainder) rotate.
 */
export const roundRobin: RouteStrategy = {
  id: 'roundRobin',
  weighted: false,
  plan(w, kind, id, _r, cand, slot, weight, n) {
    const at = cursor(w, kind, id);
    let start = 0;
    while (start < n && slot[start]! < at) start += 1;
    if (start > 0 && start < n) {
      const c = Array.from(cand.subarray(0, n)), s = Array.from(slot.subarray(0, n));
      for (let i = 0; i < n; i += 1) { cand[i] = c[(start + i) % n]!; slot[i] = s[(start + i) % n]!; }
    }
    return equal(weight, n);
  },
  used(w, kind, id, lastSlot) { setCursor(w, kind, id, (lastSlot + 1) % FANOUT[kind]!); },
};
