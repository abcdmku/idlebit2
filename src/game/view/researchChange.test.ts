import { amount } from '../amount';
import { deriveUnlocks } from '../build/research/effects';
import { advanceGame } from '../core/advance';
import { createInitialState } from '../core/state';
import { researchId } from '../types/ids';
import type { GameState } from '../types/state';
import { fixtureState } from './fixtures';
import { selectResearchTree } from './selectors';

/** A new game with `done` researched. */
function researched(...done: string[]): GameState {
  const s = createInitialState(42);
  const completed = done.map(researchId);
  return { ...s, research: { ...s.research, completed, unlocks: deriveUnlocks(completed) } };
}
const changeOf = (s: GameState, id: string) => selectResearchTree(s).nodes.find((n) => n.id === id)!.change;

describe('research node change (before → after on the part it upgrades)', () => {
  it.each([
    [[], 'dualCore', { label: 'Cores per CPU', before: '1', after: '2' }],
    [['pipelining'], 'superscalar', { label: 'Lanes per core', before: '2', after: '4' }],
    [['memController'], 'ddr', { label: 'RAM', before: 'SDRAM', after: 'DDR' }],
    [[], 'cstateC1', { label: 'Idle core power', before: '100%', after: '50%' }],
    [[], 'fifoSched', { label: 'Queue', before: 'none', after: '2 tasks' }],
  ] as const)('with %j researched, %s shows %j', (done, id, expected) => {
    expect(changeOf(researched(...done), id)).toEqual(expected);
  });

  it('has no single change for a fab or a structure node', () => {
    const s = researched();
    expect([changeOf(s, 'fabKhz'), changeOf(s, 'rack')]).toEqual([null, null]);
  });
});

describe('research income (round-time, for ETAs)', () => {
  it('is 0 for the first 10 s of a round, then this round\'s Data and net Credits per second', () => {
    let s = createInitialState(42);
    s = advanceGame(s, 5_000).state;
    expect(selectResearchTree(s).income).toEqual({ dataPerSec: 0, creditsPerSec: 0 });
    s = advanceGame(s, 15_000).state;
    const elapsedS = (s.clock.tick - s.round.startTick) / 10;
    expect(Number(s.round.gross)).toBeGreaterThan(0);
    expect(selectResearchTree(s).income).toEqual({
      dataPerSec: Number(s.round.data) / elapsedS, creditsPerSec: (Number(s.round.gross) - Number(s.round.energy)) / elapsedS,
    });
  });

  it('between rounds, is the last report\'s Data and net over its duration', () => {
    const base = fixtureState('rack', 'between');
    const last = base.round.reports.at(-1)!;
    const s = { ...base, round: { ...base.round, reports: [...base.round.reports.slice(0, -1), { ...last, durationMs: 60_000, data: amount('600'), net: amount('1200') }] } };
    expect(selectResearchTree(s).income).toEqual({ dataPerSec: 10, creditsPerSec: 20 });
  });
});
