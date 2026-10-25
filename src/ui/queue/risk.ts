// A12: warn on the head when its failure alone would put the round's SLA under the floor.
// The SLA is the sim's work-weighted formula (spec §4.2, core/sla.ts); the UI only reads it ahead.

/** The SLA floor: a round ends below it (spec §4.2, core/constants SLA_THRESHOLD). */
export const SLA_FLOOR = 0.8;

const sla = (delivered: number, failed: number, grace: number) => {
  const den = delivered + failed + grace;
  return den > 0 ? (delivered + grace) / den : 1;
};

/** True when the round is above the floor now and failing `work` more ops would drop it below. */
export function headRisk(delivered: number, failed: number, grace: number, work: number): boolean {
  return sla(delivered, failed, grace) >= SLA_FLOOR && sla(delivered, failed + work, grace) < SLA_FLOOR;
}
