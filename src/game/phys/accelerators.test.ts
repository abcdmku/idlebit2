import { describe, expect, it, vi } from 'vitest';
import { DT_S, MAX_ACCELS, REGIONS } from '../core/constants';
import { ledgerPhase } from '../core/ledger';
import { MODE } from '../core/timers';
import type { World } from '../core/world';
import { researchId } from '../types/ids';
import { DRAW_FULL, drawKind, systemDraw } from './draw';
import { physSettings } from './settings';
import { physState, physTicks, physWorld } from './testWorld';

vi.mock('../build/compile', () => ({ compileUnits: () => undefined }));

/** Two GPUs and one NPU, with gaps to exercise physical-slot addressing. */
function cards(servers = 1): World {
  return physWorld(physState({ serversPerRack: servers }, (c) => {
    for (let s = 0; s < servers; s += 1) {
      for (const [slot, kind, idle, load] of [[0, 1, 2, 20], [7, 1, 3, 80], [3, 2, 5, 40]] as const) {
        const p = s * MAX_ACCELS + slot;
        c.sys.accelKind[p] = kind;
        c.sys.accelIdleW[p] = idle;
        c.sys.accelLoadW[p] = load;
      }
      c.sys.idleW[s * 4 + 2] = 10;
      // The obsolete aggregate load must not affect draw, even when its active count is set.
      c.sys.loadW[s * 4 + 2] = 999;
    }
  }));
}

const fullDraw = (w: World, s = 0): number => systemDraw(w, s, DRAW_FULL, physSettings(w)).deliveredW;
const research = (w: World, mode: 'background' | 'shared' | 'focus'): void => {
  w.research.active = researchId('phys-test');
  w.research.mode = mode;
};

describe('physical accelerator watts', () => {
  it('charges every installed idle once and only the working card load', () => {
    const w = cards();
    w.hot.sys.active[2] = 8;
    expect(fullDraw(w)).toBe(10);
    w.hot.sys.accelTaskS[7] = DT_S;
    expect(fullDraw(w)).toBe(90);
    w.hot.sys.accelTaskS[7] = 0;
    w.hot.sys.accelTaskS[0] = DT_S;
    expect(fullDraw(w)).toBe(30);
  });

  it('reads all eight slots at the correct system stride', () => {
    const w = cards(2);
    w.hot.sys.accelTaskS[0] = DT_S;
    w.hot.sys.accelTaskS[MAX_ACCELS + 7] = DT_S;
    expect(fullDraw(w, 0)).toBe(30);
    expect(fullDraw(w, 1)).toBe(90);
  });

  it('bills work completed halfway through the tick after active stages have disappeared', () => {
    const w = cards();
    w.hot.sys.accelTaskS[7] = DT_S / 2;
    expect(w.hot.sys.active[2]).toBe(0);
    physTicks(w, 1, (x) => expect(x.hot.bill[0]).toBe(50));
    ledgerPhase(w);
    expect(w.ledger.energyMeter).toBe(50 * DT_S * REGIONS[0]!.energyPrice);
    w.hot.sys.accelTaskS.fill(0);
    physTicks(w, 1);
    expect(w.hot.sys.drawW[0]).toBe(10);
  });

  it('adds independent GPU and NPU work and leaves the unused GPU idle', () => {
    const w = cards();
    w.hot.sys.accelTaskS[0] = DT_S;
    w.hot.sys.accelResearchS[3] = DT_S / 2;
    expect(fullDraw(w)).toBe(50);
  });

  it('bills the same linked-pool duty on every participating GPU and no NPU task load', () => {
    const w = cards();
    w.compiled.sys.gpuLinked[0] = 1;
    w.hot.sys.accelTaskS[0] = DT_S / 4;
    w.hot.sys.accelTaskS[7] = DT_S / 4;
    expect(fullDraw(w)).toBe(35);
  });

  it('keeps accelerator watts independent of CPU power controls and efficiency', () => {
    const w = cards();
    w.hot.sys.accelTaskS[7] = DT_S;
    w.hot.sys.dvfsOn[0] = 1;
    w.hot.sys.capFactor[0] = 0.1;
    w.hot.rack.capFactor[0] = 0.2;
    w.hot.rack.throttled[0] = 1;
    w.hot.rack.eff[0] = 0.5;
    w.compiled.sys.etaCfg[0] = 0.5;
    expect(fullDraw(w)).toBe(90);
  });

  it('rejects invalid per-card time budgets without silently capping watts', () => {
    const w = cards();
    w.hot.sys.accelTaskS[0] = DT_S * 0.75;
    w.hot.sys.accelResearchS[0] = DT_S * 0.5;
    expect(() => fullDraw(w)).toThrow(RangeError);
    w.hot.sys.accelResearchS[0] = DT_S * 0.25 + Number.EPSILON;
    expect(fullDraw(w)).toBeCloseTo(30);
    w.hot.sys.accelTaskS[0] = NaN;
    expect(() => fullDraw(w)).toThrow(RangeError);
    w.hot.sys.accelTaskS[0] = -DT_S;
    w.hot.sys.accelResearchS[0] = 0;
    expect(() => fullDraw(w)).toThrow(RangeError);
  });
});

