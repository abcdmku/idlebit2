import { describe, expect, it } from 'vitest';
import { deriveUnlocks } from '../build/research/effects';
import { applyAction } from '../core/actions';
import { advanceGame } from '../core/advance';
import { POWER_SCALE } from '../core/constants';
import { createInitialState } from '../core/state';
import { compileAll } from '../core/topology';
import { researchId, systemId } from '../types/ids';
import type { GameState } from '../types/state';
import { systemSnapshot } from '../view/system';
import { PRE_SYSTEM_CPU_W } from './draw';

const sys = systemId(0);
function at(done: string[], credits = '1000000000'): GameState {
  const base = createInitialState(42);
  const ids = done.map(researchId);
  const research = { ...base.research, completed: ids, unlocks: deriveUnlocks(ids) };
  return { ...base, research, compiled: compileAll(base.build, research), wallet: { ...base.wallet, credits: credits as never } };
}

describe('D36 power scale', () => {
  it('a boot CPU reads in microwatts in views, while the sim and its bill are unchanged', () => {
    const s = advanceGame(at([]), 5_000).state;
    const drawW = systemSnapshot(s, sys, null).drawW;
    expect(drawW).toBeCloseTo(s.hot.sys.drawW[0]! * POWER_SCALE, 15);
    expect(drawW).toBeGreaterThan(1e-6);
    expect(drawW).toBeLessThan(1e-3);
  });
});

describe('D38 fixed CPU power before System', () => {
  it('draws the fixed power whatever the clock, then the real model at System', () => {
    let s = at(['fifoSched', 'dualCore', 'l2Cache']);
    s = advanceGame(s, 2_000).state;
    expect(s.hot.sys.drawW[0]).toBe(PRE_SYSTEM_CPU_W);
    for (let i = 0; i < 8; i += 1) { const o = applyAction(s, { type: 'upgradePart', part: { unit: { kind: 'system', id: sys }, slot: { kind: 'clock', socket: 0 } } }); if (o.ok) s = o.state; }
    s = advanceGame(s, 2_000).state;
    expect(s.hot.sys.drawW[0]).toBe(PRE_SYSTEM_CPU_W);
  });
});

describe('D37 RAM comes with System', () => {
  it('adds SDRAM right after the System board, with no RAM research', () => {
    const before = applyAction(at(['fifoSched', 'dualCore', 'l2Cache']), { type: 'addPart', system: sys, kind: 'ram', generation: 0 });
    expect(before.ok).toBe(false);
    const after = applyAction(at(['fifoSched', 'dualCore', 'l2Cache', 'systemBoard']), { type: 'addPart', system: sys, kind: 'ram', generation: 0 });
    expect(after.ok).toBe(true);
  });
});
