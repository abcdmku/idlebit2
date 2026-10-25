import { describe, expect, it } from 'vitest';
import { advanceGame, advanceGameOwned, copyOfflineState } from '../core/advance';
import { FAMILIES } from '../market/families';
import { HUGE_CAPS, marketState, type Caps } from '../market/testState';
import { familyId, rackId, roomId, systemId } from '../types/ids';
import type { GlobalSnapshot, RackSnapshot, RenderSnapshot, RoomSnapshot, SnapshotScope, SystemSnapshot } from '../types/snapshot';
import type { GameState } from '../types/state';
import type { TransferView } from '../types/views';
import { deriveRenderSnapshot } from './snapshot';

/**
 * One site, two zones of one rack each, two servers per rack, 10 kHz uplinks: a 4,000-unit Monte
 * Carlo head (grain 16) splits into 4 shards of 1,000, two per zone, one per server. At 500 ops/s
 * per thread its 24,000 ops are 6 s of a server's work, above the split floor's 4 s (D25.11).
 */
function splitFixture(caps: Caps = { ...HUGE_CAPS, threadRate: 500 }): { state: GameState; taskId: number } {
  const slow = <T extends { switch: { uplinks: readonly number[] } }>(u: T): T => ({ ...u, switch: { ...u.switch, uplinks: [3] } });
  const s = marketState(caps, { zonesPerSite: 2, racksPerZone: 1, serversPerRack: 2, rack: slow, room: slow });
  const taskId = s.market.window[0]!.taskId;
  const family = familyId(FAMILIES.findIndex((f) => f.key === 'monteCarlo'));
  return { state: { ...s, market: { ...s.market, window: [{ taskId, family, size: 4000, deadline: null }, ...s.market.window.slice(1)] } }, taskId };
}

const view = (state: GameState, focus: SnapshotScope['focus'], prev?: RenderSnapshot) => deriveRenderSnapshot(state, { focus, partner: null }, prev);
const of = (flows: readonly TransferView[], taskId: number) => flows.filter((f) => f.taskId === taskId);
const brief = (f: TransferView) => ({ link: f.link, shard: f.shard, shards: f.shards, units: f.units, to: f.to, from: f.from });

describe('D25 level flows', () => {
  it('shows each shard on the links of every level, with the node it enters', () => {
    const { state: s0, taskId } = splitFixture();
    let s = advanceGame(s0, 200).state;
    const global = view(s, { level: 'global', id: 0 }).focus as GlobalSnapshot;
    // The gateway site's zone links are the first links from the market.
    expect(of(global.flows, taskId).map(brief)).toEqual([
      { link: 'zone', shard: 0, shards: 4, units: 1000, to: { level: 'room', id: 0 }, from: null },
      { link: 'zone', shard: 1, shards: 4, units: 1000, to: { level: 'room', id: 0 }, from: null },
      { link: 'zone', shard: 2, shards: 4, units: 1000, to: { level: 'room', id: 1 }, from: null },
      { link: 'zone', shard: 3, shards: 4, units: 1000, to: { level: 'room', id: 1 }, from: null },
    ]);
    const keys = of(global.flows, taskId).map((f) => f.key);
    expect(new Set(keys).size).toBe(4);
    // The zone link carries its two shards in turn: one sending, one waiting at its mouth.
    const room = of((view(s, { level: 'room', id: roomId(0) }).focus as RoomSnapshot).flows, taskId);
    expect(room.map((f) => [f.link, f.shard, f.bitsSent > 0])).toEqual([['zone', 0, true], ['zone', 1, false]]);

    // Advance until shard 0 is on a port and shard 1 crosses the rack uplink.
    let rack: TransferView[] = [];
    for (let t = 0; t < 100 && !(rack.some((f) => f.link === 'uplink') && rack.some((f) => f.link === 'server')); t += 1) {
      s = advanceGame(s, 100).state;
      rack = of((view(s, { level: 'rack', id: rackId(0) }).focus as RackSnapshot).flows, taskId);
    }
    expect(rack.map(brief)).toEqual([
      { link: 'uplink', shard: 1, shards: 4, units: 1000, to: { level: 'rack', id: 0 }, from: { level: 'room', id: 0 } },
      { link: 'server', shard: 0, shards: 4, units: 1000, to: { level: 'system', id: 0 }, from: { level: 'rack', id: 0 } },
    ]);
    const roomNow = of((view(s, { level: 'room', id: roomId(0) }).focus as RoomSnapshot).flows, taskId);
    expect(roomNow.map((f) => [f.link, f.shard, f.to])).toEqual([['rack', 1, { level: 'rack', id: 0 }]]);
    // A shard keeps its key across links and levels; the system's inbound is its port's shard.
    expect(roomNow[0]!.key).toBe(keys[1]);
    expect(rack[0]!.key).toBe(keys[1]);
    const sys = view(s, { level: 'system', id: systemId(0) }).focus as SystemSnapshot;
    expect(sys.inbound && brief(sys.inbound)).toEqual(brief(rack[1]!));
    expect(sys.inbound?.key).toBe(keys[0]);
  });

  it('draws a running shard on its threads and its cores as one group', () => {
    // 100 ops/s per thread: a 6,000-op shard runs for seconds, so it is seen running.
    const { state: s0, taskId } = splitFixture({ ...HUGE_CAPS, threadRate: 100 });
    let s = s0, sys: SystemSnapshot | null = null;
    for (let t = 0; t < 200 && !sys?.running.some((r) => r.taskId === taskId); t += 1) {
      s = advanceGame(s, 100).state;
      sys = view(s, { level: 'system', id: systemId(0) }).focus as SystemSnapshot;
    }
    const task = sys!.running.find((r) => r.taskId === taskId)!;
    expect([task.shard, task.shards, task.units, task.size]).toEqual([0, 4, 1000, 4000]);
    expect(task.threads).toBeGreaterThan(0);
    const cores = sys!.chip.cores.filter((c) => c.taskId === taskId);
    expect(cores.length).toBeGreaterThan(0);
    for (const c of cores) expect([c.shard, c.shardThreads]).toEqual([0, task.threads]);
  });
});

