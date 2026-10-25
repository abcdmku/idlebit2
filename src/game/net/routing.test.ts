import { describe, expect, it, vi } from 'vitest';
import type { CompiledBuffers } from '../core/buffers';
import { openWorld, type World } from '../core/world';
import { completionLog } from '../core/completions';
import { readFailures } from '../core/failures';
import { CAUSE } from '../exec/outcome';
import { F } from '../exec/testFamilies';
import { execState, failedOf, feed, metOf, setAccels, step, steps, type Caps } from '../exec/testWorld';
import { FAIL_DETAILS } from '../types/events';
import { FILTER_BIT } from './filters';

vi.mock('../market/families', async (orig) => ({ ...(await orig<object>()), FAMILIES: (await import('../exec/testFamilies')).TEST_FAMILIES }));

const S = { firstFit: 0, roundRobin: 1, leastConn: 2, weighted: 3, leastWork: 4, binPack: 5, latency: 6, price: 7, affinity: 8 } as const;

function rack(n: number, strategy: number, filters = 0, caps: Partial<Caps> = {}, edit?: (c: CompiledBuffers) => void): World {
  return openWorld(execState({ serversPerRack: n }, caps, (c) => {
    c.rack.lbStrategy[0] = strategy;
    c.rack.lbFilters[0] = filters;

    edit?.(c);
  }));
}

/** Feeds one task per tick and returns the server slot the rack LB picked each tick (-1 none). */
function routes(w: World, family: number, scale: number, ticks: number, gap = 1): number[] {
  const out: number[] = [];
  for (let i = 0; i < ticks; i += 1) { feed(w, family, 1, scale); step(w); out.push(w.hot.rack.lbLast[0]!); steps(w, gap - 1); }
  return out;
}

describe('rack load balancer strategies (spec §8.3): each differs from first-fit', () => {
  it('firstFit refills server 1 while it keeps up; roundRobin rotates', () => {
    expect(routes(rack(3, S.firstFit), F.cpu, 0.05, 6, 5)).toEqual([0, 0, 0, 0, 0, 0]);
    expect(routes(rack(3, S.roundRobin), F.cpu, 0.05, 6, 5)).toEqual([0, 1, 2, 0, 1, 2]);
  });

  it('firstFit sends overflow to the next free server only', () => {
    const w = rack(3, S.firstFit);
    feed(w, F.cpu, 3, 50);
    step(w);
    expect([0, 1, 2].map((s) => w.hot.sys.reserved[s])).toEqual([1, 1, 1]);
  });

  it('leastConn routes to the fewest admitted tasks', () => {
    const run = (strategy: number) => {
      const w = rack(2, strategy, 0, { K: 1, Q: 4 });
      feed(w, F.cpu, 1, 50); step(w);
      feed(w, F.cpu, 1, 50); step(w);
      feed(w, F.cpu, 1, 50); step(w);
      return [w.hot.rack.lbLast[0], w.hot.sys.reserved[0]! + w.hot.sys.queueLen[0]! + w.hot.sys.running[0]!];
    };
    expect(run(S.firstFit)).toEqual([0, 3]);
    expect(run(S.leastConn)).toEqual([0, 2]);
  });

  it('weighted splits a task in proportion to rated speed (D25.2)', () => {
    const shares = (strategy: number) => {
      const w = rack(2, strategy, 0, { K: 4, Q: 60, threads: 4 }, (c) => { c.sys.threadRate[1] = 3; });
      feed(w, F.cpu2, 1, 4000);
      step(w);
      const rec = w.hot.rec, out = [0, 0];
      for (let r = 0; r < rec.len; r += 1) if (rec.count[r] === 1 && rec.parent[r]! >= 0) out[rec.target[r]!]! += rec.units[r]!;
      return out;
    };
    expect(shares(S.weighted)).toEqual([1000, 3000]);
    expect(shares(S.roundRobin)).toEqual([2000, 2000]);
  });

  it('leastWork prefers the server that finishes first', () => {
    const pick = (strategy: number) => {
      const w = rack(2, strategy, 0, { K: 1, Q: 4 }, (c) => { c.sys.threadRate[1] = 10; });
      return routes(w, F.cpu, 5, 1)[0];
    };
    expect(pick(S.firstFit)).toBe(0);
    expect(pick(S.leastWork)).toBe(1);
  });

  it('leastWork counts running accelerator-list backlog', () => {
    const pick = (strategy: number) => {
      const w = rack(2, strategy, 0, { Q: 4 });
      feed(w, F.gpu, 1, 100); steps(w, 6);
      expect(w.hot.sys.running[0]).toBe(1);
      return routes(w, F.cpu, 1, 1)[0];
    };
    expect(pick(S.firstFit)).toBe(0);
    expect(pick(S.leastWork)).toBe(1);
  });

  it('binPack fills to the running limit, not the queue, and skips a supply over 90%', () => {
    const run = (strategy: number, usage: number) => {
      const w = rack(2, strategy, 0, { K: 1, Q: 4 });
      w.hot.sys.psuUsage[0] = usage;
      return routes(w, F.cpu, 50, 2);
    };
    expect(run(S.firstFit, 0)).toEqual([0, 0]);
    expect(run(S.binPack, 0)).toEqual([0, 1]);
    expect(run(S.binPack, 0.95)).toEqual([1, 0]);
  });

  it('affinity sends accelerator families to accelerator boards, general ones elsewhere (D7.7)', () => {
    const run = (strategy: number, filters: number) => {
      const w = rack(2, strategy, filters, { K: 2, Q: 4, threads: 2 }, (c) => { c.sys.board[1] = 1; });
      return [routes(w, F.gpu, 1, 1)[0], routes(w, F.cpu, 1, 1)[0]];
    };
    expect(run(S.firstFit, 0)).toEqual([0, 0]);
    expect(run(S.firstFit, FILTER_BIT.capability)).toEqual([0, 0]);
    expect(run(S.affinity, 0)).toEqual([1, 0]);
  });
});

