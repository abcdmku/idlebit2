import { secondsToTicks } from '../core/constants';

/* Phys starting values (spec §9, §10, Appendix B). Durations are whole ticks. */

/** Supply loss multiplier (spec §9.2, D4.3): ×1 up to 90% usage, ×1.5 above. No legal build exceeds 100%. */
export const SUPPLY_BAND = 0.9;
export const SUPPLY_MULT_HIGH = 1.5;

/** C-states (spec §9.3): idle factor, ticks idle before it applies, wake latency in ticks. */
export const CSTATES = [
  { depth: 1, factor: 0.72, afterTicks: 0, wakeTicks: 0 },
] as const;
export const PACKAGE_IDLE_FACTOR = 0.2;
export const S3_AFTER_TICKS = secondsToTicks(10);
export const S3_FACTOR = 0.03;
export const S3_WAKE_TICKS = secondsToTicks(2);

export const DVFS_CLOCK = 0.5;
export const DVFS_LOAD = 0.3;
export const TURBO_CLOCK = 1.25;
export const TURBO_LOAD = 1.8;
export const TURBO_MAX_F = 80;
export const THROTTLE_AT_F = 95;
export const THROTTLE_UNTIL_F = 90;
export const THROTTLE_CLOCK = 0.5;
export const THROTTLE_LOAD = 0.5;

/* Heat (spec §10). */
export const COOLER_DELTA_F = 20;
export const LIFT_PER_F = 0.03;
export const LIFT_BELOW_F = 70;
export const ECONOMIZER_MARGIN_F = 5;
export const ECONOMIZER_WATTS = 0.1;
export const EFF_FLAT_LOW_F = 70;
export const EFF_FLAT_HIGH_F = 80;
export const EFF_GAIN_PER_F = 0.005;
export const EFF_LOSS_PER_F = 0.025;
export const EFF_MAX = 1.1;
/** Rate floor only: keeps task clocks moving. The draw (thermalDuty) has no floor. */
export const EFF_MIN = 0.01;
