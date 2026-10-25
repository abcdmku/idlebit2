import { describe, expect, it, vi } from 'vitest';
import { advanceGame } from '../core/advance';
import { commitWorld, openWorld } from '../core/world';
import type { GameState } from '../types/state';
import { F } from './testFamilies';
import { execState, feed } from './testWorld';

vi.mock('../market/families', async (orig) => ({ ...(await orig<object>()), FAMILIES: (await import('./testFamilies')).TEST_FAMILIES }));

/** A lone system with a scheduler and a mixed feed, run through the real tick loop. */
function seeded(strategy: number): GameState {
  const state = execState({}, { threads: 3, K: 2, Q: 3, strategy, threadRate: 1.7, ramBw: 1.3, gpuOps: 0.9, ioRate: 1.1, memCap: 12, vram: 16 });
  const w = openWorld(state);
  const fams = [F.cpu, F.mix, F.cpu2, F.ram, F.gpu, F.io, F.cpu4];
  fams.forEach((f, i) => feed(w, f, 1 + (i % 3), 1 + (i % 4)));
  return commitWorld(state, w, 0);
}

function partition(seed: number, totalMs: number): number[] {
  let x = seed;
  const parts: number[] = [];
  let left = totalMs;
  while (left > 0) {
    x = (Math.imul(x, 1103515245) + 12345) >>> 0;
    const piece = Math.min(left, 1 + (x % 2500));
    parts.push(piece);
    left -= piece;
  }
  return parts;
}

describe('delta invariance (AGENTS.md, architecture §7.4)', () => {
  for (const strategy of [0, 1, 2, 3, 4]) {
    it(`strategy ${strategy}: random partitions of 30 s equal one call`, () => {
      const start = seeded(strategy);
      const whole = advanceGame(start, 30_000).state;
      for (const seed of [1, 2, 3]) {
        let s = start;
        for (const ms of partition(seed * 7 + strategy, 30_000)) s = advanceGame(s, ms).state;
        expect(s.hot).toEqual(whole.hot);
        expect(s.clock).toEqual(whole.clock);
        expect(s.wallet).toEqual(whole.wallet);
      }
      expect(whole.round.phase === 'running' ? whole.hot.g[6]! : whole.round.reports.at(-1)!.met).toBeGreaterThan(0);
    });
  }
});
