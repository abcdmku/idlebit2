// @vitest-environment node
import { serializeSave } from '../save/serialize';
import { FLEETS } from '../testkit/fleets';
import { gpuLoadedState } from '../testkit/gpuLoaded';
import { advanceGame, advanceGameOwned, copyGameState } from './advance';

const fixtures = { boot: FLEETS.boot, rack: FLEETS.rackFull, gpu: gpuLoadedState };

describe('advanceGameOwned (D9)', () => {
  it.each(Object.keys(fixtures) as (keyof typeof fixtures)[])('matches pure states and reports at every partition (%s)', (name) => {
    const start = fixtures[name](), before = serializeSave(start);
    let pure = start, owned = copyGameState(start);
    for (const ms of [30, 70, 200, 1_003, 8_697, 20_050]) {
      const expected = advanceGame(pure, ms), actual = advanceGameOwned(owned, ms);
      expect(actual).toEqual(expected);
      pure = expected.state;
      owned = actual.state;
    }
    expect(serializeSave(start)).toBe(before);
  });

  it('updates owned buffers in place and rejects reuse of a consumed state in DEV', () => {
    const start = FLEETS.boot(), hot = start.hot;
    const next = advanceGameOwned(start, 1_000).state;
    expect(next.hot).toBe(hot);
    expect(() => start.clock).toThrow(/consumed/);
    expect(() => advanceGameOwned(start, 100)).toThrow(/consumed/);
    expect(() => advanceGame(start, 100)).toThrow(/consumed/);
  });
});
