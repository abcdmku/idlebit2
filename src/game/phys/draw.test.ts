import { describe, expect, it, vi } from 'vitest';
import { cloneCompiled } from '../core/buffers';
import type { World } from '../core/world';
import type { RuleId } from '../types/catalog';
import { clockFactorOf } from './draw';
import { physState, physTicks, physWorld } from './testWorld';

// Phys fixtures set every compiled column phys reads; keep them independent of catalog balance (S5).
vi.mock('../build/compile', () => ({ compileUnits: () => undefined }));

/** A lone system with one core: 1 W core idle, 10 W core load, 0.5 W clock idle, 0.5 W uncore idle. */
function lone(rules: RuleId[], settings: { dvfs?: boolean; turbo?: boolean; cStateLimit?: 0 | 1 | 3 | 6 } = {}, params = {}): World {
  const state = physState({}, (c) => { c.sys.coreIdleW[0] = 1; c.sys.coreLoadW[0] = 10; c.sys.clockIdleW[0] = 0.5; c.sys.idleW[0] = 0.5; });
  const sys = state.build.systems[0]!;
  const build = { ...state.build, systems: [{ ...sys, spec: { ...sys.spec, settings: { dvfs: false, turbo: false, cStateLimit: 6 as const, ...settings } } }] };
  const w = physWorld({ ...state, build });
  w.research.unlocks = { ...w.research.unlocks, rules, ruleParams: params };
  return w;
}
const drawAfter = (w: World, ticks: number, busy: number): number => {
  w.hot.sys.busy[0] = busy;
  physTicks(w, ticks);
  return w.hot.sys.drawW[0]!;
};

describe('draw (spec §9.1)', () => {
  it('idle plus load × utilization', () => {
    const w = lone([]);
    expect(drawAfter(w, 1, 0)).toBeCloseTo(2);
    expect(drawAfter(w, 1, 0.5)).toBeCloseTo(7);
    expect(drawAfter(w, 1, 1)).toBeCloseTo(12);
  });
});

describe('C-states (spec §9.3)', () => {
  it('C1 halves an idle core at once; C3 and C6 apply after 1 s idle', () => {
    const c1 = lone(['coreIdle'], {}, { coreIdle: { factor: 0.5 } });
    drawAfter(c1, 1, 1);
    expect(drawAfter(c1, 2, 0)).toBeCloseTo(0.5 + 1);
    const c6 = lone(['coreIdle'], {}, { coreIdle: { factor: 0.02 } });
    drawAfter(c6, 1, 1);
    expect(drawAfter(c6, 2, 0)).toBeCloseTo(0.5 + 1);
    expect(c6.hot.sys.cstate[0]).toBe(1);
    expect(drawAfter(c6, 10, 0)).toBeCloseTo(0.02 + 1);
    expect(c6.hot.sys.cstate[0]).toBe(6);
  });
  it('the system C-state limit caps the depth', () => {
    const w = lone(['coreIdle'], { cStateLimit: 3 }, { coreIdle: { factor: 0.02 } });
    drawAfter(w, 30, 0);
    expect(w.hot.sys.cstate[0]).toBe(3);
    expect(w.hot.sys.drawW[0]).toBeCloseTo(0.15 + 1);
  });
  it('package C cuts clock and uncore idle to 0.2 while every core is idle', () => {
    const w = lone(['packageIdle']);
    expect(drawAfter(w, 1, 0)).toBeCloseTo(1 + 0.2);
    expect(drawAfter(w, 1, 1)).toBeCloseTo(12);
  });
});

describe('P-states (spec §9.3)', () => {
  it('DVFS: half clock and 0.3× core load while nothing is queued', () => {
    const w = lone(['dvfs'], { dvfs: true });
    drawAfter(w, 1, 1);
    expect(clockFactorOf(w, 0)).toBe(0.5);
    expect(w.hot.sys.clockFactor[0]).toBe(0.5);
    expect(drawAfter(w, 1, 1)).toBeCloseTo(2 + 3);
    w.hot.sys.queueLen[0] = 1;
    drawAfter(w, 1, 1);
    expect(clockFactorOf(w, 0)).toBe(1);
  });
  it('DVFS switched off by the player does nothing', () => {
    const w = lone(['dvfs'], { dvfs: false });
    drawAfter(w, 1, 1);
    expect(clockFactorOf(w, 0)).toBe(1);
  });
  it('turbo: 1.25× clock for 1.8× load while the PSU is under 90%', () => {
    const w = lone(['turbo'], { turbo: true });
    w.compiled.sys.psuCapW[0] = 100;
    drawAfter(w, 1, 1);
    expect(clockFactorOf(w, 0)).toBe(1.25);
    expect(drawAfter(w, 1, 1)).toBeCloseTo(2 + 18);
    // A smaller PSU is a recompile: compiled buffers are replaced, never edited in place.
    w.compiled = cloneCompiled(w.compiled);
    w.compiled.sys.psuCapW[0] = 21;
    drawAfter(w, 1, 1);
    expect(clockFactorOf(w, 0)).toBe(1);
  });
});
