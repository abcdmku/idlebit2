import { expect, it } from 'vitest';
import { createEffectPool, EFFECT_LIMITS } from './fx';
import { rect } from './geom';

it('caps smoke at its limit', () => {
  const pool = createEffectPool(3); pool.resize(rect(0, 0, 390, 780));
  for (let i = 0; i < 40; i++) pool.smoke(i, 50, 50);
  expect(pool.activeCount('smoke')).toBe(EFFECT_LIMITS.smoke);
  pool.clear(); expect(pool.activeCount()).toBe(0);
});
it('keeps smoke only while its fault is reported each frame', () => {
  const pool = createEffectPool(); pool.resize(rect(0, 0, 100, 100));
  pool.smoke(7, 10, 10); pool.update(0.016); expect(pool.activeCount('smoke')).toBe(1);
  for (let i = 0; i < 100; i++) { pool.smoke(7, 10, 10); pool.update(0.05); }
  expect(pool.activeCount('smoke')).toBe(1);
  pool.update(0.016); expect(pool.activeCount('smoke')).toBe(0);
});
