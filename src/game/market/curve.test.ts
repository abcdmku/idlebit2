import { baseRate, startIntensity, taskSize } from './curve';

describe('intensity curve (D12.1, D20, tasks.md §3)', () => {
  it('ramps T(I) = min(250, 7 × 2^(I / 5)) seconds per unit', () => {
    expect(1 / baseRate(0)).toBeCloseTo(7, 9);
    expect(1 / baseRate(5)).toBeCloseTo(14, 9);
    expect(1 / baseRate(20)).toBeCloseTo(112, 9);
    expect(1 / baseRate(30)).toBe(250);
  });

  it('opens each round at max(0, previous peak − 6)', () => {
    expect([startIntensity(0), startIntensity(5.9), startIntensity(20.5)]).toEqual([0, 0, 14.5]);
  });

  it('sizes tasks in whole units, at least 1; a minimum split at least members × grain (D25.6)', () => {
    expect(taskSize(0, 0.8, 1, 4096)).toBe(1);
    expect(taskSize(10, 1, 1, 4096)).toBe(362);
    expect(taskSize(0, 1, 4, 64)).toBe(256);
    expect(taskSize(10, 1, 4, 64)).toBe(362);
  });
});
