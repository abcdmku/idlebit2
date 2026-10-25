import { expect, it } from 'vitest';
import { createEffectPool, EFFECT_LIMITS } from './fx';
import { rect } from './geom';

it('spawns one coin per payout sequence and none for replays', () => {
  const pool = createEffectPool(3); pool.resize(rect(0, 0, 390, 780));
  expect(pool.coin(5, 100, 100)).toBe(true); expect(pool.coin(5, 100, 100)).toBe(false); expect(pool.coin(4, 100, 100)).toBe(false);
  expect(pool.activeCount('coin')).toBe(1);
  pool.update(1); expect(pool.activeCount('coin')).toBe(0);
  for (let seq = 10; seq < 30; seq++) pool.coin(seq, 50, 50);
  expect(pool.activeCount('coin')).toBe(EFFECT_LIMITS.coin);
  pool.clear(); expect(pool.coin(1, 50, 50)).toBe(true);
});
it('keeps smoke only while its fault is reported each frame', () => {
  const pool = createEffectPool(); pool.resize(rect(0, 0, 100, 100));
  pool.smoke(7, 10, 10); pool.update(0.016); expect(pool.activeCount('smoke')).toBe(1);
  for (let i = 0; i < 100; i++) { pool.smoke(7, 10, 10); pool.update(0.05); }
  expect(pool.activeCount('smoke')).toBe(1);
  pool.update(0.016); expect(pool.activeCount('smoke')).toBe(0);
});
