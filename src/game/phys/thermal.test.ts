import { describe, expect, it, vi } from 'vitest';
import { MODE } from '../core/timers';
import { killSubtree } from '../exec';
import { efficiency } from './efficiency';
import { physState, physTicks, physWorld } from './testWorld';
import { coolerWatts, lumpEquilibrium, lumpStep } from './thermal';

// Phys fixtures set every compiled column phys reads; keep them independent of catalog balance (S5).
vi.mock('../build/compile', () => ({ compileUnits: () => undefined }));

vi.mock('../exec', async (importOriginal) => ({ ...(await importOriginal<typeof import('../exec')>()), killSubtree: vi.fn() }));

describe('e(T) (spec §10.4)', () => {
  it('is flat 70–80 °F, falls 2.5%/°F above, rises 0.5%/°F below to 1.10 at 50 °F', () => {
    expect([40, 50, 60, 70, 75, 80, 90, 100, 120].map(efficiency)).toEqual([1.1, 1.1, 1.05, 1, 1, 1, 0.75, 0.5, 0.25]);
  });
});

/** Ticks for an idle lump at 100 °F, cooler at full duty, to fall to 85 °F (Teq ≈ 51.8 °F). */
const halfLife = (tau: number) => {
  let t = 100, ticks = 0;
  while (t > 85) { t = lumpStep(t, 0, 1000, 1, 0.1, tau, 70).next; ticks += 1; }
  return ticks;
};

describe('lump equation (spec §10.5)', () => {
  it('a cooler rated for the load holds the rack at room temperature', () => {
    expect(lumpEquilibrium(1000, 1000, 1, 0.1, 70)).toBeCloseTo(70);
  });
  it('twice the capacity over-cools to about 60 °F', () => {
    expect(lumpEquilibrium(500, 1000, 1, 0.1, 70)).toBeCloseTo(60.91, 2);
  });
  it('water τ = air τ / 10: it settles ten times faster', () => {
    expect(halfLife(60)).toBe(224);
    expect(halfLife(6)).toBe(23);
  });
  it('snaps to equilibrium within 0.05 °F and then holds still', () => {
    const s = lumpStep(70.04, 1000, 1000, 1, 0.1, 60, 70);
    expect(s.next).toBe(s.teq);
    expect(lumpStep(s.next, 1000, 1000, 1, 0.1, 60, 70).next).toBe(s.next);
  });
  it('never goes below the 50 °F floor', () => {
    expect(lumpStep(51, 0, 1e6, 1, 0, 0.01, 52).next).toBe(50);
  });
  it('over-cooling costs watts: lift grows below 70 °F', () => {
    expect(coolerWatts(1, 10, 1, 70)).toBe(11);
    expect(coolerWatts(1, 10, 1, 60)).toBeCloseTo(14);
  });
});

/** One room (2 racks so Room is open), rack 0 heated by its two servers. */
function heatedRoom(serverW: number, rackQc: number) {
  return physState({ racksPerZone: 2, serversPerRack: 2 }, (c) => {
    c.sys.idleW[0] = serverW; c.sys.idleW[4] = serverW;
    c.rack.coolerQc[0] = rackQc; c.rack.coolerLoadW[0] = rackQc / 10; c.rack.coolerTau[0] = 6;
    c.rack.coolerQc[1] = rackQc;
    c.room.coolerQc[0] = rackQc; c.room.coolerTau[0] = 30;
  });
}

describe('rack and room lumps', () => {
  it('heat flows from rack to room, and the rack cooler watts heat the room', () => {
    const w = physWorld(heatedRoom(600, 1000));
    physTicks(w, 3000);
    expect(w.hot.rack.tempF[0]).toBeGreaterThan(w.hot.room.tempF[0]!);
    expect(w.hot.room.tempF[0]).toBeGreaterThan(70);
    expect(w.hot.rack.coolerW[0]).toBeGreaterThan(0);
    expect(w.hot.rack.tempF[0]).toBeLessThan(80);
    expect(w.hot.rack.tempF[1]).toBeCloseTo(w.hot.room.tempF[0]!, 0);
  });

  it('a variable-speed cooler holds its setpoint at lower duty and fewer watts', () => {
    const flat = physWorld(heatedRoom(250, 1000));
    physTicks(flat, 3000);
    const held = physWorld(heatedRoom(250, 1000));
    held.research.unlocks = { ...held.research.unlocks, rules: ['rackSetpoint'] };
    physTicks(held, 3000);
    expect(flat.hot.rack.coolerDuty[0]).toBe(1);
    expect(flat.hot.rack.tempF[0]).toBeLessThan(65);
    expect(held.hot.rack.coolerDuty[0]).toBeLessThan(1);
    expect(held.hot.rack.tempF[0]).toBeCloseTo(70, 1);
    expect(held.hot.rack.coolerW[0]).toBeLessThan(flat.hot.rack.coolerW[0]!);
  });

  it('70/80/100 °F: full speed to 80, half at 100, crash after 10 s at 100 °F, recovery below 90', () => {
    const w = physWorld(heatedRoom(600, 100));
    vi.mocked(killSubtree).mockClear();
    let crashedAt = -1;
    physTicks(w, 3000, (x) => {
      if (crashedAt < 0 && x.hot.rack.crashed[0] === 1) crashedAt = x.tick;
    });
    expect(crashedAt).toBeGreaterThan(0);
    expect(killSubtree).toHaveBeenCalledWith(expect.anything(), { kind: 'rack', id: 0 }, 'heat');
    const crash = w.events.entries.find((e) => e.kind === 'crashed');
    const back = w.events.entries.find((e) => e.kind === 'recovered');
    expect(crash).toBeDefined();
    expect(back).toBeDefined();
    expect(back!.tick - crash!.tick).toBeGreaterThanOrEqual(100);
  });

  it('crashes exactly 10 s after first reaching 100 °F', () => {
    const w = physWorld(heatedRoom(0, 100));
    w.hot.rack.tempF[0] = 120;
    w.compiled.rack.coolerQc[0] = 0;
    physTicks(w, 99);
    expect(w.hot.rack.crashed[0]).toBe(0);
    expect(w.hot.rack.eff[0]).toBe(0.25);
    physTicks(w, 1);
    expect(w.hot.rack.crashed[0]).toBe(1);
    expect([w.hot.sys.mode[0], w.hot.sys.mode[1]]).toEqual([MODE.crashed, MODE.crashed]);
  });

  it('lower efficiency makes more heat for the same draw', () => {
    const w = physWorld(heatedRoom(100, 1000));
    w.hot.rack.eff[0] = 0.5;
    physTicks(w, 1);
    expect(w.hot.rack.heatW[0]).toBeCloseTo(400);
  });
});
