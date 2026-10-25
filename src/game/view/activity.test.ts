import { cloneCompiled, cloneHot } from '../core/buffers';
import { systemId } from '../types/ids';
import { fixtureSnapshot, fixtureState } from './fixtures';
import { rackSnapshot } from './rack';
import { systemSnapshot } from './system';

describe('CPU activity snapshots', () => {
  it('shows total cores and task busy cores on the rack fixture', () => {
    const state = fixtureState('rack');
    const rack = fixtureSnapshot('rack').focus;
    if (rack.level !== 'rack') throw new Error('rack');
    for (const slot of rack.servers) {
      const id = slot.systemId!;
      const spec = state.build.systems[id]!.spec;
      expect(slot.cores).toBe(spec.cpu!.cores.length * spec.cpuCount);
      const threadsPerCore = state.compiled.sys.threads[id]! / slot.cores;
      expect(slot.busyCores).toBeCloseTo(state.hot.sys.busyThreads[id]! / threadsPerCore);
      expect(slot.busyCores).toBeLessThanOrEqual(slot.cores);
    }
    expect(rack.servers[0]!.busyCores).toBeGreaterThan(0);
  });

  it.each([1, 2, 3, 4])('fills %i CPUs in socket order from pooled busy threads', (cpuCount) => {
    const base = fixtureState('systemTop');
    const system = base.build.systems[0]!;
    const compiled = cloneCompiled(base.compiled), hot = cloneHot(base.hot);
    const coresPerCpu = system.spec.cpu!.cores.length;
    const threadsPerCpu = compiled.sys.threads[0]! / system.spec.cpuCount;
    compiled.sys.cores[0] = coresPerCpu * cpuCount;
    compiled.sys.threads[0] = threadsPerCpu * cpuCount;
    compiled.sys.sockets[0] = cpuCount;
    hot.sys.busyThreads[0] = threadsPerCpu * Math.min(cpuCount, 1.5);
    const state = {
      ...base, compiled, hot,
      build: { ...base.build, systems: [{ ...system, spec: { ...system.spec, cpuCount } }] },
    };
    const snap = systemSnapshot(state, systemId(0), null);
    expect(snap.cpuCount).toBe(cpuCount);
    expect(snap.cpuBusy).toHaveLength(cpuCount);
    expect(snap.cpuBusy).toEqual([1, 0.5, 0, 0].slice(0, cpuCount));
  });

  it('shows zero cores for empty slots and storage nodes', () => {
    const base = fixtureState('rack');
    const compiled = cloneCompiled(base.compiled);
    compiled.sys.kind[0] = 1;
    compiled.rack.servers[1] = -1;
    const rack = rackSnapshot({ ...base, compiled }, base.build.racks[0]!.id, null);
    expect(rack.servers[0]).toMatchObject({ kind: 'storageNode', cores: 0, busyCores: 0 });
    expect(rack.servers[1]).toMatchObject({ systemId: null, cores: 0, busyCores: 0 });
  });
});
