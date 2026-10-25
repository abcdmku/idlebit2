import { describe, expect, it, vi } from 'vitest';
import { G, LOC, type CompiledBuffers } from '../core/buffers';
import { completionLog, readCompletions } from '../core/completions';
import { readFailures } from '../core/failures';
import { ledgerPhase } from '../core/ledger';
import { rqAt, rqLen, rqRow } from '../core/routerQueue';
import { openWorld, type World } from '../core/world';
import { CAUSE } from '../exec/outcome';
import { F } from '../exec/testFamilies';
import { execState, failedOf, feed, metOf, step, steps, type Caps } from '../exec/testWorld';
import type { FleetSpec } from '../testkit/builders';
import { FILTER_BIT } from './filters';

vi.mock('../market/families', async (orig) => ({ ...(await orig<object>()), FAMILIES: (await import('../exec/testFamilies')).TEST_FAMILIES }));

/** Every link fast enough that a transfer's bits take no time (only link latency remains). */
const fastLinks = (c: CompiledBuffers) => { for (let l = 0; l < c.link.len; l += 1) c.link.speed[l] = 1e15; };

/** A world over `spec` with `caps` on every server, fast links and a completion and failure log. */
function world(spec: Partial<FleetSpec>, caps: Partial<Caps>, edit?: (c: CompiledBuffers) => void): World {
  const w = openWorld(execState(spec, caps, (c) => { fastLinks(c); edit?.(c); }));
  readCompletions(w.hot);
  w.completions = completionLog(w.hot);
  readFailures(w.hot);
  return w;
}

/** A rack of n servers, a port each, first fit. */
const rack = (n: number, caps: Partial<Caps> = {}, edit?: (c: CompiledBuffers) => void): World => world({
  serversPerRack: n,
  rack: (r) => ({ ...r, switch: { ...r.switch, ports: Array(n).fill(r.switch.ports[0] ?? 0) } }),
}, caps, edit);

/** Live records of split tasks as [system, units], by system. */
function shards(w: World): [number, number][] {
  const rec = w.hot.rec, out: [number, number][] = [];
  for (let r = 0; r < rec.len; r += 1) {
    if (rec.loc[r] === LOC.free || rec.count[r] === 0 || rec.parent[r]! < 0) continue;
    out.push([rec.loc[r] === LOC.link ? rec.target[r]! : rec.owner[r]!, rec.units[r]!]);
  }
  return out.sort((a, b) => a[0] - b[0]);
}

/** Task IDs of the live records headed for or held by system s. */
function tasksOn(w: World, s: number): number[] {
  const rec = w.hot.rec, out: number[] = [];
  for (let r = 0; r < rec.len; r += 1) {
    if (rec.loc[r] === LOC.free || rec.count[r] === 0) continue;
    if ((rec.loc[r] === LOC.link ? rec.target[r] : rec.owner[r]) === s) out.push(rec.taskId[r]!);
  }
  return out.sort((a, b) => a - b);
}

/** Task IDs in router (kind, id)'s queue, front first. */
function queue(w: World, kind = 0, id = 0): number[] {
  const row = rqRow(w.hot, kind, id);
  return Array.from({ length: rqLen(w.hot, row) }, (_, i) => w.hot.rq.rqTask[rqAt(w.hot, row, i)]!);
}

/** The tick on which `family`'s first task is met (stepping up to `limit` ticks), else -1. */
function metTick(w: World, family: number, limit: number): number {
  for (let i = 0; i < limit; i += 1) { step(w); if (metOf(w, family) > 0) return w.tick - 1; }
  return -1;
}

