import { MAX_ACTIVE_FAMILIES, MAX_SHARDS } from '../core/constants';
import { baseWeight } from './curve';
import { FAMILIES } from './families';

/** Architecture §1.9 market constraints over the whole curve (I = 0 … 60). */
describe('market constraints', () => {
  it('keeps the authored family and distributed-member catalog bounds', () => {
    let maxActive = 0;
    for (let i = 0; i <= 1200; i += 1) {
      const I = i * 0.05;
      maxActive = Math.max(maxActive, FAMILIES.filter((f) => baseWeight(f, I) > 0).length);
    }
    expect(maxActive).toBe(MAX_ACTIVE_FAMILIES);
    expect(Math.max(...FAMILIES.map((f) => f.members))).toBeLessThanOrEqual(MAX_SHARDS);
  });
});
