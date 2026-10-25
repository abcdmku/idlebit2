// D27: a started project goes to the front of the line and holds a system's free threads until done,
// while tasks wait. The Start key estimates that hold, so the player can judge the SLA risk.
import type { RenderSnapshot } from '../../game';
import { useGameSelector } from '../storeHooks';

/**
 * The compute a project would get if taken now, ops/s, and where: on the CPU level, the CPU's cores
 * (each core's own rate). Elsewhere null until the sim publishes a fleet rate.
 */
export const holdRateOf = (s: RenderSnapshot): number | null =>
  s.focus.level === 'chip' ? s.focus.cores.reduce((sum, c) => sum + c.rate, 0) || null : null;

export function useHoldRate(): number | null {
  return useGameSelector(holdRateOf, Object.is, 500);
}

/** "~12 s", "~4 min", "~3 h": how long `workOps` holds the hardware at `rate`. */
export function holdText(workOps: number, rate: number | null): string | null {
  if (!rate || rate <= 0 || !Number.isFinite(workOps)) return null;
  const s = workOps / rate;
  return s < 90 ? `~${Math.max(1, Math.ceil(s))} s` : s < 5400 ? `~${Math.round(s / 60)} min` : `~${Math.round(s / 3600)} h`;
}
