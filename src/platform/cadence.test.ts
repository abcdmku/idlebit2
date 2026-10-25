import { describe, expect, it } from 'vitest';
import { accrue, chunkSpan, startCadence, take } from './cadence';

describe('integer-ms cadence', () => {
  it('passes whole 50 ms steps and carries the fractional remainder', () => {
    let cadence = startCadence(1000.25);
    cadence = accrue(cadence, 1016.9);
    expect(take(cadence).elapsedMs).toBe(0);
    cadence = accrue(cadence, 1073.4);
    const first = take(cadence);
    expect(first.elapsedMs).toBe(50);
    expect(first.cadence.owedMs).toBeCloseTo(23.15, 9);
    cadence = accrue(first.cadence, 1100.25);
    const second = take(cadence);
    expect(second.elapsedMs).toBe(50);
    expect(second.cadence.owedMs).toBeCloseTo(0, 9);
  });

  it('takes every whole millisecond on demand and ignores backward clocks', () => {
    let cadence = accrue(startCadence(0), 37.6);
    cadence = accrue(cadence, 20);
    expect(cadence.owedMs).toBeCloseTo(37.6, 9);
    const whole = take(cadence, true);
    expect(whole.elapsedMs).toBe(37);
    expect(whole.cadence.owedMs).toBeCloseTo(0.6, 9);
  });

  it('sums owed time exactly over many frames', () => {
    let cadence = startCadence(0), sent = 0;
    for (let frame = 1; frame <= 6000; frame++) {
      cadence = accrue(cadence, frame * (1000 / 60));
      const next = take(cadence); cadence = next.cadence; sent += next.elapsedMs;
    }
    expect(sent).toBe(100_000);
  });

  it('chunks catch-up spans into integer pieces', () => {
    expect(chunkSpan(150_001, 60_000)).toEqual([60_000, 60_000, 30_001]);
    expect(chunkSpan(0, 60_000)).toEqual([]);
    expect(() => chunkSpan(1.5, 60_000)).toThrow(RangeError);
  });
});
