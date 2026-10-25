import { DT_S } from '../core/constants';
import type { World } from '../core/world';

/** A save/action never interrupts a tick. Only the current draft needs its post-run boundary. */
interface RunBoundary { tick: number; end: Float64Array }
const boundaries = new WeakMap<World, RunBoundary>();

export function publishRunBoundary(w: World): void {
  let boundary = boundaries.get(w);
  if (!boundary || boundary.end.length < w.hot.rack.len) {
    boundary = { tick: w.tick, end: new Float64Array(w.hot.rack.len) };
    boundaries.set(w, boundary);
  }
  boundary.tick = w.tick;
  for (let rack = 0; rack < w.hot.rack.len; rack += 1) {
    boundary.end[rack] = w.hot.rack.effClock[rack]! + w.hot.rack.eff[rack]! * DT_S;
  }
}

/** Before run/actions: the current rack boundary. After run: the completed execution boundary. */
export function executionBoundary(w: World, s: number): number {
  const rack = w.compiled.sys.rack[s]!, boundary = boundaries.get(w);
  return boundary?.tick === w.tick ? boundary.end[rack]! : w.hot.rack.effClock[rack]!;
}
