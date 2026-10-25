import { afterEach, describe, expect, it } from 'vitest';
import { G, LOC } from '../core/buffers';
import { barebonesSystem } from '../core/defaults';
import { addSibling, allocRecord, poolDebug } from '../core/pool';
import { openWorld } from '../core/world';
import { FAMILIES } from '../market/families';
import { arrived } from '../net/links';
import { addTransit } from '../net/fifo';
import { openParent } from '../net/hops';
import { buildState } from '../testkit/builders';
import { admitPhase } from './admit';
import { reserve } from './slots';

/**
 * Regression (seed 42 at Rack, 25 Oct): two shards of one split task arrive on the same tick and the
 * first delivered one misroutes. Failing the task aborts its siblings, including the other arrival;
 * admit then delivered that freed record and freed it a second time. The free list looped, a parent's
 * sibling list kept a freed record, and the next failParent spun forever (the campaign hung at 7.95 h).
 */
afterEach(() => { poolDebug.verify = false; arrived.length = 0; });

describe('admit after a sibling abort', () => {
  it('never delivers or frees an aborted arrival', () => {
    poolDebug.verify = true;
    // Two servers on an opened rack: system 0 has no GPU, system 1 has one.
    const state = buildState({
      seed: 42, sites: 1, zonesPerSite: 1, racksPerZone: 1, serversPerRack: 2, unlocks: 'max',
      system: (id, rack, slot) => {
        const bare = barebonesSystem(id, rack, slot, 1);
        return { ...bare, spec: { ...bare.spec, accels: slot === 1 ? [{ kind: 'gpu' as const, model: '1330' as const, upgrades: 0 }] : [] } };
      },
      rack: (r) => ({ ...r, opened: true }),
    });
    const w = openWorld(state);
    // Without checkpointing a lost shard fails its whole task at once (with it, the shard waits for a replacement).
    w.research.unlocks = { ...w.research.unlocks, rules: w.research.unlocks.rules.filter((r) => r !== 'checkpointing') };
    const family = FAMILIES.findIndex((f) => f.key === 'imageBlur');
    const p = openParent(w, 7, family, 128, w.tick, -1);
    const shards = [0, 1].map((s) => {
      const r = allocRecord(w.hot), rec = w.hot.rec;
      rec.family[r] = family; rec.count[r] = 1; rec.units[r] = 64; rec.taskId[r] = 7; rec.shard[r] = s;
      addSibling(w.hot, p, r);
      w.hot.parent.placed[p] = w.hot.parent.placed[p]! + 1;
      // Both shards land on system 0 (no GPU), so each delivery would misroute.
      reserve(w, 0, 1, r);
      rec.target[r] = 0; rec.loc[r] = LOC.link; rec.owner[r] = -1;
      addTransit(w.hot, 1);
      arrived.push(r);
      return r;
    });
    const used = w.hot.g[G.recUsed]!;
    admitPhase(w);
    // The first shard misroutes: the task fails once, the second shard is aborted, and nothing is freed twice.
    expect(w.hot.g[G.recUsed]).toBe(used - 2);
    expect(shards.map((r) => w.hot.rec.count[r])).toEqual([0, 0]);
    expect([w.hot.sys.queueLen[0], w.hot.sys.queueLen[1], w.hot.sys.reserved[0], w.hot.sys.reserved[1]]).toEqual([0, 0, 0, 0]);
    expect(arrived).toHaveLength(0);
    const free: number[] = [];
    for (let r = w.hot.g[G.recFree]!; r >= 0 && free.length < 1000; r = w.hot.rec.next[r]!) free.push(r);
    expect(new Set(free).size).toBe(free.length);
  });
});
