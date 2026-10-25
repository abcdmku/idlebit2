import { afterEach, describe, expect, it, vi } from 'vitest';
import { advanceGame, advanceGameOwned } from '../core/advance';
import { TICK_MS } from '../core/constants';
import { summaryDebug } from '../exec/slots';
import { primeMarket } from '../market/prime';
import { buildState } from '../testkit/builders';
import { FLEETS, MAX_FLEET } from '../testkit/fleets';
import { provisionInfrastructure } from '../testkit/infrastructure';
import type { GameState } from '../types/state';
import { powerDebug } from './powerCache';

vi.setConfig({ testTimeout: 120_000 });

/** Supplies cycle and racks crash here (undersized PDUs and coolers), across three sites. */
const hotSites = (): GameState => advanceGameOwned(primeMarket(provisionInfrastructure(buildState({
  ...MAX_FLEET, sites: 3, zonesPerSite: 2, racksPerZone: 2, serversPerRack: 6,
  rack: (rack) => ({ ...MAX_FLEET.rack!(rack), cooler: { gen: 0, level: 1, setpointF: 70 }, pdu: { gen: 0, level: 1, capped: false } }),
})), 36), 100 * TICK_MS).state;

const researching = (state: GameState): GameState => ({ ...state, research: { ...state.research, active: state.research.completed[0]! } });

const FIXTURES: Record<string, () => GameState> = {
  boot: () => FLEETS.boot(),
  rackFull: () => FLEETS.rackFull(),
  rackFullResearch: () => researching(FLEETS.rackFull()),
  hotSites,
};

afterEach(() => { powerDebug.verify = false; summaryDebug.verify = false; });

describe('change-driven power and partial recounts (R34)', () => {
  it.each(Object.keys(FIXTURES))('see every moved input over long owned chunks and match the pure path (%s)', (name) => {
    powerDebug.verify = true;
    summaryDebug.verify = true;
    const total = 180_000;
    let owned = FIXTURES[name]!(), pure = FIXTURES[name]!();
    // Long chunks run the candidate path (one advance call over many ticks); the pure path's
    // uneven pieces cross tick boundaries at varying offsets and rebuild every derived cache.
    for (let done = 0; done < total; done += 30_000) owned = advanceGameOwned(owned, 30_000).state;
    const pieces = [37, 163, 250, 1_000, 50, 1, 99, 400, 4_000, 12_000];
    for (let done = 0, i = 0; done < total; i += 1) {
      const ms = Math.min(pieces[i % pieces.length]!, total - done);
      pure = advanceGame(pure, ms).state;
      done += ms;
    }
    expect(owned).toEqual(pure);
  });
});
