import { describe, expect, it } from 'vitest';
import { headRisk } from './risk';

describe('head risk (A12)', () => {
  it('warns only when this one failure crosses the 80% floor', () => {
    // Round 1: 41 ops delivered, 4 failed, grace 10: 92.7%. A 14-op failure gives 73.9%.
    expect(headRisk(41, 4, 10, 14)).toBe(true);
    expect(headRisk(41, 4, 10, 1)).toBe(false);
    // already under the floor: the round is ending anyway
    expect(headRisk(10, 30, 10, 1)).toBe(false);
    expect(headRisk(0, 0, 10, 2)).toBe(false);
    expect(headRisk(0, 0, 10, 3)).toBe(true);
  });
});
