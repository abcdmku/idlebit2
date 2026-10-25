import { serializeSave } from '../save/serialize';
import { FLEETS } from '../testkit/fleets';
import { gpuLoadedState } from '../testkit/gpuLoaded';
import type { GameState } from '../types/state';
import { advanceGame, advanceGameOwned, copyGameState } from './advance';
import { G } from './buffers';
import { nextInt, seedRng } from './rng';

// Top-hardware fixtures do 600 warm-up ticks of real work under D10 (the fleet pulls continuously).
vi.setConfig({ testTimeout: 60_000 });

/** Deterministic partitions of `total` ms into pieces of 1 ms .. 10 s (test-local RNG host). */
function partition(total: number, seed: number): number[] {
  const host = { rng: new Uint32Array(4), g: new Float64Array(32) };
  seedRng(host.rng, seed);
  const pieces: number[] = [];
  for (let left = total; left > 0;) {
    const piece = Math.min(left, nextInt(host, 1, 10_001));
    pieces.push(piece);
    left -= piece;
  }
  return pieces;
}

const FIXTURES: Record<string, () => GameState> = {
  boot: () => FLEETS.boot(),
  rackFull: () => FLEETS.rackFull(),
  gpu: () => gpuLoadedState(),
};
const TEN_MINUTES = 600_000;

describe('advanceGameOwned (decisions D9)', () => {
  it.each(Object.keys(FIXTURES))('matches the pure path over random partitions (%s), RNG words and events included', (name) => {
    const whole = advanceGame(FIXTURES[name]!(), TEN_MINUTES).state;
    for (const seed of [1, 2]) {
      const pieces = partition(TEN_MINUTES, seed);
      let pure = FIXTURES[name]!(), owned = FIXTURES[name]!();
      for (const ms of pieces) {
        pure = advanceGame(pure, ms).state;
        owned = advanceGameOwned(owned, ms).state;
      }
      expect(owned).toEqual(pure);
      expect(owned).toEqual(whole);
      expect([...owned.hot.rng]).toEqual([...whole.hot.rng]);
      expect(owned.hot.g[G.rngDraws]).toBe(whole.hot.g[G.rngDraws]);
      expect(owned.events).toEqual(whole.events);
    }
  });

  it('updates the input hot buffers in place instead of copying them', () => {
    const start = FLEETS.rackFull(), hot = start.hot;
    const next = advanceGameOwned(start, 1_000).state;
    expect(next.hot).toBe(hot);
    expect(next.clock.tick).toBe(10);
  });

  it('throws in DEV when a consumed state is read or advanced again', () => {
    for (const ms of [1_000, 30]) {
      const start = FLEETS.boot();
      advanceGameOwned(start, ms);
      expect(() => start.clock).toThrow(/consumed/);
      expect(() => advanceGameOwned(start, 100)).toThrow(/consumed/);
      expect(() => advanceGame(start, 100)).toThrow(/consumed/);
    }
  });

  it('leaves the original untouched when advancing a copy', () => {
    const start = advanceGame(FLEETS.rackFull(), 2_000).state, saved = serializeSave(start);
    const copy = copyGameState(start);
    advanceGameOwned(copy, 5_000);
    expect(serializeSave(start)).toBe(saved);
    expect(advanceGameOwned(copyGameState(start), 5_000).state).toEqual(advanceGame(start, 5_000).state);
  });
});
