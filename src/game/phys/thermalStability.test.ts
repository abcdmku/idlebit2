import { describe, expect, it } from 'vitest';
import { advanceGame } from '../core/advance';
import { compileAll } from '../core/topology';
import { buildState } from '../testkit/builders';
import { topRack, topSystem } from '../testkit/fleets';
import type { ResearchId } from '../types/ids';
import type { GameState } from '../types/state';

/**
 * Funded rackFull with gpuLink still to research. Completing it re-derives unlocks, which opens
 * the Room: a barebones zone cooler (Qc 2e10 W) now takes the outflow of a top rack cooler
 * (Qc 4e16 W). Before the coupled-conductance cap the zone overshot every tick, the 50 °F floor
 * absorbed the swing, and rack and zone temperatures diverged to NaN at tick 875, after which the
 * ledger threw converting a NaN bill to BigInt.
 */
function linkingRackFull(): GameState {
  const base = buildState({
    seed: 42, sites: 1, zonesPerSite: 1, racksPerZone: 1, serversPerRack: 12, unlocks: 'max', system: topSystem, rack: topRack,
    credits: '1000000000000000000000000000000', data: '1000000000000000000000',
  });
  const gpuLink = 'gpuLink' as ResearchId;
  const research = {
    ...base.research, active: gpuLink, activeProgress: 0,
    completed: base.research.completed.filter((id) => id !== gpuLink),
    unlocks: { ...base.research.unlocks, rules: base.research.unlocks.rules.filter((rule) => rule !== 'gpuLink') },
  };
  return { ...base, research, compiled: compileAll(base.build, research) };
}

describe('stiff rack → zone coupling (spec §10.5)', () => {
  it('a top rack in a barebones zone opened mid-round stays finite past the old NaN tick', () => {
    const before = linkingRackFull();
    expect(before.compiled.room.opened[0]).toBe(0);
    const after = advanceGame(before, 100_000).state;
    expect(after.research.completed).toContain('gpuLink');
    expect(after.compiled.room.opened[0]).toBe(1);
    expect(after.clock.tick).toBe(1_000);
    const temps = [after.hot.rack.tempF[0]!, after.hot.room.tempF[0]!];
    expect(temps.every(Number.isFinite)).toBe(true);
    // The zone can only approach its racks: no swing below the rack, no pinning at the floor.
    expect(after.hot.room.tempF[0]!).toBeGreaterThan(after.hot.rack.tempF[0]!);
    expect(after.wallet.credits).toMatch(/^\d+$/);
  });
});
