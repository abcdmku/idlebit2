import { describe, expect, it } from 'vitest';
import { countdownWidth, createFanAnimation, createRateAnimation, EYE_RATE_HZ, FAN_TOP_RPS, fanAnimation,
  heatFraction, presentationMs, rateAnimation, secondsLeft, timerFraction } from './activity';

describe('rate animation', () => {
  it('steps a 1 Hz lane once per second of sim time', () => {
    const out = createRateAnimation();
    for (const [time, step] of [[0, 0], [999, 0], [1000, 1], [1999, 1], [2000, 2], [8000, 0]] as const) {
      rateAnimation(1, time, 8, true, out);
      expect(out.step).toBe(step);
    }
    expect(out.saturated).toBe(false);
  });
  it('an 8 bit read at 1 bit/s takes eight one-second steps; 2 bit/s takes four', () => {
    const out = createRateAnimation(), slow: number[] = [], fast: number[] = [];
    for (let s = 0; s < 8; s++) { slow.push(rateAnimation(1, s * 1000, 8, true, out).step); fast.push(rateAnimation(2, s * 500, 8, true, out).step); }
    expect(slow).toEqual([0, 1, 2, 3, 4, 5, 6, 7]); expect(fast).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });
  it('idle hardware is still and fast hardware is steady, never a slower rhythm', () => {
    const out = createRateAnimation();
    rateAnimation(5, 1234, 8, false, out); expect(out).toMatchObject({ active: false, step: 0, phase: 0 });
    rateAnimation(0, 1234, 8, true, out); expect(out.active).toBe(false);
    for (const rate of [EYE_RATE_HZ, 1e3, 1e9]) {
      rateAnimation(rate, 1234, 8, true, out);
      expect(out).toMatchObject({ active: true, saturated: true, step: 0, phase: 1 });
    }
  });
});
describe('fan animation', () => {
  it('spins at duty × 3 rev/s and integrates only with sim time', () => {
    const fan = createFanAnimation();
    fanAnimation('a', 0, 0.5, fan); expect(fan.revolutionsPerSecond).toBe(FAN_TOP_RPS * 0.5);
    fanAnimation('a', 500, 0.5, fan); expect(fan.phase).toBeCloseTo(0.75);
    for (let i = 0; i < 50; i++) fanAnimation('a', 500, 0.5, fan);
    expect(fan.phase).toBeCloseTo(0.75);
    fanAnimation('a', 600, 1, fan); expect(fan.phase).toBeCloseTo(0.9);
    fanAnimation('a', 700, 0, fan); expect(fan.phase).toBeCloseTo(0.2); expect(fan.active).toBe(false);
    const stopped = fan.phase; fanAnimation('a', 9000, 0, fan); expect(fan.phase).toBe(stopped);
  });
  it('keeps 30%, 60% and 100% duty visibly different and resets on a new fan or earlier time', () => {
    const fan = createFanAnimation(), rps = [0.3, 0.6, 1].map(d => fanAnimation('b', 0, d, fan).revolutionsPerSecond);
    expect(rps).toEqual([0.3 * FAN_TOP_RPS, 0.6 * FAN_TOP_RPS, FAN_TOP_RPS]);
    expect(fan.saturated).toBe(false);
    fanAnimation('b', 1000, 1, fan); fanAnimation('c', 1100, 1, fan); expect(fan.phase).toBe(0);
    fanAnimation('c', 1500, 1, fan); fanAnimation('c', 100, 1, fan); expect(fan.phase).toBe(0);
  });
});
describe('timers and deadlines', () => {
  it('caps presentation extrapolation at 100 ms', () => {
    expect(presentationMs(5000, 40)).toBe(5040); expect(presentationMs(5000, 900)).toBe(5100); expect(presentationMs(5000, -5)).toBe(5000);
  });
  it('drains a 10 s pickup bar of 14 px to zero exactly at the deadline', () => {
    expect(countdownWidth(secondsLeft(10_000, 0), 10, 14)).toBe(14);
    expect(countdownWidth(secondsLeft(10_000, 9_990), 10, 14)).toBe(1);
    expect(countdownWidth(secondsLeft(10_000, 10_000), 10, 14)).toBe(0);
    expect(countdownWidth(secondsLeft(10_000, 12_000), 10, 14)).toBe(0);
  });
  it('maps timers and temperature into 0..1', () => {
    expect(timerFraction(2500, 10_000)).toBe(0.25); expect(timerFraction(0, 10_000)).toBe(0); expect(timerFraction(5, 0)).toBe(0);
    expect(heatFraction(70, 80, 120)).toBe(0); expect(heatFraction(100, 80, 120)).toBe(0.5); expect(heatFraction(200, 80, 120)).toBe(1);
  });
});
