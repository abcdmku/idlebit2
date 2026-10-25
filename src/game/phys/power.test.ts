import { describe, expect, it, vi } from 'vitest';
import { MODE } from '../core/timers';
import { killSubtree } from '../exec';
import { physState, physTicks, physWorld } from './testWorld';
import { wakeSystem } from './power';
import type { RuleId } from '../types/catalog';
import type { World } from '../core/world';

// Phys fixtures set every compiled column phys reads; keep them independent of catalog balance (S5).
vi.mock('../build/compile', () => ({ compileUnits: () => undefined }));

vi.mock('../exec', async (importOriginal) => ({ ...(await importOriginal<typeof import('../exec')>()), killSubtree: vi.fn() }));

const withRules = (w: World, rules: RuleId[]) => { w.research.unlocks = { ...w.research.unlocks, rules }; return w; };

describe('regions and the energy bill (spec §3.3, §9.6)', () => {
  it('each site bills its top-level input at its own region; utility bills at the gateway', () => {
    const w = physWorld(physState({ sites: 3, zonesPerSite: 1, racksPerZone: 1, serversPerRack: 1 }, (c) => {
      for (let s = 0; s < 3; s += 1) { c.sys.idleW[s * 4] = 10 * (s + 1); c.site.gridCapW[s] = 1000; c.site.gridLoss[s] = 0.1; }
    }));
    physTicks(w, 1, (x) => {
      // us-east, us-west, eu-west: 10, 20, 30 W plus 10% grid loss.
      expect([...x.hot.bill.slice(0, 4)].map((v) => Math.round(v * 1000) / 1000)).toEqual([11, 22, 33, 0]);
    });
  });
});

describe('zone UPS and dual feed (spec §9.2)', () => {
  const room = (ups: number) => physState({ racksPerZone: 2, serversPerRack: 1, room: (r) => ({ ...r, ups: Array(ups).fill({ gen: 0, level: 1, capped: false }) }) }, (c) => {
    c.sys.idleW[0] = 60; c.sys.idleW[4] = 60;
    c.room.upsCapW[0] = 100; c.room.upsCapW[1] = 100;
  });

  it('one UPS over capacity fails the zone after 10 s', () => {
    const w = physWorld(room(1));
    vi.mocked(killSubtree).mockClear();
    physTicks(w, 100);
    expect(killSubtree).toHaveBeenCalledWith(w, { kind: 'room', id: 0 }, 'power');
    expect([w.hot.sys.mode[0], w.hot.sys.mode[1]]).toEqual([MODE.dark, MODE.dark]);
  });

  it('two UPSs share the load; if one fails the other carries it', () => {
    const w = withRules(physWorld(room(2)), ['dualFeed']);
    physTicks(w, 1);
    expect([w.hot.room.upsUsage[0], w.hot.room.upsUsage[1]]).toEqual([0.6, 0.6]);
    w.hot.room.upsFailed[0] = 1; w.hot.room.upsRebootTicks[0] = 100;
    physTicks(w, 1);
    expect(w.hot.room.upsUsage[1]).toBe(1.2);
    expect(w.hot.sys.mode[0]).toBe(MODE.onMarket);
  });
});

describe('grid feed and ride-through (spec §9.4)', () => {
  const site = (upsGen: number) => physState({ sites: 1, zonesPerSite: 2, racksPerZone: 1, serversPerRack: 1,
    room: (r) => ({ ...r, ups: [{ gen: upsGen, level: 1, capped: false }] }) }, (c) => {
    c.sys.idleW[0] = 600; c.sys.idleW[4] = 600; c.site.gridCapW[0] = 1000;
  });

  it('a failed grid darkens every zone of the site', () => {
    const w = physWorld(site(0));
    physTicks(w, 100);
    expect(w.hot.site.gridFailed[0]).toBe(1);
    expect([w.hot.sys.mode[0], w.hot.sys.mode[1]]).toEqual([MODE.dark, MODE.dark]);
    physTicks(w, 100);
    expect(w.hot.sys.mode[0]).toBe(MODE.onMarket);
  });

  it('gen 2 UPSs ride through a 10 s grid reboot on battery and lose nothing', () => {
    const w = withRules(physWorld(site(2)), ['upsRideThrough']);
    vi.mocked(killSubtree).mockClear();
    physTicks(w, 100);
    expect(w.hot.site.gridFailed[0]).toBe(1);
    expect(w.hot.room.rideTicks[0]).toBe(300);
    expect(w.hot.sys.mode[0]).toBe(MODE.onMarket);
    // Battery time is billed as normal.
    physTicks(w, 1, (x) => expect(x.hot.bill[0]).toBe(1200));
    // The grid overloads again as soon as it is back, but nothing was killed by the first failure.
    expect(killSubtree).not.toHaveBeenCalled();
  });
});

describe('S3 sleep (spec §9.3)', () => {
  it('an empty server sleeps after 10 s at 0.03× idle and wakes 2 s after a route', () => {
    const w = withRules(physWorld(physState({ serversPerRack: 2 }, (c) => { c.sys.idleW[0] = 10; })), ['s3Sleep']);
    physTicks(w, 101);
    expect(w.hot.sys.mode[0]).toBe(MODE.asleep);
    physTicks(w, 1);
    expect(w.hot.sys.drawW[0]).toBeCloseTo(0.3);
    wakeSystem(w, 0);
    physTicks(w, 19);
    expect(w.hot.sys.mode[0]).toBe(MODE.asleep);
    physTicks(w, 1);
    expect(w.hot.sys.mode[0]).toBe(MODE.onMarket);
  });

  it('a lone system before Rack never sleeps', () => {
    const w = withRules(physWorld(physState({}, (c) => { c.sys.idleW[0] = 10; })), ['s3Sleep']);
    physTicks(w, 300);
    expect(w.hot.sys.mode[0]).toBe(MODE.onMarket);
  });
});

describe('economizer (spec §10.5)', () => {
  it('cuts room cooling watts to 0.1× while the room is 5 °F above outside air', () => {
    const make = (rules: RuleId[]) => {
      const w = withRules(physWorld(physState({ racksPerZone: 2, serversPerRack: 1 }, (c) => {
        c.sys.idleW[0] = 100; c.room.coolerQc[0] = 1000; c.room.coolerIdleW[0] = 1; c.room.coolerLoadW[0] = 10;
      })), rules);
      w.hot.room.tempF[0] = 80;
      physTicks(w, 1);
      return w.hot.room.coolerW[0]!;
    };
    expect(make([])).toBe(11);
    expect(make(['economizer'])).toBeCloseTo(1.1);
  });
});
