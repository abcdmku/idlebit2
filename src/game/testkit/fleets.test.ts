import { advanceGame, advanceGameOwned } from '../core/advance';
import { G } from '../core/buffers';
import { MAX_SYSTEMS, RACKS_PER_ROOM, SERVERS_PER_RACK } from '../core/constants';
import { MODE } from '../core/timers';
import { commitWorld, openWorld } from '../core/world';
import { deriveUnlocks } from '../build/research/effects';
import { RESEARCH } from '../build/research/tree';
import { endRound } from '../market/rounds';
import { slaValue } from '../core/sla';
import { buildState } from './builders';
import { FLEETS, FLEET_MARKET_INTENSITY, FLEET_WARMUP_TICKS } from './fleets';

describe('testkit fleets', () => {
  it('builds fleetMax at the caps with consistent topology', () => {
    const s = FLEETS.fleetMax();
    expect(s.build.systems.length).toBe(MAX_SYSTEMS);
    expect([s.build.racks.length, s.build.rooms.length, s.build.sites.length]).toEqual([576, 24, 8]);
    const c = s.compiled;
    expect([c.sys.len, c.rack.len, c.room.len, c.site.len]).toEqual([6912, 576, 24, 8]);
    expect(s.hot.sys.len).toBe(6912);
    const last = 6911;
    expect([c.sys.rack[last], c.sys.room[last], c.sys.site[last], c.sys.slot[last]]).toEqual([575, 23, 7, 11]);
    expect(c.rack.servers[575 * SERVERS_PER_RACK + 11]).toBe(last);
    expect(c.room.racks[23 * RACKS_PER_ROOM + 23]).toBe(575);
    expect(c.site.region[7]).toBe(7);
    expect(c.global.exists[0]).toBe(1);
    expect(s.hot.sys.mode.subarray(0, 6912).every((m) => m === MODE.onMarket || m === MODE.asleep)).toBe(true);
    expect(s.research.unlocks.levels.global).toBe(true);
    expect(s.build.systems[0]!.spec.cpuCount).toBe(2);
    expect(s.build.systems[0]!.spec).toBe(s.build.systems[6911]!.spec);
    expect(s.clock.tick).toBe(FLEET_WARMUP_TICKS);
    expect(s.market.intensity).toBeGreaterThan(FLEET_MARKET_INTENSITY);
    expect(s.round).toMatchObject({ phase: 'running', index: 1, autoReturnOn: true, reports: [] });
    expect(s.hot.g[G.met]).toBeGreaterThan(0);
    expect(s.hot.g[G.failed]).toBe(0);
    expect(s.hot.g[G.recUsed]).toBeGreaterThan(0);
    expect(slaValue(s.hot.g[G.deliveredWork]!, s.hot.g[G.failedWork]!, s.round.grace)).toBeGreaterThan(0.8);
    expect(s.hot.rack.tempF.subarray(0, c.rack.len).every((f) => f < 100)).toBe(true);
    expect(s.hot.room.tempF.subarray(0, c.room.len).every((f) => f < 100)).toBe(true);
    for (const usage of [s.hot.sys.psuUsage, s.hot.rack.pduUsage, s.hot.room.upsUsage, s.hot.site.gridUsage]) {
      expect(usage.every((value) => value < 1)).toBe(true);
    }
    const delay = deriveUnlocks(RESEARCH.map((node) => node.id)).autoReturnDelayTicks;
    expect(s.research.unlocks.autoReturnDelayTicks).toBe(delay);
    const w = openWorld(s);
    endRound(w);
    const ended = commitWorld(s, w, 0);
    expect(ended.round.autoReturnTick).toBe(ended.round.endTick! + delay);
    const rejoined = advanceGameOwned(ended, (delay + 2) * 100).state;
    expect(rejoined.round).toMatchObject({ phase: 'running', index: 2, autoReturnTick: null });
  // 600 warm-up ticks of real work at the fixture intensity (D10: the fleet pulls continuously).
  }, 60_000);

  it('builds fleetMaxHot with undersized rack infra and advances it', () => {
    const s = FLEETS.fleetMaxHot();
    expect(s.build.racks[0]!.pdu.gen).toBe(0);
    expect(advanceGame(s, 100).state.clock.tick).toBe(1);
  });

  it('builds the smaller named fleets', () => {
    expect(FLEETS.boot().build.systems.length).toBe(1);
    const rack = FLEETS.rackFull();
    expect(rack.build.systems.length).toBe(12);
    expect(rack.build.racks[0]!.opened).toBe(true);
    expect(rack.build.rooms[0]!.opened).toBe(false);
    expect(FLEETS.roomFull().build.racks.length).toBe(24);
  });

  it('clamps any spec to the caps', () => {
    const s = buildState({ sites: 99, zonesPerSite: 9, racksPerZone: 99, serversPerRack: 99 });
    expect(s.build.systems.length).toBe(MAX_SYSTEMS);
  });

  it('starts between rounds when asked, with systems paused', () => {
    const s = buildState({ sites: 1, zonesPerSite: 1, racksPerZone: 1, serversPerRack: 3, round: 'between' });
    expect([...s.hot.sys.mode.subarray(0, 3)]).toEqual([MODE.paused, MODE.paused, MODE.paused]);
  });
});
