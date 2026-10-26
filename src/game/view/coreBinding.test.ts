import { describe, expect, it } from 'vitest';
import { applyAction } from '../core/actions';
import { advanceGame } from '../core/advance';
import { createInitialState } from '../core/state';
import { compileAll } from '../core/topology';
import { deriveUnlocks } from '../build/research/effects';
import { researchId, systemId, type PartRef } from '../types/ids';
import type { GameAction } from '../types/actions';
import type { GameState } from '../types/state';
import { chipSnapshot } from './chip';
import { systemCoreActivity } from './common';

/** User, 25 Oct: "cores should not order by completion". A task stays on the core that started it. */
const sys = systemId(0);
function fourCores(): GameState {
  const base = createInitialState(42);
  const done: ReturnType<typeof researchId>[] = []; // D39: cores, L2 and the scheduler are bought, not researched
  const research = { ...base.research, completed: done, unlocks: deriveUnlocks(done) };
  let s: GameState = { ...base, research, compiled: compileAll(base.build, research), wallet: { ...base.wallet, credits: '1000000000' as never } };
  const act = (a: GameAction) => { const o = applyAction(s, a); if (!o.ok) throw new Error(JSON.stringify(o.rejection)); s = o.state; };
  const up = (slot: PartRef['slot'], k: number) => { for (let i = 0; i < k; i += 1) act({ type: 'upgradePart', part: { unit: { kind: 'system', id: sys }, slot } }); };
  for (let i = 1; i < 4; i += 1) act({ type: 'addPart', system: sys, kind: 'core', generation: 0 });
  act({ type: 'addPart', system: sys, kind: 'scheduler', generation: 0 });
  up({ kind: 'l1', socket: 0 }, 7);
  act({ type: 'addPart', system: sys, kind: 'l2', generation: 0 });
  up({ kind: 'clock', socket: 0 }, 6);
  return s;
}

describe('a task keeps its core', () => {
  it('when another task finishes, the tasks still running stay on their cores', () => {
    let s = fourCores(), checked = 0, sawEarlyFinish = false;
    let prev = chipSnapshot(s, sys, null).cores.map((c) => c.taskId);
    for (let t = 0; t < 600 && s.round.phase === 'running'; t += 1) {
      s = advanceGame(s, 100).state;
      const now = chipSnapshot(s, sys, null).cores.map((c) => c.taskId);
      const running = new Set(now.filter((id) => id !== null));
      prev.forEach((id, core) => {
        if (id === null || !running.has(id)) { if (id !== null && core < 3 && prev.slice(core + 1).some((x) => x !== null && running.has(x))) sawEarlyFinish = true; return; }
        expect(now[core]).toBe(id);
        checked += 1;
      });
      prev = now;
    }
    expect(checked).toBeGreaterThan(100);
    // A task on a lower core finished while a higher core's task kept running: the case the bug reshuffled.
    expect(sawEarlyFinish).toBe(true);
  });

  it('the rack sled minis get per-core busy in core order', () => {
    let s = fourCores();
    s = advanceGame(s, 5_000).state;
    const { cores, coreBusy } = systemCoreActivity(s, sys);
    expect(coreBusy).toHaveLength(cores);
    expect(coreBusy).toEqual(chipSnapshot(s, sys, null).cores.map((c) => c.busy));
  });
});
