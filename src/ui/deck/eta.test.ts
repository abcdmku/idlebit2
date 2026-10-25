import { describe, expect, it } from 'vitest';
import { etaText } from './eta';

describe('saving-up ETA', () => {
  it('reads whole minutes, then whole hours, from the Credits still to earn over net income', () => {
    expect(etaText(2100, 1)).toBe('~35 min');
    expect(etaText(20, 1)).toBe('~1 min');
    expect(etaText(7200, 1)).toBe('~2 h');
  });
  it('has none while income is 0 (the first 10 s) or negative, or nothing is owed', () => {
    expect([etaText(500, 0), etaText(500, -3), etaText(0, 5)]).toEqual([null, null, null]);
  });
});
