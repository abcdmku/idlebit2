import { describe, expect, it } from 'vitest';
import { advanceGame, advanceGameOwned, copyGameState } from '../core/advance';
import { G } from '../core/buffers';
import { nextInt, seedRng } from '../core/rng';
import { lbQueueStep } from '../build/catalog/network';
import { rackConfigPrice } from '../build/pricing';
import { barebonesRackConfig } from '../build/configModel';
import { deserializeSave, serializeSave } from '../save/serialize';
import { SPLIT_FLEETS } from '../testkit/splitFixtures';
import type { GameState } from '../types/state';

/**
 * D25 on real families: one room of 4 racks × 4 kHz servers, rack LB queues L3 and a room queue L4,
 * whose shared uplinks hold split tasks' shards in turn and whose router queues fill.
 */
let warm: GameState | null = null;
const fixture = (): GameState => copyGameState(warm ??= SPLIT_FLEETS.roomSplit());

/** Deterministic partitions of `total` ms into pieces of 1 ms .. 5 s (test-local RNG host). */
function partition(total: number, seed: number): number[] {
  const host = { rng: new Uint32Array(4), g: new Float64Array(32) };
  seedRng(host.rng, seed);
  const pieces: number[] = [];
  for (let left = total; left > 0;) { const piece = Math.min(left, nextInt(host, 1, 5_001)); pieces.push(piece); left -= piece; }
  return pieces;
}

const MINUTE = 60_000;

describe('split tasks and router queues on a room fixture (D25)', () => {
  it('starts mid-split: split tasks in flight and router-queue entries waiting', () => {
    const s = fixture();
    expect([s.hot.g[G.parentUsed]! > 0, s.hot.g[G.rqTotal]! > 0]).toEqual([true, true]);
  });

  it('is delta-invariant over random partitions, RNG words included', () => {
    const whole = advanceGame(fixture(), MINUTE).state;
    for (const seed of [1, 2]) {
      const chained = partition(MINUTE, seed).reduce((s, ms) => advanceGame(s, ms).state, fixture());
      expect(chained).toEqual(whole);
      expect([...chained.hot.rng]).toEqual([...whole.hot.rng]);
    }
    expect(whole.hot.g[G.met]! - fixture().hot.g[G.met]!).toBeGreaterThan(0);
  }, 60_000);

  it('owned advances equal pure advances', () => {
    const pure = advanceGame(fixture(), MINUTE).state;
    const owned = partition(MINUTE, 3).reduce((s, ms) => advanceGameOwned(s, ms).state, fixture());
    expect(owned).toEqual(pure);
  }, 60_000);

  it('a save taken mid-split resumes exactly', () => {
    const start = fixture();
    const loaded = deserializeSave(serializeSave(start));
    if (!loaded.ok) throw new Error(loaded.error);
    expect(advanceGame(loaded.state, 30_000).state).toEqual(advanceGame(start, 30_000).state);
  }, 60_000);
});

describe('router queue prices (D25.7, spec §12.7)', () => {
  it('prices each slot on the era ladder of its scope', () => {
    expect([lbQueueStep('rack', 1), lbQueueStep('rack', 31), lbQueueStep('room', 1)]).toEqual([379_843n, 976_161n, 54_697_330_406n]);
  });

  it('a rack configuration adds the queue steps up to its LB queue level', () => {
    const base = barebonesRackConfig();
    const queued = { ...base, lb: { ...base.lb, queueLevel: 3 } };
    expect(rackConfigPrice(queued) - rackConfigPrice(base)).toBe(379_843n + lbQueueStep('rack', 2));
  });
});
