import { createInitialState } from './state';
import { advanceGame } from './advance';
import { G } from './buffers';
import { nextInt, seedRng } from './rng';
import type { GameState } from '../types/state';
import { serializeSave } from '../save/serialize';
import { FLEETS } from '../testkit/fleets';

// rackFull does real work every tick under D10 (the fleet pulls continuously).
vi.setConfig({ testTimeout: 60_000 });

/** Deterministic partitions of `total` ms into pieces of 1 ms .. 10 s (test-local RNG host). */
function partition(total: number, seed: number): number[] {
  const host = { rng: new Uint32Array(4), g: new Float64Array(32) };
  seedRng(host.rng, seed);
  const pieces: number[] = [];
  let left = total;
  while (left > 0) {
    const piece = Math.min(left, nextInt(host, 1, 10_001));
    pieces.push(piece);
    left -= piece;
  }
  return pieces;
}

const chain = (state: GameState, pieces: readonly number[], skipQuiescent = true) =>
  pieces.reduce((s, ms) => advanceGame(s, ms, { skipQuiescent }).state, state);

const between = (autoReturnTick: number | null = null): GameState => {
  const s = createInitialState(42);
  return { ...s, round: { ...s.round, phase: 'between', endTick: 0, autoReturnTick } };
};

const FIXTURES: Record<string, () => GameState> = {
  boot: () => createInitialState(42),
  empty: () => between(),
  autoReturn: () => between(2_500),
  rackFull: () => FLEETS.rackFull(),
};
const TEN_MINUTES = 600_000;

describe('advanceGame', () => {
  for (const name of Object.keys(FIXTURES)) {
    it(`is delta-invariant over random partitions (${name}), RNG words included`, () => {
      const whole = advanceGame(FIXTURES[name]!(), TEN_MINUTES).state;
      for (const seed of [1, 2, 3]) {
        const pieces = partition(TEN_MINUTES, seed);
        const chained = chain(FIXTURES[name]!(), pieces);
        expect(chained).toEqual(whole);
        expect([...chained.hot.rng]).toEqual([...whole.hot.rng]);
        expect(chained.hot.g[G.rngDraws]).toBe(whole.hot.g[G.rngDraws]);
        expect(chained.events).toEqual(whole.events);
      }
      expect(whole.clock).toEqual({ tick: 6000, carryMs: 0 });
    // rackFull does real work every tick under D10; allow parallel-suite contention for this correctness stress case.
    }, name === 'rackFull' ? 60_000 : 5_000);
  }

  it.each(Object.keys(FIXTURES))('quiescent skip changes nothing (%s)', (name) => {
    const pieces = partition(TEN_MINUTES, 9);
    expect(chain(FIXTURES[name]!(), pieces, true)).toEqual(chain(FIXTURES[name]!(), pieces, false));
  });

  it('carries the sub-tick remainder in state', () => {
    const a = advanceGame(createInitialState(42), 250);
    expect(a.state.clock).toEqual({ tick: 2, carryMs: 50 });
    expect(a.report.ticks).toBe(2);
    const b = advanceGame(a.state, 49);
    expect(b.state.clock).toEqual({ tick: 2, carryMs: 99 });
    expect(b.report.ticks).toBe(0);
    expect(b.state.hot).toBe(a.state.hot);
    expect(advanceGame(b.state, 1).state.clock).toEqual({ tick: 3, carryMs: 0 });
  });

  it('counts active ticks only while the round runs', () => {
    expect(advanceGame(createInitialState(42), 1_000).report.activeTicks).toBe(10);
    expect(advanceGame(between(), 1_000).report.activeTicks).toBe(0);
  });

  it('never mutates its input', () => {
    const start = createInitialState(42);
    const before = serializeSave(start);
    advanceGame(start, 5_000);
    expect(serializeSave(start)).toBe(before);
  });

  it('fires auto-return at its deadline tick and clears it', () => {
    const early = advanceGame(between(30), 3_000).state; // ticks 0..29 ran; tick 30 fires it
    expect(early.round.autoReturnTick).toBe(30);
    expect(advanceGame(early, 100).state.round.autoReturnTick).toBeNull();
  });

  it.each([-1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 2])('rejects elapsedMs %s', (ms) => {
    expect(() => advanceGame(createInitialState(42), ms)).toThrow(RangeError);
  });
});
