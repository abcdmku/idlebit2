import { describe, expect, it, vi } from 'vitest';
import { MODE } from '../core/timers';
import { killSubtree } from '../exec';
import { physState, physTicks, physWorld } from './testWorld';
import { stepCap, stepOverload, supplyLossW, supplyMultiplier } from './supplies';

// Phys fixtures set every compiled column phys reads; keep them independent of catalog balance (S5).
vi.mock('../build/compile', () => ({ compileUnits: () => undefined }));

vi.mock('../exec', async (importOriginal) => ({ ...(await importOriginal<typeof import('../exec')>()), killSubtree: vi.fn() }));

describe('supply loss multiplier (D4.3)', () => {
  it('is ×1 up to 90%, ×1.5 above 90% to 100%, ×3 above 100%', () => {
    expect([0, 0.5, 0.9, 0.9001, 0.95, 1, 1.0001, 2].map(supplyMultiplier)).toEqual([1, 1, 1, 1.5, 1.5, 1.5, 3, 3]);
  });
  it('applies to the loss only: 100 W delivered at 10% loss', () => {
    expect(supplyLossW(80, 100, 0.1)).toBeCloseTo(8);
    expect(supplyLossW(95, 100, 0.1)).toBeCloseTo(14.25);
    expect(supplyLossW(120, 100, 0.1)).toBeCloseTo(36);
  });
});

describe('overload timer (spec §9.4)', () => {
  it('8 accumulated seconds take 8 s to clear', () => {
    let t = 0;
    for (let i = 0; i < 80; i += 1) t = stepOverload(t, 1.2);
    expect(t).toBe(80);
    for (let i = 0; i < 79; i += 1) t = stepOverload(t, 0.5);
    expect(t).toBe(1);
    t = stepOverload(t, 1);
    expect(t).toBe(0);
    expect(stepOverload(0, 0.2)).toBe(0);
  });
  it('a capped supply only counts when its fixed draw is over capacity', () => {
    expect(stepOverload(5, 1.5, false)).toBe(4);
  });
});

describe('board PSU on the lone system', () => {
  const overloaded = () => physState({ unlocks: 'base' }, (c) => { c.sys.idleW[0] = 12; c.sys.psuCapW[0] = 10; c.sys.psuLoss[0] = 0.2; });

  it('fails at 10 s of overload: dark, work killed with cause power, reboots after the boot time', () => {
    const w = physWorld(overloaded());
    w.research.unlocks = { ...w.research.unlocks, levels: { ...w.research.unlocks.levels, system: true } };
    vi.mocked(killSubtree).mockClear();
    physTicks(w, 99);
    expect(w.hot.sys.psuOverTicks[0]).toBe(99);
    expect(w.hot.sys.mode[0]).toBe(MODE.onMarket);
    physTicks(w, 1);
    expect(w.hot.sys.mode[0]).toBe(MODE.dark);
    expect(w.hot.sys.psuOverTicks[0]).toBe(0);
    expect(killSubtree).toHaveBeenCalledWith(w, { kind: 'system', id: 0 }, 'power', 'psu');
    expect(w.events.entries.at(-1)).toMatchObject({ kind: 'supplyFailed', supply: { kind: 'psu', id: 0 } });
    // Dark for the full boot time, drawing nothing.
    physTicks(w, 99);
    expect(w.hot.sys.mode[0]).toBe(MODE.dark);
    expect(w.hot.sys.drawW[0]).toBe(0);
    physTicks(w, 1);
    expect(w.hot.sys.mode[0]).toBe(MODE.onMarket);
    expect(w.events.entries.at(-1)).toMatchObject({ kind: 'supplyRebooted' });
  });

  it('bills the delivered watts plus loss × multiplier at the home price', () => {
    const w = physWorld(overloaded());
    w.research.unlocks = { ...w.research.unlocks, levels: { ...w.research.unlocks.levels, system: true } };
    physTicks(w, 1, (x) => expect(x.hot.bill[0]).toBeCloseTo(12 + 12 * 0.2 * 3));
  });

  it('is dormant before System: no limit, no loss', () => {
    const w = physWorld(overloaded());
    w.research.unlocks = { ...w.research.unlocks, levels: { ...w.research.unlocks.levels, system: false } };
    physTicks(w, 200, (x) => expect(x.hot.bill[0]).toBe(12));
    expect(w.hot.sys.psuOverTicks[0]).toBe(0);
    expect(w.hot.sys.mode[0]).toBe(MODE.onMarket);
  });
});

describe('rack PDU', () => {
  it('fails the whole rack and kills its work with cause power', () => {
    const state = physState({ serversPerRack: 2 }, (c) => {
      c.sys.idleW[0] = 30; c.sys.idleW[4] = 30; c.rack.pduCapW[0] = 50;
    });
    const w = physWorld(state);
    vi.mocked(killSubtree).mockClear();
    physTicks(w, 100);
    expect(w.hot.rack.pduFailed[0]).toBe(1);
    expect([w.hot.sys.mode[0], w.hot.sys.mode[1]]).toEqual([MODE.dark, MODE.dark]);
    expect(killSubtree).toHaveBeenCalledWith(w, { kind: 'rack', id: 0 }, 'power', 'pdu');
    physTicks(w, 100);
    expect(w.hot.rack.pduFailed[0]).toBe(0);
    expect(w.hot.sys.mode[1]).toBe(MODE.onMarket);
  });
});

describe('power cap (spec §9.5)', () => {
  it('steps down a tenth per 10% over, and back up only with 10% headroom', () => {
    // fixed 20 W, core load 100 W at factor 1, capacity 100 W.
    expect(stepCap(10, 20, 100, 100)).toBe(8);
    expect(stepCap(8, 20, 100, 100)).toBe(8);
    expect(stepCap(7, 20, 100, 100)).toBe(7);
    expect(stepCap(6, 20, 100, 100)).toBe(7);
    expect(stepCap(1, 200, 100, 100)).toBe(1);
  });
});
