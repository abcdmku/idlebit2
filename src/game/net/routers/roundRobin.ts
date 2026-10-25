import { G } from '../../core/buffers';
import type { World } from '../../core/world';
import { FANOUT, RACK, ROOM, SITE } from '../scope';
import type { RouteStrategy } from './types';

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

/** roundRobin: the first candidate at or after the router's pointer, cyclically; pointer = pick + 1. */
export const roundRobin: RouteStrategy = {
  id: 'roundRobin',
  choose(w, kind, id, _r, _cand, slot, n) {
    const at = cursor(w, kind, id);
    let pick = 0;
    for (let i = 0; i < n; i += 1) if (slot[i]! >= at) { pick = i; break; }
    setCursor(w, kind, id, (slot[pick]! + 1) % FANOUT[kind]!);
    return pick;
  },
};
