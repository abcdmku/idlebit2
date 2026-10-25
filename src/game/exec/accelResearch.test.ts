import { describe, expect, it, vi } from 'vitest';
import { G } from '../core/buffers';
import { DT_S } from '../core/constants';
import { MODE } from '../core/timers';
import { commitWorld, openWorld, type World } from '../core/world';
import { setOnline } from '../core/online';
import { DRAW_FULL, systemDraw } from '../phys/draw';
import { physSettings } from '../phys/settings';
import { systemId } from '../types/ids';
import { F } from './testFamilies';
import { execState, feed, setAccels, step } from './testWorld';

vi.mock('../market/families', async (orig) => ({ ...(await orig<object>()), FAMILIES: (await import('./testFamilies')).TEST_FAMILIES }));

const state = (linked = false) => execState({}, { threads: 4, K: 4, Q: 8 }, (c) => {
  setAccels(c, 0, [
    { cores: 4, ops: 10, vram: 100, loadW: 100 },
    { cores: 4, ops: 20, vram: 100, loadW: 200 },
    { kind: 'npu', cores: 0, ops: 0, tensorOps: 30, vram: 100, loadW: 300 },
  ], linked);
  c.sys.idleW.fill(0); c.sys.loadW.fill(0); c.sys.coreIdleW.fill(0); c.sys.coreLoadW.fill(0); c.sys.clockIdleW.fill(0);
});
function research(w: World, mode: 'background' | 'shared' | 'focus'): void {
  w.research.active = 'x' as never;
  w.research.mode = mode;
}

