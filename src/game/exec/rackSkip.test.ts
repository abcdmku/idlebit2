import { advanceGame } from '../core/advance';
import { buildState } from '../testkit/builders';
import { FLEETS } from '../testkit/fleets';
import { gpuLoadedState } from '../testkit/gpuLoaded';
import { researchId } from '../types/ids';
import type { GameState } from '../types/state';

// Top-hardware fixtures do 600 warm-up ticks of real work under D10 (the fleet pulls continuously).
vi.setConfig({ testTimeout: 60_000 });

/** nextDue is a conservative wake hint; a visit-every-tick run recomputes it more often. */
const results = (s: GameState) => ({ ...s, hot: { ...s.hot, rack: { ...s.hot.rack, nextDue: null } } });

/** Two racks of bare servers researching in Shared mode for the whole run, so skipped racks tally research. */
function researching(): GameState {
  const base = buildState({ seed: 42, sites: 1, zonesPerSite: 1, racksPerZone: 2, serversPerRack: 12, unlocks: 'max',
    credits: '1000000000000000000000000000000' });
  const id = researchId('bbSubsea');
  return { ...base, research: { ...base.research, completed: base.research.completed.filter((x) => x !== id),
    active: id, activeProgress: 0 } };
}

const CASES: readonly (readonly [string, () => GameState, number])[] = [
  ['rackFull', FLEETS.rackFull, 600_000],
  ['roomFull', FLEETS.roomFull, 120_000],
  ['researching', researching, 600_000],
  ['gpu', () => gpuLoadedState(), 600_000],
];

describe('run phase rack skip', () => {
  it.each(CASES)('changes no result against visiting every rack (%s)', (_, fixture, ms) => {
    const skipped = advanceGame(fixture(), ms);
    const visited = advanceGame(fixture(), ms, { visitAll: true });
    expect(skipped.report).toEqual(visited.report);
    expect(results(skipped.state)).toEqual(results(visited.state));
  });

  it('keeps research running across skipped ticks in the research case', () => {
    const s = advanceGame(researching(), 600_000).state;
    expect(s.research.active).toBe('bbSubsea');
    expect(s.research.activeProgress).toBeGreaterThan(0);
  });

  it('leaves racks with nothing due asleep', () => {
    const s = advanceGame(FLEETS.roomFull(), 1_000).state;
    const due = [...s.hot.rack.nextDue.subarray(0, s.hot.rack.len)];
    expect(due.filter((tick) => tick > s.clock.tick + 1).length).toBeGreaterThan(0);
  });
});