describe('accelerator research duty consumption', () => {
  it.each([
    ['background', 1, 0],
    ['shared', 0.75, 0.25],
    ['focus', 0, 1],
  ] as const)('%s bills task and research shares once, plus research on idle GPU and NPU', (mode, task, share) => {
    const w = cards();
    research(w, mode);
    w.hot.sys.accelTaskS[0] = DT_S * task;
    w.hot.sys.accelResearchS[0] = DT_S * share;
    w.hot.sys.accelResearchS[7] = DT_S;
    w.hot.sys.accelResearchS[3] = DT_S;
    expect(fullDraw(w)).toBe(150);
  });

  it('research fills the remainder after a mid-tick task completion', () => {
    const w = cards();
    research(w, 'background');
    w.hot.sys.accelTaskS[7] = DT_S / 2;
    w.hot.sys.accelResearchS[7] = DT_S / 2;
    expect(fullDraw(w)).toBe(90);
  });

  it.each(['offline', 'between'] as const)('%s research bills each physical card without active task stages', (mode) => {
    const w = cards();
    research(w, 'background');
    if (mode === 'offline') w.hot.sys.mode[0] = MODE.offline;
    else { w.round.phase = 'between'; w.hot.sys.mode[0] = MODE.paused; }
    for (const slot of [0, 3, 7]) w.hot.sys.accelResearchS[slot] = DT_S;
    physTicks(w, 1, (x) => expect(x.hot.bill[0]).toBe(150));
    expect(w.hot.sys.active[2]).toBe(0);
    expect(w.hot.sys.drawW[0]).toBe(150);
  });

  it.each([
    [MODE.boot, true, 10], [MODE.asleep, true, 0.3],
    [MODE.dark, true, 0], [MODE.crashed, true, 0], [MODE.cold, true, 0],
    [MODE.paused, false, 0], [MODE.offline, false, 0],
  ])('preserves mode %i draw with research=%s', (mode, active, expected) => {
    const w = cards();
    // Old meters cannot make a booting, sleeping or unpowered machine incur load.
    w.hot.sys.accelTaskS[0] = DT_S / 2;
    w.hot.sys.accelResearchS[0] = DT_S / 2;
    expect(systemDraw(w, 0, drawKind(mode, active), physSettings(w)).deliveredW).toBeCloseTo(expected);
  });
});

describe('accelerator power through existing physics phases', () => {
  it('averages partial duty before applying PSU bands and the regional energy price', () => {
    const w = cards();
    w.compiled.sys.psuCapW[0] = 100;
    w.compiled.sys.psuLoss[0] = 0.1;
    w.hot.sys.accelTaskS[7] = DT_S / 2;
    physTicks(w, 1, (x) => expect(x.hot.bill[0]).toBe(55));
    expect(w.hot.sys.psuUsage[0]).toBe(0.5);
    ledgerPhase(w);
    expect(w.ledger.energyMeter).toBe(55 * DT_S * REGIONS[0]!.energyPrice);
  });

  it('adds research-only draw to rack heat with the existing thermal efficiency', () => {
    const w = cards(2);
    research(w, 'focus');
    w.hot.sys.accelResearchS[7] = DT_S;
    w.hot.rack.eff[0] = 0.5;
    w.compiled.rack.coolerQc[0] = 100;
    physTicks(w, 1);
    expect(w.hot.sys.drawW[0]).toBe(90);
    expect(w.hot.rack.heatW[0]).toBe(200);
    expect(w.hot.rack.tempF[0]).toBeGreaterThan(70);
  });

  it('research-only GPU load overloads at 10 s, bills that tick, then stays dark', () => {
    const w = cards();
    research(w, 'focus');
    w.compiled.sys.psuCapW[0] = 50;
    w.hot.sys.accelResearchS[7] = DT_S;
    physTicks(w, 99);
    expect(w.hot.sys.psuOverTicks[0]).toBe(99);
    expect(w.hot.sys.mode[0]).toBe(MODE.onMarket);
    physTicks(w, 1, (x) => expect(x.hot.bill[0]).toBe(90));
    expect(w.hot.sys.mode[0]).toBe(MODE.dark);
    expect(w.hot.sys.accelResearchS[7]).toBe(DT_S);
    physTicks(w, 1, (x) => expect(x.hot.bill[0]).toBe(0));
    expect(w.hot.sys.drawW[0]).toBe(0);
  });

  it('an unused large GPU cannot overload a supply from its aggregate load rating', () => {
    const w = cards();
    w.compiled.sys.psuCapW[0] = 50;
    w.hot.sys.accelTaskS[0] = DT_S;
    w.hot.sys.active[2] = 1;
    physTicks(w, 110);
    expect(w.hot.sys.drawW[0]).toBe(30);
    expect(w.hot.sys.psuOverTicks[0]).toBe(0);
    expect(w.hot.sys.mode[0]).toBe(MODE.onMarket);
  });
});
