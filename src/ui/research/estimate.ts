// D27: a started project goes to the front of the line and holds the free threads until done, while
// tasks wait. The Start key estimates that hold from ResearchTreeView.holdOpsPerSec.

/** "~12 s", "~4 min", "~3 h": how long `workOps` holds the hardware at `rate`. */
export function holdText(workOps: number, rate: number | null): string | null {
  if (!rate || rate <= 0 || !Number.isFinite(workOps)) return null;
  const s = workOps / rate;
  return s < 90 ? `~${Math.max(1, Math.ceil(s))} s` : s < 5400 ? `~${Math.round(s / 60)} min` : `~${Math.round(s / 3600)} h`;
}
