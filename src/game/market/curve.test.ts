import { baseRate, memberSize, startIntensity } from './curve';

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

  it('sizes members in whole units, at least 1', () => {
    expect(memberSize(0, 0.8, 1)).toBe(1);
    expect(memberSize(10, 1, 1)).toBe(Math.round(2 ** 8.5));
    expect(memberSize(10, 1, 4)).toBe(Math.round(2 ** 8.5 / 4));
  });
});