describe('filters (spec §8.4)', () => {
  const eccRack = (filters: number) => rack(2, S.firstFit, filters, {}, (c) => { c.sys.ecc[1] = 1; });

  it('first-fit misroutes a task the server cannot run; capability routes it right', () => {
    const blind = eccRack(0);
    readFailures(blind.hot);
    blind.completions = completionLog(blind.hot);
    feed(blind, F.ecc, 1, 0.5);
    steps(blind, 20);
    expect(failedOf(blind, F.ecc, CAUSE.misroute)).toBe(1);
    expect(readFailures(blind.hot)).toMatchObject([{ taskId: 1, family: F.ecc, cause: 'misroute', tau: 0 }]);
    const aware = eccRack(FILTER_BIT.capability);
    feed(aware, F.ecc, 1, 0.5);
    steps(aware, 20);
    expect([failedOf(aware, F.ecc, CAUSE.misroute), metOf(aware, F.ecc)]).toEqual([0, 1]);
  });

  it('misroutes on the GPU-core gate with detail "gpuCores"', () => {
    const w = rack(2, S.firstFit, 0, {}, (c) => {
      // The fleet can run it, but blind first-fit still picks the one-core card in slot 0.
      setAccels(c, 1, [{ cores: 4, ops: 4, vram: 16 }]);
    });
    feed(w, F.gpu4, 1, 1);
    steps(w, 5);
    expect(failedOf(w, F.gpu4, CAUSE.misroute)).toBe(1);
    expect(FAIL_DETAILS[w.hot.fam.failDetail[F.gpu4 * 7 + CAUSE.misroute]!]).toBe('gpuCores');
  });

  it('capability filtering routes a whole cohort to real core capacity', () => {
    const run = (filters: number) => {
      const w = rack(2, S.firstFit, filters, { K: 2, Q: 4, threads: 2 }, (c) => {
        setAccels(c, 0, [{ cores: 1, ops: 1e6, vram: 16 }]);
        setAccels(c, 1, [{ cores: 4, ops: 4, vram: 16 }]);
      });
      readFailures(w.hot);
      w.completions = completionLog(w.hot);
      feed(w, F.gpu4, 3, 0.1); steps(w, 20);
      expect(readFailures(w.hot).map(f => f.taskId)).toEqual(filters ? [] : [1, 2, 3]);
      return [failedOf(w, F.gpu4, CAUSE.misroute), metOf(w, F.gpu4)];
    };
    expect(run(0)).toEqual([3, 0]);
    expect(run(FILTER_BIT.capability)).toEqual([0, 3]);
  });

  it('capability filtering preserves paired core and VRAM gates, while link makes the first target valid', () => {
    const run = (filters: number, linked: boolean) => {
      const w = rack(2, S.firstFit, filters, {}, (c) => {
        setAccels(c, 0, [{ cores: 4, ops: 4, vram: 1 }, { cores: 1, ops: 1000, vram: 16 }], linked);
        setAccels(c, 1, [{ cores: 4, ops: 4, vram: 16 }]);
      });
      feed(w, F.tensorCores, 1, 0.1); step(w);
      const picked = w.hot.rack.lbLast[0];
      steps(w, 19);
      return [picked, failedOf(w, F.tensorCores, CAUSE.misroute), metOf(w, F.tensorCores)];
    };
    expect(run(0, false)).toEqual([0, 1, 0]);
    expect(run(FILTER_BIT.capability, false)).toEqual([1, 0, 1]);
    expect(run(FILTER_BIT.capability, true)).toEqual([0, 0, 1]);
  });

  it('keeps NPU memory out of ordinary GPU routing', () => {
    const w = rack(2, S.firstFit, FILTER_BIT.capability, {}, (c) => {
      setAccels(c, 0, [{ cores: 4, ops: 1e6, vram: 1 }, { kind: 'npu', cores: 0, ops: 0, tensorOps: 1e9, vram: 1024 }], true);
      setAccels(c, 1, [{ cores: 1, ops: 1, vram: 2 }]);
    });
    feed(w, F.gpu, 1, 0.1); step(w);
    const picked = w.hot.rack.lbLast[0];
    steps(w, 19);
    expect([picked, failedOf(w, F.gpu, CAUSE.misroute), metOf(w, F.gpu)]).toEqual([1, 0, 1]);
  });

  it('routes a capable cohort when cards are busy and splits starts across actual VRAM domains', () => {
    const w = rack(1, S.firstFit, FILTER_BIT.capability, { K: 4, Q: 4, threads: 4 }, (c) => {
      setAccels(c, 0, [{ cores: 1, ops: 1, vram: 2 }, { cores: 1, ops: 1, vram: 2 }]);
    });
    feed(w, F.gpu, 6, 1); steps(w, 6);
    expect([w.hot.sys.running[0], w.hot.sys.queueLen[0]]).toEqual([2, 4]);
    expect([...w.hot.sys.accelUsedVram.slice(0, 2)]).toEqual([2, 2]);
    expect(failedOf(w, F.gpu, CAUSE.misroute)).toBe(0);
    steps(w, 40);
    expect(metOf(w, F.gpu)).toBe(6);
    expect([...w.hot.sys.accelUsedVram.slice(0, 2)]).toEqual([0, 0]);
  });

  it('health skips a server whose PSU overload timer runs', () => {
    const pick = (filters: number) => { const w = rack(2, S.firstFit, filters); w.hot.sys.psuOverTicks[0] = 5; return routes(w, F.cpu, 1, 1)[0]; };
    expect(pick(0)).toBe(0);
    expect(pick(FILTER_BIT.health)).toBe(1);
  });

  it('power skips a server at 90% PSU usage', () => {
    const pick = (filters: number) => { const w = rack(2, S.firstFit, filters); w.hot.sys.psuUsage[0] = 0.92; return routes(w, F.cpu, 1, 1)[0]; };
    expect(pick(0)).toBe(0);
    expect(pick(FILTER_BIT.power)).toBe(1);
  });

  it('a filter that would remove every candidate is skipped', () => {
    const w = rack(2, S.firstFit, FILTER_BIT.power);
    w.hot.sys.psuUsage[0] = 0.95; w.hot.sys.psuUsage[1] = 0.95;
    expect(routes(w, F.cpu, 1, 1)[0]).toBe(0);
  });
});

