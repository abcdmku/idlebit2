/** Work-weighted SLA (program D10.6, spec §4.2): (delivered + G) / (delivered + failed + G), all in ops. */
export const slaValue = (delivered: number, failed: number, grace: number): number => {
  const den = delivered + failed + grace;
  return den > 0 ? (delivered + grace) / den : 1;
};

/** The HUD's SLA percent, floor(SLA × 1000) / 10, so just below 80% never reads 80.0 (spec §4.2). */
export const slaPercent = (delivered: number, failed: number, grace: number): number =>
  Math.floor(slaValue(delivered, failed, grace) * 1000) / 10;
