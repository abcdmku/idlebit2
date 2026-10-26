import { amount } from '../amount';
import { deriveUnlocks } from '../build/research/effects';
import { advanceGame } from '../core/advance';
import { createInitialState } from '../core/state';
import { researchId } from '../types/ids';
import type { GameState } from '../types/state';
import { fixtureState } from './fixtures';
import { selectResearchTree } from './selectors';
import { barebonesSpec } from '../core/defaults';
import { buildState } from '../testkit/builders';
import { deriveRenderSnapshot } from './snapshot';

/** A new game with `done` researched. */
function researched(...done: string[]): GameState {
  const s = createInitialState(42);
  const completed = done.map(researchId);
  return { ...s, research: { ...s.research, completed, unlocks: deriveUnlocks(completed) } };
}
const changeOf = (s: GameState, id: string) => selectResearchTree(s).nodes.find((n) => n.id === id)!.change;

describe('research node change (before → after on the part it upgrades)', () => {
  it.each([
    [[], 'dualCore', { label: 'Cores per CPU', before: '1', after: '32' }],
    [['memController'], 'ddr', { label: 'RAM', before: 'SDRAM', after: 'DDR' }],
    [[], 'cstateC1', { label: 'Idle core power', before: '100%', after: '50%' }],
    [[], 'fifoSched', { label: 'Queue', before: 'No queue', after: '2 tasks' }],
    [[], 'l2Cache', { label: 'L2 cache', before: '—', after: 'Hz L2' }],
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
  it('reads the same recent rate on the HUD as on the research tree, in a round and between rounds', () => {
    const hudIncome = (s: GameState) => deriveRenderSnapshot(s, { focus: { level: 'chip', id: 0 as never }, partner: null }).hud.incomeRecent;
    const running = advanceGame(createInitialState(42), 20_000).state, between = fixtureState('rack', 'between');
    for (const s of [running, between]) expect(hudIncome(s)).toEqual(selectResearchTree(s).income);
    expect(hudIncome(running)!.creditsPerSec).toBeGreaterThan(0);
  });

  it('goes negative over the last 30 s when energy outruns pay', () => {
    // A rack of kHz servers with their clocks driven to L20 and a GPU each: the energy bill outruns pay.
    const spec = barebonesSpec(1), cpu = spec.cpu!;
    let s = buildState({
      seed: 42, sites: 1, zonesPerSite: 1, racksPerZone: 1, serversPerRack: 8, unlocks: 'max', credits: '100000000000',
      system: (id, rack, slot) => ({ id, rack, slot, online: true, spec: {
        ...spec, cpu: { ...cpu, cores: Array(4).fill({ gen: 1, level: 1 }), clock: { gen: 1, level: 20 } },
        accels: [{ kind: 'gpu', model: '1330', upgrades: 0 }],
      } }),
    });
    s = advanceGame(s, 40_000).state;
    const hud = deriveRenderSnapshot(s, { focus: { level: 'chip', id: 0 as never }, partner: null }).hud;
    expect(hud.incomeRecent!.creditsPerSec).toBeLessThan(0);
    expect(selectResearchTree(s).income).toEqual(hud.incomeRecent);
    const window = 30;
    expect(hud.incomeRecent!.creditsPerSec).toBeCloseTo((Number(s.ledger.gross) - Number(s.ledger.energy) - netAt(s, s.clock.tick - window * 10)) / window, 6);
  });
});

/** Net (gross − energy) on the ledger's ring at `tick`. */
function netAt(s: GameState, tick: number): number {
  let net = 0;
  for (const sample of s.ledger.netRing) { if (sample.tick > tick) break; net = Number(sample.gross) - Number(sample.energy); }
  return net;
}
