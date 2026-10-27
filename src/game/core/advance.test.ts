// @vitest-environment node
import { serializeSave } from '../save/serialize';
import { FLEETS } from '../testkit/fleets';
import { advanceGame } from './advance';
import { G } from './buffers';
import { createInitialState } from './state';

describe('advanceGame invariants', () => {
  it.each([42, 7])('advance(200) equals two advance(100) calls, RNG included (seed %s)', (seed) => {
    const start = createInitialState(seed);
    const whole = advanceGame(start, 200).state;
    expect(advanceGame(advanceGame(start, 100).state, 100).state).toEqual(whole);
    expect(whole.hot.g[G.rngDraws]).toBeGreaterThan(start.hot.g[G.rngDraws]!);
  });

  it.each(['boot', 'rackFull'] as const)('partitions preserve the full state through work and round endings (%s)', (name) => {
    const start = FLEETS[name]();
    const whole = advanceGame(start, 130_050).state;
    const parts = [1, 99, 101, 5_033, 17_019, 30_001, 77_796];
    const chained = parts.reduce((state, ms) => advanceGame(state, ms).state, start);
    expect(chained).toEqual(whole);
    expect([...chained.hot.rng]).toEqual([...whole.hot.rng]);
    expect(chained.hot.g[G.rngDraws]).toBe(whole.hot.g[G.rngDraws]);
  });

  it('leaves the input unchanged and carries sub-tick time', () => {
    const start = createInitialState(42), before = serializeSave(start);
    const next = advanceGame(start, 250).state;
    expect(serializeSave(start)).toBe(before);
    expect(next.clock).toEqual({ tick: 2, carryMs: 50 });
    expect(advanceGame(next, 50).state).toEqual(advanceGame(start, 300).state);
  });
});
