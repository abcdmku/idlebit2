import { describe, expect, it } from 'vitest';
import { advanceGame, advanceGameOwned, applyAction, createInitialState, researchId, type GameState } from '../index';
import { G } from '../core/buffers';
import { researchDef } from '../build/research/tree';

/** D27: research is a task that cuts the line. The boot machine: one 1 Hz core, no scheduler. */
function bootWithTaskRunning(): GameState {
  const s = createInitialState(42);
  // 0.5 s in, the opening 1-op Bit Flip holds the only core until 1.0 s.
  const running = advanceGame({ ...s, wallet: { ...s.wallet, data: '10' as never } }, 500).state;
  expect(running.hot.sys.running[0]).toBe(1);
  const out = applyAction(running, { type: 'startResearch', project: researchId('pipelining') });
  if (!out.ok) throw new Error(out.rejection.reason);
  return out.state;
}

describe('research task (D27)', () => {
  it('jumps to the head: nothing is taken behind it, and the waiting task has no clock', () => {
    const start = bootWithTaskRunning();
    const head = start.market.window[0]!.taskId, taken = start.hot.g[G.taken]!;
    const waiting = advanceGame(start, 300).state;
    expect(waiting.hot.g[G.researchHolders]).toBe(0);
    expect(waiting.market.window[0]!.taskId).toBe(head);
    expect(waiting.hot.g[G.taken]).toBe(taken);
  });

  it('is taken next by the system with room, holds it, and completes the project', () => {
    const start = bootWithTaskRunning();
    const head = start.market.window[0]!.taskId, taken = start.hot.g[G.taken]!;
    const held = advanceGame(start, 700).state;
    expect(held.hot.sys.researchThreads[0]).toBe(1);
    expect(held.hot.g[G.taken]).toBe(taken);
    expect(held.market.window[0]!.taskId).toBe(head);
    // 20 ops on a 1 Hz core: 20 s, plus a tick to apply.
    expect(researchDef('pipelining')!.work).toBe(20);
    const done = advanceGame(held, 20_200).state;
    expect(done.research.completed).toContain('pipelining');
    expect(done.hot.g[G.researchHolders]).toBe(0);
    expect(done.hot.sys.researchThreads[0]).toBe(0);
  });

  it('gives the old head a fresh 10 s when research is taken', () => {
    const start = bootWithTaskRunning();
    const before = start.market.headTick;
    const held = advanceGame(start, 700).state;
    const takeTick = held.market.headTick;
    expect(takeTick).toBeGreaterThan(before);
    expect(takeTick).toBe(11);
    // Research holds the core for 20 s: the head waits its full 10 s from the take, then times out.
    const later = advanceGame(held, 9_000).state;
    expect(later.hot.g[G.fail]).toBe(0);
    const timedOut = advanceGame(later, 1_500).state;
    expect(timedOut.hot.g[G.fail]).toBe(1);
  });

  it('is delta-invariant and owned-equivalent through take, hold, completion and the round end', () => {
    const start = bootWithTaskRunning();
    const whole = advanceGame(start, 90_000).state;
    let split = start;
    for (const ms of [1, 99, 37, 263, 5, 701, 2, 1_300, 40_000, 47_592]) split = advanceGame(split, ms).state;
    expect(split).toEqual(whole);
    let owned = structuredClone(start);
    for (const ms of [500, 1_500, 88_000]) owned = advanceGameOwned(owned, ms).state;
    expect(owned).toEqual(whole);
  });
});
