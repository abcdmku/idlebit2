import { advanceGame, advanceGameOwned, copyOfflineState } from '../core/advance';
import { applyAction } from '../core/actions';
import { G, LOC } from '../core/buffers';
import { commitWorld, openWorld } from '../core/world';
import { killSubtree } from '../exec/kill';
import { runPhase } from '../exec/run';
import { systemId, familyId } from '../types/ids';
import type { GameState, QueuedTask } from '../types/state';
import { queueWindow } from '../view/feed';
import { deriveRenderSnapshot } from '../view/snapshot';
import { FAMILIES } from './families';
import { primeMarket } from './prime';
import { BOOT_CAPS, marketState } from './testState';

const AND_MASK = FAMILIES.find((f) => f.key === 'andMask')!.id;
const BIT_FLIP = FAMILIES.find((f) => f.key === 'bitFlip')!.id;
const CAUSE = { timeout: 0, cantRun: 1 } as const;

/** The boot machine with the given window head (the rest of the saved window unchanged). */
function withHead(s: GameState, family: number, size: number): GameState {
  const head: QueuedTask = { ...s.market.window[0]!, family: familyId(family), size };
  return { ...s, market: { ...s.market, window: [head, ...s.market.window.slice(1)] } };
}
const failedBy = (s: GameState, cause: number) => s.hot.g[G.fail + cause]!;
const scope = { focus: { level: 'chip' as const, id: systemId(0) }, partner: null };

