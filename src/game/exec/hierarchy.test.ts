import { describe, expect, it } from 'vitest';
import { advanceGame, advanceGameOwned, copyGameState } from '../core/advance';
import { G } from '../core/buffers';
import { nextInt, seedRng } from '../core/rng';
import { createInitialState } from '../core/state';
import { deserializeSave, serializeSave } from '../save/serialize';
import { SPILL_FLEETS } from '../testkit/spillFixtures';
import type { GameState } from '../types/state';

/**
 * D26 on real families: a Rack-era rack whose small-RAM servers spill onto SSDs while taking
 * windowed tasks through an LB queue (testkit/spillFixtures), and the boot opening.
 */
let warmRack: GameState | null = null;
const rack = (): GameState => copyGameState(warmRack ??= SPILL_FLEETS.spillRack());

/** Deterministic partitions of `total` ms into pieces of 1 ms .. 5 s (test-local RNG host). */
function partition(total: number, seed: number): number[] {
  const host = { rng: new Uint32Array(4), g: new Float64Array(32) };
  seedRng(host.rng, seed);
  const pieces: number[] = [];
  for (let left = total; left > 0;) { const piece = Math.min(left, nextInt(host, 1, 5_001)); pieces.push(piece); left -= piece; }
  return pieces;
}

const MINUTE = 60_000;
const usedDisk = (s: GameState) => Array.from(s.hot.sys.usedDisk).reduce((a, b) => a + b, 0);

describe('memory hierarchy and windows on a spill rack (D26)', () => {
  it('starts mid-spill: shards on disk and windowed tasks taken', () => {
    const s = rack();
    expect(usedDisk(s)).toBeGreaterThan(0);
    expect(Array.from(s.hot.parent.deadline.subarray(0, s.hot.parent.len)).some((d) => d > 0)).toBe(true);
  });

  it('is delta-invariant over random partitions, RNG words included, and owned advances equal pure ones', () => {
    const whole = advanceGame(rack(), MINUTE).state;
    for (const seed of [1, 2]) {
      const chained = partition(MINUTE, seed).reduce((s, ms) => advanceGame(s, ms).state, rack());
      expect(chained).toEqual(whole);
      expect([...chained.hot.rng]).toEqual([...whole.hot.rng]);
    }
    const owned = partition(MINUTE, 3).reduce((s, ms) => advanceGameOwned(s, ms).state, rack());
    expect(owned).toEqual(whole);
  }, 60_000);

  it('a save taken mid-spill resumes exactly', () => {
    const start = rack();
    const loaded = deserializeSave(serializeSave(start));
    if (!loaded.ok) throw new Error(loaded.error);
    expect(advanceGame(loaded.state, 30_000).state).toEqual(advanceGame(start, 30_000).state);
  }, 60_000);
});

describe('the boot opening under D26 (D20)', () => {
  it('round 1 with no purchases ends on "Can\'t run · cache" within 45–75 s', () => {
    for (const seed of [42, 1042]) {
      const s = advanceGame(createInitialState(seed), 120_000).state;
      const r1 = s.round.reports[0]!;
      expect(r1.durationMs).toBeGreaterThanOrEqual(45_000);
      expect(r1.durationMs).toBeLessThanOrEqual(75_000);
      expect([r1.failDetail.cantRun, r1.failedByCause.late, s.hot.g[G.diskWork]]).toEqual(['cache', 0, 0]);
    }
  });
});
