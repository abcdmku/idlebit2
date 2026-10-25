import { vi } from 'vitest';
import { advanceGame, advanceGameOwned, copyGameState } from '../core/advance';
import { deserializeSave, serializeSave } from '../save/serialize';
import { createInitialState } from '../core/state';
import { LOC } from '../core/buffers';
import { commitWorld, openWorld } from '../core/world';
import { killSubtree } from '../exec/kill';
import { FLEETS } from '../testkit/fleets';
import { rackId, roomId, systemId, type NodeRef } from '../types/ids';
import type { SnapshotScope } from '../types/snapshot';
import { fixtureState } from './fixtures';
import { deriveRenderSnapshot, parentOf } from './snapshot';

// Snapshots never compute quotes (architecture §3.2): any call fails the test.
vi.mock('../build/quotes', () => ({ quote: () => { throw new Error('quote() called inside deriveRenderSnapshot'); } }));

// Top-hardware fixtures do 600 warm-up ticks of real work under D10 (the fleet pulls continuously).
vi.setConfig({ testTimeout: 60_000 });

const scope = (focus: NodeRef, partner: NodeRef | null = null): SnapshotScope => ({ focus, partner });

describe('deriveRenderSnapshot', () => {
  it('publishes each task lost to power, heat or swap once, without saving the failure history', () => {
    for (const cause of ['power', 'heat', 'swap'] as const) {
      const base = createInitialState(42);
      const longHead = { ...base, market: { ...base.market, window: [{ ...base.market.window[0]!, size: 100 }, ...base.market.window.slice(1)] } };
      const initial = advanceGame(longHead, 1_000).state, focus = scope({ level: 'chip', id: systemId(0) });
      const previous = deriveRenderSnapshot(initial, focus), w = openWorld(initial);
      const rec = w.hot.rec, ids = new Set<number>();
      for (let r = 0; r < rec.len; r += 1) {
        if (rec.owner[r] !== 0 || rec.loc[r] !== LOC.running && rec.loc[r] !== LOC.queue) continue;
        for (let i = 0; i < rec.count[r]!; i += 1) ids.add(rec.taskId[r]! + i);
      }
      expect(ids.size).toBeGreaterThan(0);
      w.late = cause !== 'swap';
      killSubtree(w, { kind: 'system', id: systemId(0) }, cause);
      const state = commitWorld(initial, w, 0), before = serializeSave(state);
      const snap = deriveRenderSnapshot(state, focus, previous);
      expect(snap.failures.map(f => f.taskId).sort((a, b) => a - b)).toEqual([...ids].sort((a, b) => a - b));
      expect(snap.failures.every(f => f.cause === cause && f.tick === initial.clock.tick && f.tau === (cause === 'swap' ? 0 : 1))).toBe(true);
      expect(new Set(snap.failures.map(f => f.seq)).size).toBe(ids.size);
      expect(deriveRenderSnapshot(state, focus, snap).failures).toEqual([]);
      expect(serializeSave(state)).toBe(before);
      const loaded = deserializeSave(before);
      if (!loaded.ok) throw new Error(loaded.error);
      expect(deriveRenderSnapshot(loaded.state, focus).failures).toEqual([]);
    }
  });

  it('publishes each paid completion once per snapshot cursor without changing saves or the sim', () => {
    const initial = createInitialState(42), focus = scope({ level: 'chip', id: systemId(0) });
    const previous = deriveRenderSnapshot(initial, focus);
    const result = advanceGame(initial, 5_000);
    const before = serializeSave(result.state);
    const snap = deriveRenderSnapshot(result.state, focus, previous);
    expect(snap.completions.length).toBeGreaterThan(0);
    expect(snap.completions).toHaveLength(result.report.met);
    expect(snap.completions.reduce((sum, c) => sum + BigInt(c.credits), 0n)).toBe(BigInt(result.report.gross));
    expect(snap.completions.reduce((sum, c) => sum + c.data, 0)).toBeCloseTo(Number(result.report.data) + result.state.wallet.dataMeter);
    for (const c of snap.completions) {
      expect(c).toMatchObject({ system: 0, cpu: 0, core: 0, gpu: null, rack: null, room: null, site: null, type: 'compute' });
      expect(c.tau).toBeGreaterThanOrEqual(0);
      expect(c.tau).toBeLessThanOrEqual(1);
      expect((c.tick + c.tau) * 100).toBeLessThanOrEqual(5_000);
    }
    expect(snap.completions.map(c => c.seq)).toEqual([...new Set(snap.completions.map(c => c.seq))].sort((a, b) => a - b));
    expect(deriveRenderSnapshot(result.state, focus, previous).completions).toEqual(snap.completions);
    expect(deriveRenderSnapshot(result.state, focus, snap).completions).toEqual([]);
    expect(serializeSave(result.state)).toBe(before);
    const loaded = deserializeSave(before);
    if (!loaded.ok) throw new Error(loaded.error);
    expect(deriveRenderSnapshot(loaded.state, focus).completions).toEqual([]);
    const unobserved = advanceGame(createInitialState(42), 5_000);
    expect(unobserved.report.gross).toBe(result.report.gross);
    expect(deriveRenderSnapshot(unobserved.state, focus).completions).toEqual([]);
    const payload = (s: typeof snap) => s.completions.map(({ seq: _seq, ...c }) => c);
    const partitioned = [1_250, 49, 1, 3_700].reduce((s, ms) => advanceGame(s, ms).state, initial);
    expect(payload(deriveRenderSnapshot(partitioned, focus, previous))).toEqual(payload(snap));
    expect(payload(deriveRenderSnapshot(advanceGameOwned(copyGameState(initial), 5_000).state, focus, previous))).toEqual(payload(snap));
  });

  it('builds the boot chip with HUD, feed, round and research', () => {
    const state = advanceGame(createInitialState(42), 1_250).state;
    const snap = deriveRenderSnapshot(state, scope({ level: 'chip', id: systemId(0) }));
    expect(snap).toMatchObject({ tick: 12, simTimeMs: 1_250, bootMs: 10_000, partner: null });
    // The first Bit Flip lands in 1 ms and finishes on the 1 Hz core at 1.001 s: 1 Credit.
    expect(snap.hud).toMatchObject({ credits: '1', data: '0', roundState: 'running', roundIndex: 1, roundElapsedMs: 1_200 });
    expect(snap.hud.sla.percent).toBe(100);
    // Tasks #1 and #2 are taken (1 s each on the 1 Hz core); #3 is the head since tick 10.
    expect(snap.feed).toMatchObject({ timing: 'running', roundIndex: 1, headDeadlineTick: 109, blockedBy: null, failBin: null, taken: 2, dismissed: 0 });
    expect(snap.feed.window).toMatchObject(state.market.window.map((t) => ({
      task: { epoch: state.epoch, roundIndex: state.round.index, taskId: t.taskId },
      family: t.family, committed: false, dismissible: true, work: 1, transferS: 0.001,
    })));
    expect(snap.feed.window.map((t) => t.task.taskId)).toEqual([3, 4, 5, 6, 7]);
    if (snap.focus.level === 'chip') expect(snap.focus.pipe).toMatchObject({ speed: 1000, transfer: null, waiting: false });
    expect(snap.round).toMatchObject({ index: 1, state: 'running', canReturn: false });
    if (snap.focus.level !== 'chip') throw new Error('chip');
    expect(snap.focus.cores).toHaveLength(1);
    expect(snap.focus.parent).toBeNull();
    expect(snap.home.chip).toEqual({ level: 'chip', id: 0 });
  });

  it('has the documented shape at every level', () => {
    const rack = deriveRenderSnapshot(FLEETS.rackFull(), scope({ level: 'rack', id: rackId(0) }));
    if (rack.focus.level !== 'rack') throw new Error('rack');
    expect(rack.focus.servers).toHaveLength(12);
    expect(rack.focus.switch.ports.length).toBeGreaterThanOrEqual(4);

    const room = deriveRenderSnapshot(FLEETS.roomFull(), scope({ level: 'room', id: roomId(0) }));
    if (room.focus.level !== 'room') throw new Error('room');
    expect(room.focus.racks).toHaveLength(room.focus.rows * 8);
    expect(room.focus.racks[0]!.servers).toHaveLength(12);

    const global = deriveRenderSnapshot(FLEETS.fleetMax(), scope({ level: 'global', id: 0 }, { level: 'room', id: roomId(0) }));
    if (global.focus.level !== 'global') throw new Error('global');
    expect(global.focus.sites.map((s) => s.region)).toEqual(['us-east', 'us-west', 'eu-west', 'eu-north', 'sa-east', 'af-south', 'ap-southeast', 'ap-northeast']);
    expect(global.focus.sites.every((s) => s.zones.length === 3)).toBe(true);
    expect(global.focus.backbone.links).toHaveLength(7);
    expect(global.partner?.level).toBe('room');
  });

  it('falls back to the home chip for a ref the build cannot serve', () => {
    const snap = deriveRenderSnapshot(createInitialState(42), scope({ level: 'rack', id: rackId(99) }));
    expect(snap.focus.level).toBe('chip');
  });

  it('points each level at the node one level up once that level is opened', () => {
    const state = FLEETS.fleetMax();
    expect(parentOf(state, { level: 'chip', id: systemId(13) })).toEqual({ level: 'system', id: 13 });
    expect(parentOf(state, { level: 'system', id: systemId(13) })).toEqual({ level: 'rack', id: 1 });
    expect(parentOf(state, { level: 'rack', id: rackId(30) })).toEqual({ level: 'room', id: 1 });
    expect(parentOf(state, { level: 'room', id: roomId(4) })).toEqual({ level: 'global', id: 0 });
    expect(parentOf(createInitialState(42), { level: 'chip', id: systemId(0) })).toBeNull();
  });
});

