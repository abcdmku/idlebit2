import { describe, expect, it, vi } from 'vitest';
import { cloneCompiled, LOC } from '../core/buffers';
import { DT_S, POOL_DOMAIN } from '../core/constants';
import { ledgerPhase } from '../core/ledger';
import { allocGang, allocRecord } from '../core/pool';
import { openWorld, type World } from '../core/world';

import { powerPhase } from '../phys/power';
import { systemId } from '../types/ids';
import { accelClockAt, recordAccelClock } from './accelerators';
import { enqueue, startQueued } from './alloc';
import { fillSpan, newSpan } from './clocks';
import { killSubtree } from './kill';
import { reconcileAccelerators } from './reconcile';
import { runPhase } from './run';
import { noteAdmitted } from './slots';
import { F } from './testFamilies';
import { execState, setAccels } from './testWorld';

vi.mock('../market/families', async (orig) => ({ ...(await orig<object>()), FAMILIES: (await import('./testFamilies')).TEST_FAMILIES }));

function queued(w: World, s: number, family: number): number {
  const r = allocRecord(w.hot), rec = w.hot.rec;
  rec.family[r] = family; rec.count[r] = 1; rec.scale[r] = 100; rec.payout[r] = 100; rec.threads[r] = 1;
  enqueue(w, s, r); noteAdmitted(w, s, 1);
  return r;
}

function gangWorld() {
  const w = openWorld(execState({ serversPerRack: 2 }, { K: 4, threads: 4 }, (c) => {
    for (let s = 0; s < c.sys.len; s += 1) setAccels(c, s, [{ cores: 4, ops: 100, tensorOps: 100, vram: 100, loadW: 100 }]);
    // Isolate accelerator billing from the deliberately unchanged CPU busy-core policy.
    c.sys.idleW.fill(0); c.sys.loadW.fill(0); c.sys.coreIdleW.fill(0); c.sys.coreLoadW.fill(0); c.sys.clockIdleW.fill(0);
  }));
  const incumbent = queued(w, 0, F.gpu), member = queued(w, 0, F.tensor);
  const g = allocGang(w.hot), gang = w.hot.gang, rec = w.hot.rec;
  gang.members[g] = 2; gang.family[g] = F.tensor; gang.placed[g] = 2;
  rec.gang[member] = g;
  rec.gang[queued(w, 1, F.tensor)] = g;
  return { w, incumbent, member };
}

describe('gang cleanup at the completed execution boundary', () => {
  {
    it('does not retroactively accelerate survivors after a cross-system loss', () => {
      const { w, incumbent, member } = gangWorld();
      const reference = gangWorld().w;
      runPhase(w); runPhase(reference);
      const i = recordAccelClock(w, 0, incumbent), end = DT_S;
      expect(accelClockAt(w, i, end)).toBe(5);
      const duty = w.hot.sys.accelTaskS.slice();
      killSubtree(w, { kind: 'system', id: systemId(1) }, 'power');
      expect(w.hot.rec.loc[member]).toBe(LOC.free);
      expect(w.hot.rec.loc[incumbent]).toBe(LOC.running);
      expect(accelClockAt(w, i, end)).toBe(5);
      expect(w.hot.sys.accelEAnchor[i]).toBe(end);
      expect(w.hot.sys.accelTaskS).toEqual(duty);
      powerPhase(w); powerPhase(reference); ledgerPhase(w); ledgerPhase(reference);
      expect(w.ledger.energy).toBe(reference.ledger.energy);
      expect(w.ledger.energyMeter).toBe(reference.ledger.energyMeter);
      for (let rack = 0; rack < w.hot.rack.len; rack += 1) w.hot.rack.effClock[rack] = end;
      w.tick += 1;
      runPhase(w);
      expect(accelClockAt(w, i, 2 * DT_S)).toBeCloseTo(15, 12);
    });
  }
});

describe('GPU-link reconciliation scan cost', () => {
  for (const systems of [2, 32]) {
    it(`visits the record pool once while linking ${systems} systems`, () => {
      const w = openWorld(execState({ racksPerZone: systems === 2 ? 1 : 4, serversPerRack: systems === 2 ? 2 : 8 },
        { K: 4, threads: 4 }, (c) => {
          for (let s = 0; s < c.sys.len; s += 1) setAccels(c, s, [
            { cores: 4, ops: 100, tensorOps: 100, vram: 100 },
            { kind: 'npu', cores: 0, ops: 0, tensorOps: 200, vram: 100 },
          ]);
        }));
      const span = newSpan(), gpu: number[] = [], npu: number[] = [], cpu: number[] = [];
      for (let s = 0; s < w.compiled.sys.len; s += 1) {
        gpu.push(queued(w, s, F.gpu)); npu.push(queued(w, s, F.tensor)); cpu.push(queued(w, s, F.cpuGpu));
        fillSpan(w, w.compiled.sys.rack[s]!, span); startQueued(w, s, 0, span);
      }
      const old = w.compiled;
      w.compiled = cloneCompiled(old); w.compiled.sys.gpuLinked.fill(1);
      const rec = w.hot.rec, loc = rec.loc;
      let visits = 0;
      rec.loc = new Proxy(loc, { get(target, key) {
        if (typeof key === 'string' && /^\d+$/.test(key)) visits += 1;
        return Reflect.get(target, key, target);
      } });
      reconcileAccelerators(w, old);
      rec.loc = loc;
      expect(visits).toBe(rec.len);
      for (let s = 0; s < w.compiled.sys.len; s += 1) {
        expect(rec.accelDomain[gpu[s]!]).toBe(POOL_DOMAIN);
        expect(rec.accelDomain[cpu[s]!]).toBe(POOL_DOMAIN);
        expect(rec.accelDomain[npu[s]!]).toBe(1);
        expect(rec.finish[gpu[s]!]).toBe(100);
        expect(w.hot.sys.accelHolders[s * 9 + POOL_DOMAIN]).toBe(2);
        expect(w.hot.sys.accelUsedVram[s * 9 + POOL_DOMAIN]).toBe(4);
        expect(w.hot.sys.accelHolders[s * 9 + 1]).toBe(1);
      }
    });
  }
});