describe('the endless queue (program D10, spec §5.2)', () => {
  it('starts round 1 with five saved tasks and the head on the clock from tick 0', () => {
    const s = marketState();
    expect(s.market.window.map((t) => FAMILIES[t.family]!.key)).toEqual(['bitFlip', 'bitFlip', 'bitFlip', 'bitFlip', 'bitFlip']);
    expect(s.market.window.map((t) => t.taskId)).toEqual([1, 2, 3, 4, 5]);
    expect(s.market.headTick).toBe(0);
  });

  it('pulls the head as soon as the core frees, and draws one replacement per take', () => {
    // The 1 Hz core finishes a 1-op Bit Flip each second; a 1 ms transfer lands it.
    const s = advanceGame(marketState(), 10_000).state;
    expect(s.hot.g[G.taken]).toBe(10);
    expect(s.hot.g[G.met]).toBe(9);
    expect(s.market.window.map((t) => t.taskId)).toEqual([11, 12, 13, 14, 15]);
    expect(s.market.headTick).toBe(90);
    // Two draws (family, size) per task drawn after the five prepared ones.
    expect(s.hot.g[G.rngDraws]).toBe(marketState().hot.g[G.rngDraws]! + 2 * 10);
  });

  it('times out an untaken head at the end of headTick + 99 and promotes the next with a fresh 10 s', () => {
    // A 100-op head keeps the lone 1 Hz core busy, so head #2 waits from tick 0.
    const s = withHead(marketState(), BIT_FLIP, 100);
    const previous = deriveRenderSnapshot(s, scope);
    const before = advanceGame(s, 9_900).state;
    expect(deriveRenderSnapshot(before, scope, previous).failures).toEqual([]);
    expect(failedBy(before, CAUSE.timeout)).toBe(0);
    const after = advanceGame(before, 100).state;
    expect(failedBy(after, CAUSE.timeout)).toBe(1);
    expect(after.market.headTick).toBe(100);
    expect(after.hot.g[G.failedWork]).toBe(1);
    expect(after.market.window[0]!.taskId).toBe(3);
    expect(deriveRenderSnapshot(after, scope, previous).failures).toMatchObject([
      { taskId: 2, family: BIT_FLIP, type: 'compute', cause: 'timeout', tick: 99, tau: 1 },
    ]);
    const unobserved = advanceGame(withHead(marketState(), BIT_FLIP, 100), 10_000).state;
    expect(unobserved).toEqual(after);
    expect(deriveRenderSnapshot(unobserved, scope).failures).toEqual([]);
    const offline = advanceGameOwned(copyOfflineState(s), 10_000).state;
    expect(offline).toEqual(after);
    const offlineSnapshot = deriveRenderSnapshot(offline, scope);
    expect(offlineSnapshot.failures).toEqual([]);
    expect(offlineSnapshot.completions).toEqual([]);
  });

  it('a head no hardware can run blocks the line and fails as cantRun with its gate', () => {
    // AND Mask needs 2 bits; the boot core has 1 bit of cache.
    const initial = withHead(marketState(), AND_MASK, 1);
    const previous = deriveRenderSnapshot(initial, scope);
    const s = advanceGame(initial, 9_900).state;
    expect(s.hot.g[G.taken]).toBe(0);
    expect(queueWindow(s)[0]).toMatchObject({ blockedBy: 'cache', dismissible: true });
    const after = advanceGame(s, 1_100).state;
    expect(failedBy(after, CAUSE.cantRun)).toBe(1);
    expect(after.hot.g[G.taken]).toBeGreaterThan(0);
    const snapshot = deriveRenderSnapshot(after, scope, previous);
    expect(snapshot.failures).toMatchObject([
      { taskId: 1, family: AND_MASK, type: 'compute', cause: 'cantRun', tick: 99, tau: 1 },
    ]);
    expect(deriveRenderSnapshot(after, scope, previous).failures).toEqual(snapshot.failures);
    expect(deriveRenderSnapshot(after, scope, snapshot).failures).toEqual([]);
    const payload = (state: GameState) => deriveRenderSnapshot(state, scope, previous).failures.map(({ seq: _seq, ...failure }) => failure);
    expect(payload(advanceGame(initial, 11_000).state)).toEqual(payload(after));
  });

  it('Auto-skip dismisses a head no hardware can run, and never runnable work (D12.3)', () => {
    const base = withHead(marketState(), AND_MASK, 1);
    const s = { ...base, research: { ...base.research, unlocks: { ...base.research.unlocks, rules: ['autoSkip' as const] } } };
    const after = advanceGame(s, 1_000).state;
    expect(after.hot.g[G.dismissed]).toBe(1);
    expect(failedBy(after, CAUSE.cantRun)).toBe(0);
    expect(after.hot.g[G.taken]).toBeGreaterThan(0);
    expect(advanceGame(marketState(), 1_000).state.hot.g[G.dismissed]).toBe(0);
  });

  it('dismisses any window task for free and rejects committed work and stale identities', () => {
    const s = withHead(marketState(), AND_MASK, 1);
    const task = { epoch: s.epoch, roundIndex: 1, taskId: s.market.window[2]!.taskId };
    const out = applyAction(s, { type: 'dismissTask', task });
    expect(out.ok).toBe(true);
    expect(out.state.market.window.map((t) => t.taskId)).toEqual([1, 2, 4, 5, 6]);
    expect([out.state.hot.g[G.dismissed], out.state.hot.g[G.failed], out.state.hot.g[G.failedWork]]).toEqual([1, 0, 0]);
    // The head leaves: the next is head with a fresh 10 s from the next tick.
    const later = advanceGame(out.state, 3_000).state;
    const head = applyAction(later, { type: 'dismissTask', task: { ...task, taskId: 1 } }).state;
    expect(head.market.headTick).toBe(later.clock.tick);
    expect(applyAction(out.state, { type: 'dismissTask', task }).ok).toBe(false);
    expect(applyAction(s, { type: 'dismissTask', task: { ...task, epoch: 9 } }).ok).toBe(false);
    expect(applyAction(s, { type: 'dismissTask', task: { ...task, roundIndex: 2 } }).ok).toBe(false);
    const taken = advanceGame(marketState(), 500).state;
    const running = applyAction(taken, { type: 'dismissTask', task: { epoch: 0, roundIndex: 1, taskId: 1 } });
    expect(running.ok ? null : running.rejection.reason).toBe('Task is already committed to execution');
  });

  it('returns cancelled transfers to the queue front, committed, as the head with a fresh 10 s', () => {
    // A 100,000-op head is 1 s on the 100 kHz pipe (D29).
    const w = openWorld(withHead(marketState(), BIT_FLIP, 100_000));
    runPhase(w);
    expect(w.hot.sys.pipeRec[0]).toBeGreaterThanOrEqual(0);
    w.tick = 3;
    killSubtree(w, { kind: 'system', id: systemId(0) }, 'swap');
    const s = commitWorld(withHead(marketState(), BIT_FLIP, 100_000), w, 0);
    expect(s.hot.g[G.frontLen]).toBe(1);
    expect(s.hot.rec.loc[s.hot.g[G.frontHead]!]).toBe(LOC.front);
    expect(s.market.headTick).toBe(3);
    const shown = queueWindow(s);
    expect(shown.map((t) => [t.task.taskId, t.committed, t.dismissible])).toEqual([
      [1, true, false], [2, false, true], [3, false, true], [4, false, true], [5, false, true],
    ]);
    expect(shown[0]!.transferS).toBe(1);
  });

  it('is delta-invariant over a round with takes, timeouts, a blocked head, round end and Return', () => {
    const base = withHead(marketState(BOOT_CAPS), AND_MASK, 1);
    const s: GameState = { ...base, research: { ...base.research, unlocks: { ...base.research.unlocks, rules: ['autoReturn'], autoReturnDelayTicks: 50 } } };
    const whole = advanceGame(s, 600_000).state;
    expect(whole.round.index).toBeGreaterThan(1);
    expect(failedBy(whole, CAUSE.timeout) + failedBy(whole, CAUSE.cantRun) + whole.round.reports.length).toBeGreaterThan(0);
    for (const pieces of [[1, 99, 3_337, 250_000, 6, 346_557], [99_999, 1, 500_000]]) {
      const chained = pieces.reduce((st, ms) => advanceGame(st, ms).state, s);
      expect(chained).toEqual(whole);
      expect([...chained.hot.rng]).toEqual([...whole.hot.rng]);
    }
  });

  it('primes a running round at an endgame intensity with five tasks drawn there (testkit)', () => {
    const s = primeMarket(marketState(), 40);
    expect(s.market.intensity).toBe(40);
    expect(s.market.window).toHaveLength(5);
    expect(s.round.grace).toBeGreaterThan(1e9);
    expect(() => primeMarket({ ...s, round: { ...s.round, phase: 'between' } })).toThrow();
  });
});
