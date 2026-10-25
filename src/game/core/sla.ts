import { G } from './buffers';
import { SLA_MIN_RESOLVED, SLA_WINDOW } from './constants';

/**
 * D28: SLA is a plain count ratio, completed over completed plus failed (spec §4.2), over the last
 * SLA_WINDOW (50) resolved tasks of the round. Dismissed tasks are outside it, a split task counts
 * once, and research is not a task. The 80% check waits for 10 resolved tasks. 1 before anything resolves.
 */
export const slaValue = (met: number, failed: number): number => {
  const den = met + failed;
  return den > 0 ? met / den : 1;
};

/** The 80% check runs only once this many tasks have resolved this round (met + failed ≥ 10); "warming up" before. */
export const slaChecking = (resolved: number): boolean => resolved >= SLA_MIN_RESOLVED;

/** The HUD's SLA percent, floor(SLA × 1000) / 10, so just below 80% never reads 80.0 (spec §4.2). */
export const slaPercent = (met: number, failed: number): number => Math.floor(slaValue(met, failed) * 1000) / 10;

const SPAN = 2 ** SLA_WINDOW, TOP = 2 ** (SLA_WINDOW - 1);

/**
 * Pushes one tick's outcomes into the window: its met tasks, then its failed tasks (a fixed order, so the
 * window is the same however the advance is cut). Only the last SLA_WINDOW of a tick can remain.
 */
export function pushOutcomes(g: Float64Array, met: number, failed: number): void {
  const total = met + failed;
  if (total <= 0) return;
  const skip = Math.max(0, total - SLA_WINDOW);
  for (let i = skip; i < total; i += 1) {
    const bit = i < met ? 1 : 0;
    let ring = g[G.slaRing]!, len = g[G.slaLen]!, inMet = g[G.slaMet]!;
    if (len === SLA_WINDOW) { if (ring >= TOP) inMet -= 1; ring -= ring >= TOP ? TOP : 0; } else len += 1;
    ring = (ring * 2) % SPAN + bit;
    g[G.slaRing] = ring; g[G.slaLen] = len; g[G.slaMet] = inMet + bit;
  }
}

/** The window's met and failed counts. */
export function slaWindow(g: Float64Array): { met: number; failed: number } {
  const met = g[G.slaMet]!;
  return { met, failed: g[G.slaLen]! - met };
}

export function resetSlaWindow(g: Float64Array): void {
  g[G.slaRing] = 0; g[G.slaLen] = 0; g[G.slaMet] = 0;
}
