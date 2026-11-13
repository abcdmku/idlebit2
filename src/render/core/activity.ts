// Hardware motion from published sim values only (v2 program §7).
// Every helper takes the real rate and the presentation sim time; nothing here
// reads a wall clock, and idle hardware returns `active: false`.

/** Above this rate a lane, LED or flow is drawn steady. Never alias it to a slower rhythm. */
export const EYE_RATE_HZ = 30;
/** A fan's visual top speed at 100% duty, the same on every level (v2 §7). */
export const FAN_TOP_RPS = 3;
/** The renderer may run presentation ahead of the last publish by at most this much (arch §3.2). */
export const MAX_EXTRAPOLATION_MS = 100;

export interface RateAnimation {
  active: boolean; saturated: boolean; ratePerSecond: number;
  /** Whole events completed, modulo `cells`. */
  step: number;
  /** Fraction of the current event, 0..1. Saturated motion reports 1. */
  phase: number;
}
export function createRateAnimation(): RateAnimation {
  return { active: false, saturated: false, ratePerSecond: 0, step: 0, phase: 0 };
}

/** A lane, clock LED or meter that steps once per real event (1 Hz = one step a second).
 * `active` false (idle, unpowered, paused) stops it on step 0.
 */
export function rateAnimation(ratePerSecond: number, timeMs: number, cells: number, active: boolean,
  out: RateAnimation): RateAnimation {
  const rate = Number.isFinite(ratePerSecond) ? Math.max(0, ratePerSecond) : 0;
  out.active = active && rate > 0 && cells >= 1; out.ratePerSecond = out.active ? rate : 0;
  out.saturated = out.active && rate >= EYE_RATE_HZ;
  if (!out.active) { out.step = 0; out.phase = 0; return out; }
  if (out.saturated) { out.step = 0; out.phase = 1; return out; }
  const events = rate * Math.max(0, timeMs) / 1000, whole = Math.floor(events);
  out.step = whole % Math.max(1, Math.floor(cells)); out.phase = events - whole;
  return out;
}

export interface FanAnimation {
  key: string | number | null; sampledAtMs: number;
  active: boolean; saturated: boolean; duty: number;
  revolutionsPerSecond: number; phase: number;
}
export function createFanAnimation(): FanAnimation {
  return { key: null, sampledAtMs: 0, active: false, saturated: false, duty: 0, revolutionsPerSecond: 0, phase: 0 };
}
/** Fan angle at real cooling duty × FAN_TOP_RPS. Keep one state per fan.
 * Phase integrates over sim time with the duty that held during each interval, so a duty
 * change never jumps the blades. A backwards time (new epoch, load) resets it.
 */
export function fanAnimation(key: string | number, timeMs: number, duty: number, out: FanAnimation, bladeCount = 1): FanAnimation {
  if (out.key !== key || timeMs < out.sampledAtMs) { out.phase = 0; out.revolutionsPerSecond = 0; out.sampledAtMs = timeMs; }
  const elapsed = (timeMs - out.sampledAtMs) / 1000;
  out.phase = (out.phase + elapsed * out.revolutionsPerSecond) % 1;
  out.key = key; out.sampledAtMs = timeMs;
  out.duty = Number.isFinite(duty) ? Math.max(0, Math.min(1, duty)) : 0;
  out.revolutionsPerSecond = out.duty * FAN_TOP_RPS;
  out.active = out.revolutionsPerSecond > 0;
  out.saturated = out.revolutionsPerSecond * Math.max(1, bladeCount) >= EYE_RATE_HZ;
  return out;
}
/** Blade angle in radians; 0 when stopped. */
export function fanAngle(fan: FanAnimation): number { return fan.active ? fan.phase * Math.PI * 2 : 0; }
