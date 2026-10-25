/** Foreground advance step. The sim ticks at 100 ms; 50 ms keeps the carry visible at 20 Hz. */
export const CADENCE_MS = 50;

/** Monotonic wall time owed to the sim. `owedMs` keeps the fractional part of performance.now(). */
export interface Cadence {
  readonly lastMono: number;
  readonly owedMs: number;
}

export function startCadence(now: number): Cadence {
  return { lastMono: now, owedMs: 0 };
}

/** Adds the time since the last reading. A backward clock reading never counts twice. */
export function accrue(cadence: Cadence, now: number): Cadence {
  if (!Number.isFinite(now) || now <= cadence.lastMono) return cadence;
  return { lastMono: now, owedMs: cadence.owedMs + (now - cadence.lastMono) };
}

/**
 * Takes the integer milliseconds to pass to advanceGame and keeps the rest owed.
 * `whole` takes every whole millisecond (before an action or a save); otherwise only
 * whole cadence steps are taken.
 */
export function take(cadence: Cadence, whole = false): { readonly cadence: Cadence; readonly elapsedMs: number } {
  const step = whole ? 1 : CADENCE_MS;
  const elapsedMs = Math.floor(cadence.owedMs / step) * step;
  if (elapsedMs <= 0) return { cadence, elapsedMs: 0 };
  return { cadence: { lastMono: cadence.lastMono, owedMs: cadence.owedMs - elapsedMs }, elapsedMs };
}

/** Forgets owed time, for example after the tab was hidden and the gap went to catch-up. */
export function rebase(now: number): Cadence {
  return startCadence(now);
}

/** Splits a catch-up span into integer chunks of at most `chunkMs`. */
export function chunkSpan(totalMs: number, chunkMs: number): number[] {
  if (!Number.isSafeInteger(totalMs) || totalMs < 0) throw new RangeError('Invalid catch-up span');
  if (!Number.isSafeInteger(chunkMs) || chunkMs <= 0) throw new RangeError('Invalid catch-up chunk');
  const chunks: number[] = [];
  for (let left = totalMs; left > 0; left -= chunkMs) chunks.push(Math.min(chunkMs, left));
  return chunks;
}