describe('D25 shard completions', () => {
  it('marks non-final shards done without pay and the task met once, at its last shard', () => {
    const { state: s0, taskId } = splitFixture();
    let s = s0, prev: RenderSnapshot | undefined = view(s, { level: 'rack', id: rackId(0) });
    const done: { seq: number; shard: number; tick: number }[] = [], met: { shards: number; credits: number; tick: number }[] = [];
    for (let t = 0; t < 300 && met.length === 0; t += 1) {
      s = advanceGame(s, 100).state;
      prev = view(s, { level: 'rack', id: rackId(0) }, prev);
      for (const d of prev.shardsDone) if (d.taskId === taskId) done.push({ seq: d.seq, shard: d.shard, tick: d.tick });
      for (const c of prev.completions) if (c.taskId === taskId) met.push({ shards: c.shards, credits: c.credits, tick: c.tick });
    }
    // Three shards finish without pay; the fourth meets the task with its full payout.
    expect(done).toHaveLength(3);
    expect(new Set(done.map((d) => d.seq)).size).toBe(3);
    const last = [0, 1, 2, 3].find((i) => !done.some((d) => d.shard === i));
    expect(new Set(done.map((d) => d.shard)).size).toBe(3);
    expect(last).toBeDefined();
    expect(met).toEqual([{ shards: 4, credits: 6 * 4000, tick: met[0]!.tick }]);
    expect(Math.max(...done.map((d) => d.tick))).toBeLessThanOrEqual(met[0]!.tick);
    // Chained snapshots never repeat a mark.
    for (let t = 0; t < 5; t += 1) { s = advanceGame(s, 100).state; prev = view(s, { level: 'rack', id: rackId(0) }, prev); }
    expect(prev.shardsDone.filter((d) => d.taskId === taskId)).toEqual([]);
  });

  it('records no shard marks during an offline catch-up', () => {
    const { state: s0, taskId } = splitFixture();
    view(s0, { level: 'rack', id: rackId(0) });
    const offline = advanceGameOwned(copyOfflineState(s0), 30_000).state;
    expect(offline.hot.parent.len).toBeGreaterThan(0);
    expect(view(offline, { level: 'rack', id: rackId(0) }).shardsDone.filter((d) => d.taskId === taskId)).toEqual([]);
  });
});
