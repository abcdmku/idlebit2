import { describe, expect, it } from 'vitest';
import { applyAction } from '../core/actions';
import { advanceGame } from '../core/advance';
import { createInitialState } from '../core/state';
import { compileAll } from '../core/topology';
import { researchId, systemId, type PartRef } from '../types/ids';
import type { GameAction } from '../types/actions';
import type { GameState } from '../types/state';
import { capacity } from './catalog/curves';
import { PARTS } from './catalog';
import { deriveUnlocks } from './research/effects';

/** User bugs (25 Oct): "multi core doesnt work" and "l2 cache doesnt seem to do anything", through the real actions. */
const sys = systemId(0);
function chip(cores: number, l2: boolean): GameState {
  const base = createInitialState(42);
  const done: ReturnType<typeof researchId>[] = []; // D39: cores, L2 and the scheduler are bought, not researched
  const research = { ...base.research, completed: done, unlocks: deriveUnlocks(done) };
  let s: GameState = { ...base, research, compiled: compileAll(base.build, research), wallet: { ...base.wallet, credits: '1000000000' as never } };
  const act = (a: GameAction) => { const o = applyAction(s, a); if (!o.ok) throw new Error(JSON.stringify(o.rejection)); s = o.state; };
  const up = (slot: PartRef['slot'], k: number) => { for (let i = 0; i < k; i += 1) act({ type: 'upgradePart', part: { unit: { kind: 'system', id: sys }, slot } }); };
  for (let i = 1; i < cores; i += 1) act({ type: 'addPart', system: sys, kind: 'core', generation: 0 });
  act({ type: 'addPart', system: sys, kind: 'scheduler', generation: 0 });
  up({ kind: 'l1', socket: 0 }, 7);
  if (l2) act({ type: 'addPart', system: sys, kind: 'l2', generation: 0 });
  up({ kind: 'clock', socket: 0 }, 6);
  return s;
}
function play(s: GameState): { running: number; gross: number } {
  let run = 0, t = 0;
  const g0 = Number(s.ledger.gross);
  for (; t < 600 && s.round.phase === 'running'; t += 1) { s = advanceGame(s, 100).state; run += s.hot.sys.running[0]!; }
  return { running: run / t, gross: Number(s.ledger.gross) - g0 };
}

describe('multi-core and L2 on the boot chip', () => {
  it('every core runs a task at once, and income grows with the core count', () => {
    const one = play(chip(1, true)), four = play(chip(4, true));
    expect(one.running).toBeCloseTo(1, 1);
    expect(four.running).toBeGreaterThan(3.9);
    expect(four.gross).toBeGreaterThan(3 * one.gross);
  });

  it('L2 adds its whole capacity to the cache tasks can use, doubling a typical L1', () => {
    const without = chip(1, false), withL2 = chip(1, true);
    const l2 = capacity(PARTS.l2, 0, 1);
    expect(withL2.compiled.sys.cacheBits[0]! - without.compiled.sys.cacheBits[0]!).toBe(l2);
    expect(l2).toBeGreaterThanOrEqual(without.compiled.sys.cacheBits[0]!);
  });
});
