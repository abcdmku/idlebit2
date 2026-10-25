// How long a project holds the hardware (D27: work over ResearchTreeView.takenOpsPerSec, the rate
// once systems take it). Durations print through the shell's one ETA formatter, etaSpan.

/** Seconds `ops` of work holds the hardware at `rate` ops/s, or null without a rate. */
export function holdSeconds(ops: number, rate: number | null): number | null {
  return rate && rate > 0 && Number.isFinite(ops) ? ops / rate : null;
}
