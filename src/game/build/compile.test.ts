import { advanceGame } from '../core/advance';
import { createInitialState } from '../core/state';
import { FLEETS } from '../testkit/fleets';

// Top-hardware fixtures do 600 warm-up ticks of real work under D10 (the fleet pulls continuously).
vi.setConfig({ testTimeout: 60_000 });

describe('compile', () => {
  it('boots: createInitialState(42) compiles and advances 10 s', () => {
    const state = createInitialState(42);
    const { state: after } = advanceGame(state, 10_000);
    expect(after.clock.tick).toBe(100);
    const c = state.compiled.sys;
    // Boot system: one Hz core at L1 (1 lane) on a 1 Hz clock, 1 bit of L1, no scheduler.
    expect([c.cores[0], c.threads[0], c.sockets[0], c.K[0], c.Q[0], c.keff[0], c.slots[0]]).toEqual([1, 1, 1, 1, 0, 1, 1]);
    expect([c.threadRate[0], c.clockHz[0], c.cacheBits[0], c.memCap[0], c.hasRam[0], c.etaCfg[0]]).toEqual([1, 1, 1, 1, 0, 1]);
    // Bench PSU: 32768 W, 30% loss at L1.
    expect([c.psuCapW[0], c.psuLoss[0]]).toEqual([32768, 0.3]);
    // Core is a rate part at native: idle 0.1 × 1 W/op/s × 1, load 1 W at full use.
    expect([c.coreIdleW[0], c.coreLoadW[0]]).toEqual([0.1, 1]);
  });

  it('a hidden bench rack has no ports or links', () => {
    const c = createInitialState(42).compiled;
    expect([c.rack.ports[0], c.rack.uplinks[0], c.sys.port[0], c.link.len]).toEqual([0, 0, -1, 0]);
  });

  it('rackFull: 12 servers get ports 0–11 on server links, plus one rack link', () => {
    const c = FLEETS.rackFull().compiled;
    expect(Array.from(c.sys.port.subarray(0, 12))).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(c.rack.ports[0]).toBe(12);
    expect(c.link.len).toBe(13);
    expect(c.link.speed[0]).toBe(1e10); // k = 21 → 10 GHz
  });

  it('fleetMax compiles every system and link', () => {
    const c = FLEETS.fleetMax().compiled;
    expect(c.sys.len).toBe(6912);
    // 576 racks × (12 server links + 1 rack link) + 24 zone links + 7 backbone links.
    expect(c.link.len).toBe(576 * 13 + 24 + 7);
  });
});
