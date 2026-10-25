import { advanceGame } from '../core/advance';
import type { GlobalSnapshot, RackSnapshot, RoomSnapshot } from '../types/snapshot';
import type { TransferView } from '../types/views';
import { FIXTURE_NAMES, FIXTURE_ROUNDS, fixtureScope, fixtureSnapshot, fixtureState } from './fixtures';
import { deriveRenderSnapshot } from './snapshot';

// Top-hardware fixtures do 600 warm-up ticks of real work under D10 (the fleet pulls continuously).
vi.setConfig({ testTimeout: 60_000 });

const LEVEL_OF = {
  chipBoot: 'chip', chipTop: 'chip', systemBoot: 'system', systemTop: 'system',
  rack: 'rack', room: 'room', global: 'global', globalGroup: 'global',
  rackSplit: 'rack', roomSplit: 'room', globalSplit: 'global', powerRack: 'rack', spillSystem: 'system', spillRack: 'rack',
} as const;

describe('snapshot fixtures', () => {
  it('derive a snapshot for every fixture and round state, focused on its level', () => {
    for (const name of FIXTURE_NAMES) {
      for (const round of FIXTURE_ROUNDS) {
        const snap = fixtureSnapshot(name, round);
        expect(snap.focus.level).toBe(LEVEL_OF[name]);
        expect(snap.round.state).toBe(round);
        expect(snap.hud.roundState).toBe(round);
        expect(snap.round.canReturn).toBe(round !== 'running');
      }
    }
  });

  it('show live state while running and a paused world with a report after the round', () => {
    const live = fixtureSnapshot('rack', 'running');
    const ended = fixtureSnapshot('rack', 'ended');
    if (live.focus.level !== 'rack' || ended.focus.level !== 'rack') throw new Error('rack');
    expect(live.focus.servers).toHaveLength(12);
    expect(live.focus.servers.some((s) => s.state === 'onMarket' && s.load > 0)).toBe(true);
    expect(live.focus.servers.some((s) => s.state === 'boot' && s.timerS !== null)).toBe(true);
    expect(live.feed.window.length).toBe(5);
    expect(live.feed.window[0]).toMatchObject({ committed: true, dismissible: false });
    expect(ended.focus.servers.every((s) => s.state === 'paused')).toBe(true);
    expect(ended.round.lastReport?.failedByCause.timeout).toBe(190);
    expect(ended.feed).toMatchObject({ timing: 'onReturn', headDeadlineTick: null });
  });

  it('has busy cores with real stage progress on the top chip', () => {
    const snap = fixtureSnapshot('chipTop');
    if (snap.focus.level !== 'chip') throw new Error('chip');
    expect(snap.focus.cores).toHaveLength(32); // D7: one CPU, at most 32 cores
    const busy = snap.focus.cores.filter((c) => c.family !== null);
    expect(busy.length).toBeGreaterThan(0);
    expect(busy.some((c) => c.progress > 0 && c.progress < 1)).toBe(true);
    expect(busy.every((c) => c.taskId !== null)).toBe(true);
    const state = fixtureState('chipTop');
    const queued = state.hot.sys.queueHead[0]!;
    expect(queued).toBeGreaterThanOrEqual(0);
    expect(snap.focus.queue[0]).toEqual({ taskId: state.hot.rec.taskId[queued], family: state.hot.rec.family[queued] });
  });

  it('measures takes per second at fleet scale, with returned work at the queue front', () => {
    const feed = fixtureSnapshot('globalGroup').feed;
    expect(feed.takesPerSec).toBeGreaterThan(100);
    expect(feed.window.filter((t) => t.committed)).toHaveLength(2);
  });

  it('offers a zoom partner one level up', () => {
    expect(fixtureSnapshot('chipTop', 'running', true).partner?.level).toBe('system');
    // rackFull opens no room, so the rack has no parent to zoom out to.
    expect(fixtureSnapshot('rack', 'running', true).partner).toBeNull();
    expect(fixtureState('rack')).toBe(fixtureState('rack'));
  });

  it('split fixtures show a task split 4+ ways crossing a link for 0.25 s or more, on positive credits', () => {
    for (const [name, links] of [['rackSplit', ['server']], ['roomSplit', ['rack']], ['globalSplit', ['zone']]] as const) {
      let state = fixtureState(name), seen: TransferView | undefined;
      expect(state).not.toBe(fixtureState(name));
      for (let t = 0; t < 100 && !seen; t += 1) {
        const focus = deriveRenderSnapshot(state, fixtureScope(name)).focus as RackSnapshot | RoomSnapshot | GlobalSnapshot;
        seen = focus.flows.find((f) => (links as readonly string[]).includes(f.link) && f.shards >= 4 && f.bits / f.speed >= 0.25);
        state = advanceGame(state, 100).state;
      }
      expect(seen, name).toBeDefined();
      expect(BigInt(fixtureSnapshot(name).hud.credits) > 0n, name).toBe(true);
      // A minute on: still earning more than the hardware burns.
      const start = fixtureState(name);
      expect(BigInt(advanceGame(start, 60_000).state.wallet.credits) > BigInt(start.wallet.credits), name).toBe(true);
    }
  });
});