describe('divisible tasks (D25)', () => {
  it('splits a 4,000-unit task over a 4-server rack as 4 shards of 1,000 and pays W once, with the last shard', () => {
    const w = rack(4, { threadRate: 1000 }, (c) => { c.sys.threadRate[3] = 500; });
    feed(w, F.par, 1, 4000);
    step(w);
    expect(shards(w)).toEqual([[0, 1000], [1, 1000], [2, 1000], [3, 1000]]);
    const gross: bigint[] = [];
    steps(w, 30, () => { ledgerPhase(w); gross.push(w.ledger.callGross); });
    // Servers 0–2 finish their shards 10 ticks in and are paid nothing; server 3, at half speed, ends the task.
    expect(gross.indexOf(4000n)).toBe(20);
    expect(gross.slice(0, 20).every((g) => g === 0n)).toBe(true);
    expect(gross.at(-1)).toBe(4000n);
    expect(readCompletions(w.hot)).toMatchObject([{ taskId: 1, shards: 4, work: 4000, credits: 4000, system: 3, tick: 21 }]);
  });

  it('one shard that cannot run fails the whole task with its full work and frees its siblings', () => {
    const w = rack(4, { threadRate: 100, memCap: 1024 }, (c) => { c.sys.memCap[2] = 100; });
    feed(w, F.wide, 1, 3000);
    step(w);
    expect(shards(w)).toEqual([[0, 750], [1, 750], [2, 750], [3, 750]]);
    steps(w, 5, () => ledgerPhase(w));
    expect([failedOf(w, F.wide, CAUSE.misroute), w.hot.g[G.failWorkTick], w.ledger.callGross, metOf(w, F.wide)]).toEqual([1, 3000, 0n, 0]);
    expect(shards(w)).toEqual([]);
    expect([0, 1, 2, 3].map((s) => w.hot.sys.running[s]! + w.hot.sys.reserved[s]! + w.hot.sys.queueLen[s]!)).toEqual([0, 0, 0, 0]);
    expect(readFailures(w.hot)).toMatchObject([{ taskId: 1, family: F.wide, cause: 'misroute' }]);
  });

  it('a 1-slot LB queue takes the head when every server is busy and dispatches it FIFO; a full queue leaves the clock running', () => {
    const w = rack(2, { threadRate: 10 }, (c) => { c.rack.lbQueueSlots[0] = 1; });
    feed(w, F.cpu, 1, 10); feed(w, F.cpu, 1, 20); feed(w, F.cpu, 1, 10); feed(w, F.cpu, 1, 10);
    step(w);
    // Tasks 1 and 2 split straight to the servers; task 3 is taken into the queue (pickup); task 4 waits as the head.
    expect([tasksOn(w, 0), tasksOn(w, 1), queue(w), w.hot.g[G.taken], w.market.headTick]).toEqual([[1], [2], [3], 3, 0]);
    steps(w, 11);
    expect([queue(w), w.hot.g[G.taken], w.market.headTick, metOf(w, F.cpu)]).toEqual([[3], 3, 0, 1]);
    step(w);
    // Server 0 freed at tick 11: the queue front goes there, and the head is taken into the freed slot.
    expect([tasksOn(w, 0), queue(w), w.hot.g[G.taken], w.market.headTick]).toEqual([[3], [4], 4, 12]);
    steps(w, 10);
    expect([tasksOn(w, 1), queue(w)]).toEqual([[4], []]);
  });

  it('a members = 8 task waits until 8 servers have room, then places all 8 shards in one step', () => {
    const w = rack(8, { threadRate: 10 });
    feed(w, F.cpu, 1, 50);
    feed(w, F.gang8, 1, 8);
    const placed: number[] = [];
    steps(w, 60, () => placed.push(shards(w).length));
    const first = placed.indexOf(8);
    expect(first).toBe(53);
    expect(placed.slice(0, first).every((n) => n === 0)).toBe(true);
    expect(queue(w)).toEqual([]);
  });

  it('shard work finishes about twice as fast per doubling of servers', () => {
    const t = [1, 2, 4].map((n) => { const w = rack(n, { threadRate: 400 }); feed(w, F.par, 1, 4000); return metTick(w, F.par, 200); });
    // One server takes the head itself, with no rack links; behind the rack switch shards start 2 ticks later.
    expect(t).toEqual([100, 52, 26]);
  });

  it('never cuts a shard under 1 s of work at the fastest server (D25.11)', () => {
    const cut = (units: number) => { const w = rack(4, { threadRate: 1000 }); feed(w, F.cpu2, 1, units); step(w); return [shards(w), tasksOn(w, 0)]; };
    // 2.5 s of work at 1,000 ops/s: two shards, not four. 0.5 s: one whole task, no split.
    expect(cut(2500)).toEqual([[[0, 1250], [1, 1250]], [1]]);
    expect(cut(500)).toEqual([[], [1]]);
  });

  it('a share no server below its rack can ever hold fails (misroute) instead of blocking the rack queue', () => {
    const w = world({ racksPerZone: 2, serversPerRack: 1 }, { threadRate: 1, memCap: 64 }, (c) => {
      c.sys.memCap[1] = 2;
      c.rack.lbFilters[0] = FILTER_BIT.capability; c.rack.lbFilters[1] = FILTER_BIT.capability;
    });
    feed(w, F.wide, 1, 8);
    step(w);
    // Rack 1's server passes the capability filter at one grain, but its 4-unit share needs 4 bits of RAM.
    expect([shards(w), queue(w, 0, 1).length]).toEqual([[[0, 4]], 1]);
    step(w);
    expect([failedOf(w, F.wide, CAUSE.misroute), queue(w, 0, 1), shards(w)]).toEqual([1, [], []]);
    expect(readFailures(w.hot)).toMatchObject([{ taskId: 1, cause: 'misroute' }]);
  });
});
