import { ACCEL_CLOCKS, DT_S } from '../core/constants';
import type { World } from '../core/world';
import { CPU, GPU, IO, NRES, RAM } from './shape';
import { resetAccelerators } from './accelerators';

/**
 * Resource work clocks W(x) = wAnchor + rate * (x - eAnchor).
 * CPU uses rack efficiency E; RAM and IO use plain time. GPU stages use the separate
 * domain clocks in accelerators.ts on the same E axis. Span retains GPU's axis bounds.
 * CPU/RAM/IO sharing stays fixed for the tick. Completion uses axisEnd >= due.
 */

/** e(T) never exceeds this (spec §10.4), so E grows by at most EFF_MAX × DT_S per tick. */
export const EFF_MAX = 1.1;
export const isEAxis = (res: number): boolean => res === CPU || res === GPU;

/** Axis bounds of the tick being run for one system: start x0 and end x1 per resource. */
export interface Span { readonly x0: Float64Array; readonly x1: Float64Array }
export const newSpan = (): Span => ({ x0: new Float64Array(NRES), x1: new Float64Array(NRES) });

export function fillSpan(w: World, rack: number, span: Span): void {
  const e0 = w.hot.rack.effClock[rack]!;
  const e1 = e0 + w.hot.rack.eff[rack]! * DT_S;
  const t0 = w.tick * DT_S;
  const t1 = (w.tick + 1) * DT_S;
  span.x0[CPU] = e0; span.x1[CPU] = e1;
  span.x0[GPU] = e0; span.x1[GPU] = e1;
  span.x0[RAM] = t0; span.x1[RAM] = t1;
  span.x0[IO] = t0; span.x1[IO] = t1;
}

/** Axis value at fraction τ ∈ [0, 1] of the tick. */
export const axisAt = (span: Span, res: number, tau: number): number => span.x0[res]! + tau * (span.x1[res]! - span.x0[res]!);

export function clockAt(w: World, s: number, res: number, x: number): number {
  const i = s * NRES + res;
  const h = w.hot.sys;
  return h.wAnchor[i]! + h.rate[i]! * (x - h.eAnchor[i]!);
}

/** Recomputes `due` from the resource's head record. */
export function refreshDue(w: World, s: number, res: number): void {
  const i = s * NRES + res;
  const h = w.hot.sys;
  const head = h.head[i]!;
  const rate = h.rate[i]!;
  if (head < 0 || !(rate > 0)) { h.due[i] = Infinity; return; }
  const f = w.hot.rec.finish[head]!;
  h.due[i] = f === Infinity ? Infinity : h.eAnchor[i]! + (f - h.wAnchor[i]!) / rate;
}

/** Sets a resource's rate from axis value x on, keeping W continuous. */
export function setRate(w: World, s: number, res: number, x: number, rate: number): void {
  const i = s * NRES + res;
  const h = w.hot.sys;
  if (h.rate[i] === rate) return;
  h.wAnchor[i] = h.wAnchor[i]! + h.rate[i]! * (x - h.eAnchor[i]!);
  h.eAnchor[i] = x;
  h.rate[i] = rate;
  refreshDue(w, s, res);
}

/** Clears every clock of a system (kill, round end). */
export function resetClocks(w: World, s: number): void {
  const h = w.hot.sys;
  for (let r = 0; r < NRES; r += 1) {
    const i = s * NRES + r;
    h.wAnchor[i] = 0; h.eAnchor[i] = 0; h.rate[i] = 0; h.due[i] = Infinity; h.head[i] = -1; h.active[i] = 0;
  }
  resetAccelerators(w, s);
}

/**
 * The earliest tick at which any of the system's resources could complete a record, given the
 * span of the tick just run. Conservative (never late): E grows by at most EFF_MAX × DT_S per tick.
 */
export function nextDueTick(w: World, s: number, span: Span): number {
  const h = w.hot.sys;
  let best = Infinity;
  for (let r = 0; r < NRES; r += 1) {
    const due = h.due[s * NRES + r]!;
    if (due === Infinity) continue;
    const k = isEAxis(r)
      ? w.tick + 1 + Math.max(0, Math.floor((due - span.x1[r]!) / (EFF_MAX * DT_S)) - 1)
      : Math.max(w.tick + 1, Math.floor(due / DT_S) - 1);
    if (k < best) best = k;
  }
  for (let a = 0; a < ACCEL_CLOCKS; a += 1) {
    const due = h.accelDue[s * ACCEL_CLOCKS + a]!;
    if (due === Infinity) continue;
    const k = w.tick + 1 + Math.max(0, Math.floor((due - span.x1[GPU]!) / (EFF_MAX * DT_S)) - 1);
    if (k < best) best = k;
  }
  return best;
}