describe('incremental reuse', () => {
  it('reuses the level, HUD and round objects when nothing changed', () => {
    const state = fixtureState('rack');
    const s = scope({ level: 'rack', id: rackId(0) });
    const a = deriveRenderSnapshot(state, s);
    const b = deriveRenderSnapshot(state, s, a);
    expect(b.focus).toBe(a.focus);
    expect(b.hud).toBe(a.hud);
    expect(b.round).toBe(a.round);
    expect(b.feed.recentOutcomes).toBe(a.feed.recentOutcomes);
  });

  it('rebuilds dynamic values after a tick but keeps static slot layouts', () => {
    const state = fixtureState('chipBoot');
    const s = scope({ level: 'chip', id: systemId(0) });
    const a = deriveRenderSnapshot(state, s);
    const next = advanceGame(state, 100).state;
    const b = deriveRenderSnapshot(next, s, a);
    if (a.focus.level !== 'chip' || b.focus.level !== 'chip') throw new Error('chip');
    expect(b.focus).not.toBe(a.focus);
    expect(b.focus.slots).toBe(a.focus.slots);
    expect(b.focus.cache.levels).toBe(a.focus.cache.levels);
    expect(b).toEqual(deriveRenderSnapshot(next, s));
  });

  it('never reuses across a scope change or a new epoch', () => {
    const state = fixtureState('rack');
    const a = deriveRenderSnapshot(state, scope({ level: 'rack', id: rackId(0) }));
    const b = deriveRenderSnapshot(state, scope({ level: 'system', id: systemId(0) }), a);
    expect(b.focus.level).toBe('system');
    const c = deriveRenderSnapshot({ ...state, epoch: state.epoch + 1 }, scope({ level: 'rack', id: rackId(0) }), a);
    expect(c.focus).not.toBe(a.focus);
    expect(c.focus).toEqual(a.focus);
  });
});
