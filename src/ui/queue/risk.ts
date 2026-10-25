// A12 under D28: warn on the head when one more failure would put the SLA under the floor. The SLA
// counts tasks, met / (met + failed), over a rolling window of the round's last `window` resolved
// tasks (dismissals excluded), and the floor applies only once `checking` (10 resolved).

/** The SLA floor: a round ends below it (spec §4.2, core/constants SLA_THRESHOLD). */
export const SLA_FLOOR = 0.8;
/** D28: the rolling window, until the snapshot publishes its own `window`. */
export const SLA_WINDOW = 50;

/**
 * True when the check is active, the window is at or above the floor now, and one more failure could
 * drop it below. With the window full, the new failure pushes the oldest outcome out; the warning
 * assumes that was a success, so it never comes too late.
 */
export function headRisk(met: number, failed: number, checking: boolean, window = SLA_WINDOW): boolean {
  const total = met + failed;
  if (!checking || total <= 0 || met / total < SLA_FLOOR) return false;
  const m = total >= window ? met - 1 : met, f = failed + 1;
  return m / (m + f) < SLA_FLOOR;
}
