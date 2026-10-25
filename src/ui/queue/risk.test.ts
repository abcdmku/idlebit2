import { describe, expect, it } from 'vitest';
import { headRisk } from './risk';

describe('head risk, counted over the window (A12, D28)', () => {
  it('warns only when one more failure crosses 80%, and only once the check is active', () => {
    // 12 met of 15 is 80%: one more failure makes 12 of 16, 75%
    expect(headRisk(12, 3, true)).toBe(true);
    expect(headRisk(12, 3, false)).toBe(false);
    // 41 of 44 is 93%: one failure gives 41 of 45, 91%
    expect(headRisk(41, 3, true)).toBe(false);
    // already under the floor: the round is ending anyway
    expect(headRisk(7, 3, true)).toBe(false);
  });
  it('a full window loses its oldest outcome as the new failure comes in', () => {
    // 40 of 50 is 80%; the new failure pushes out a success: 39 of 50, 78%
    expect(headRisk(40, 10, true, 50)).toBe(true);
    expect(headRisk(46, 4, true, 50)).toBe(false);
  });
});