/** Every link at `speed` bit/s (the test fleet's catalog links are far faster). */
const slowLinks = (speed: number) => (c: CompiledBuffers) => { for (let l = 0; l < c.link.len; l += 1) c.link.speed[l] = speed; };

describe('ports, first-link room and links (spec §7.2–§7.6)', () => {
  it('a server without a port gets no tasks', () => {
    const w = rack(5, S.firstFit);
    feed(w, F.cpu, 5, 50);
    step(w);
    expect([0, 1, 2, 3, 4].map((s) => w.hot.sys.reserved[s])).toEqual([1, 1, 1, 1, 0]);
  });

  it('takes while the first link has under one tick of backlog; routers have no budget (D12.5)', () => {
    const w = rack(4, S.firstFit, 0, {}, slowLinks(1000));
    feed(w, F.cpu, 4, 50);
    step(w);
    // 50-bit payloads; one tick of a 1 kHz uplink is 100 bits: two takes leave 100 bits queued.
    expect(w.hot.g[3]).toBe(2);
  });

  it('a transfer takes payload / port speed on each link, store and forward', () => {
    const w = rack(2, S.firstFit, 0, {}, slowLinks(1000));
    feed(w, F.net, 1, 150);
    let at = -1;
    for (let i = 0; i < 40 && at < 0; i += 1) { step(w); if (w.hot.sys.running[0] === 1) at = w.tick - 1; }
    // 150 bits at 1 kHz = 0.15 s per link: uplink ticks 1–2, server link ticks 3–4, admitted tick 4.
    expect(at).toBe(4);
  });
});