describe('per-card task and research duty', () => {
  it('charges task load only on the assigned card, including a partial last tick', () => {
    const w = openWorld(state());
    feed(w, F.gpu60, 1, 1);
    step(w);
    expect(w.hot.sys.accelTaskS.slice(0, 3)).toEqual(new Float64Array([0, 0.05, 0]));
    const draw = systemDraw(w, 0, DRAW_FULL, physSettings(w));
    // 100 W of card load plus the pipe: 1 bit sent this tick (10 bit/s) at 0.01 W per bit/s, the 1 kHz link's load watts (D18.5).
    expect(draw.deliveredW).toBeCloseTo(100.1, 12);
  });

  for (const mode of ['background', 'shared', 'focus'] as const) {
    it(`${mode} publishes matching card duty and research work exactly once`, () => {
      const w = openWorld(state());
      research(w, mode);
      feed(w, F.gpu60, 1, 100);
      step(w);
      const share = mode === 'background' ? 0.9 : mode === 'shared' ? 0.75 : 0;
      expect(w.hot.sys.accelTaskS[1]).toBeCloseTo(share * DT_S, 12);
      expect(w.hot.sys.accelResearchS[1]).toBeCloseTo((1 - share) * DT_S, 12);
      expect(w.hot.sys.accelResearchS[0]).toBe(DT_S);
      expect(w.hot.sys.accelResearchS[2]).toBe(DT_S);
      expect(w.hot.sys.accelResearchOps[0]).toBeCloseTo((10 + 30 + 20 * (1 - share)) * DT_S, 12);
      // Three idle CPU threads plus the unchanged priority formula for the held thread.
      const cpuOps = (4 - share) * DT_S;
      expect(w.hot.g[G.researchOps]).toBeCloseTo(w.hot.sys.accelResearchOps[0]! + cpuOps, 12);
      // Card loads (100 + 200 + 300 W) plus the pipe: 100 bits sent this tick, 1,000 bit/s at 0.01 W per bit/s (D18.5).
      expect(systemDraw(w, 0, DRAW_FULL, physSettings(w)).deliveredW).toBeCloseTo(610, 12);
    });
  }

  it('research fills the remainder after a GPU task completes during a tick', () => {
    const w = openWorld(state());
    research(w, 'background');
    feed(w, F.gpu60, 1, 1);
    step(w);
    expect(w.hot.sys.accelTaskS[1]).toBeCloseTo(0.05, 12);
    expect(w.hot.sys.accelResearchS[1]).toBeCloseTo(0.05, 12);
    expect(w.hot.sys.accelResearchOps[0]).toBeCloseTo(5, 12);
  });

  it('applies configuration and rack efficiency exactly once without CPU clock factors', () => {
    const w = openWorld(state()); research(w, 'shared');
    w.compiled.sys.etaCfg[0] = 0.8; w.hot.rack.eff[0] = 0.5; w.hot.sys.clockFactor[0] = 0.001;
    feed(w, F.gpu60, 1, 100); step(w);
    expect(w.hot.sys.accelWAnchor[2]! + w.hot.sys.accelRate[2]! * (w.hot.rack.effClock[0]! - w.hot.sys.accelEAnchor[2]!)).toBeCloseTo(0.6, 12);
    expect(w.hot.sys.accelResearchOps[0]).toBeCloseTo(45 * 0.8 * 0.5 * DT_S, 12);
    expect(w.hot.sys.accelTaskS[1]).toBeCloseTo(0.075, 12);
  });

  it('GPU link changes task capacity but counts each GPU and NPU once for research', () => {
    for (const linked of [false, true]) {
      const w = openWorld(state(linked));
      research(w, 'background');
      step(w);
      expect(w.hot.sys.accelResearchOps[0]).toBeCloseTo(6, 12);
      expect(w.hot.sys.accelResearchS.slice(0, 3)).toEqual(new Float64Array([DT_S, DT_S, DT_S]));
    }
  });

  it('reserving VRAM during a CPU stage does not block idle accelerator research', () => {
    const w = openWorld(state());
    research(w, 'background');
    feed(w, F.cpuGpu, 1, 10);
    step(w);
    expect(w.hot.sys.accelHolders[1]).toBe(1);
    expect(w.hot.sys.accelTaskS[1]).toBe(0);
    expect(w.hot.sys.accelResearchOps[0]).toBeCloseTo(6, 12);
  });

  it('offline and between-round systems use all available accelerators', () => {
    for (const phase of ['running', 'between'] as const) {
      const w = openWorld(state());
      research(w, 'focus'); w.round.phase = phase;
      w.hot.sys.mode[0] = phase === 'running' ? MODE.offline : MODE.paused;
      step(w);
      expect(w.hot.sys.accelResearchOps[0]).toBeCloseTo(6, 12);
      expect(w.hot.sys.accelResearchS.slice(0, 3)).toEqual(new Float64Array([DT_S, DT_S, DT_S]));
    }
  });

  for (const mode of [MODE.boot, MODE.dark, MODE.crashed, MODE.cold, MODE.asleep]) {
    it(`does no accelerator research outside full draw, mode ${mode}`, () => {
      const w = openWorld(state()); research(w, 'focus'); w.hot.sys.mode[0] = mode;
      step(w);
      expect(w.hot.sys.accelResearchOps[0]).toBe(0);
      expect(w.hot.sys.accelResearchS.every((seconds) => seconds === 0)).toBe(true);
    });
  }

  it('insolvency stops accelerator research and does not leave stale meters', () => {
    const w = openWorld(state()); research(w, 'focus'); step(w);
    expect(w.hot.sys.accelResearchOps[0]).toBeGreaterThan(0);
    w.research.stoppedInsolvent = true; step(w);
    expect(w.hot.sys.accelResearchOps[0]).toBe(0);
    expect(w.hot.sys.accelResearchS.every((seconds) => seconds === 0)).toBe(true);
  });

  it('the actual offline switch kills GPU and CPU-stage reservations with the swap cause', () => {
    const initial = state(), w = openWorld(initial);
    feed(w, F.gpu60, 2, 100); feed(w, F.cpuGpu, 1, 100); step(w);
    expect(w.hot.sys.usedVram[0]).toBeGreaterThan(0);
    const result = setOnline(commitWorld(initial, w, 0), { type: 'setOnline', unit: { kind: 'system', id: systemId(0) }, online: false });
    expect(result.ok).toBe(true);
    const h = result.state.hot.sys;
    expect(h.usedVram[0]).toBe(0);
    expect(h.accelHolders.every((count) => count === 0)).toBe(true);
    expect(h.accelHead.every((head) => head === -1)).toBe(true);
    expect(result.state.hot.fam.failTick[F.gpu60 * 7 + 5]).toBe(2);
    expect(result.state.hot.fam.failTick[F.cpuGpu * 7 + 5]).toBe(1);
    expect(h.mode[0]).toBe(MODE.goingOffline);
  });
});
