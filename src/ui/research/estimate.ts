// Durations for the research screen: how long a project holds the hardware (D27: work over
// ResearchTreeView.takenOpsPerSec) and how long until the wallet can pay (money.ts ETAs).

/** "~12 s", "~4 min", "~3 h", "~2 d". */
export function durationText(s: number): string {
  if (s < 90) return `~${Math.max(1, Math.ceil(s))} s`;
  if (s < 5400) return `~${Math.round(s / 60)} min`;
  if (s < 172_800) return `~${Math.round(s / 3600)} h`;
  return `~${Math.round(s / 86_400)} d`;
}

/** Seconds `ops` of work holds the hardware at `rate` ops/s, or null without a rate. */
export function holdSeconds(ops: number, rate: number | null): number | null {
  return rate && rate > 0 && Number.isFinite(ops) ? ops / rate : null;
}
