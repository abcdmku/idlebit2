import { POWER_SCALE } from '../core/constants';
import { capacity, capacity2, PARTS } from '../build/catalog';
import { cloneCompiled, cloneHot, LOC } from '../core/buffers';
import { ACCEL_CLOCKS, MAX_ACCELS, RACK_SLOTS_PER_ROW, RACKS_PER_ROOM } from '../core/constants';
import { allocRecord } from '../core/pool';
import { createInitialState } from '../core/state';
import { compileAll } from '../core/topology';
import { buildState } from '../testkit/builders';
import { familyId, rackId, roomId, systemId } from '../types/ids';
import { fixtureState } from './fixtures';
import { rackSnapshot } from './rack';
import { roomSnapshot } from './room';
import { systemSnapshot } from './system';

describe('rack room-row contract (R36)', () => {
  it('uses the room order and preserves empty columns in another room and row', () => {
    const base = buildState({ sites: 1, zonesPerSite: 2, racksPerZone: 10, serversPerRack: 1 });
    const compiled = cloneCompiled(base.compiled);
    // IDs 10 and 19 trade places, so neither rack ID nor compiled.rack.slot is the room position.
    compiled.room.racks[RACKS_PER_ROOM] = 19;
    compiled.room.racks[RACKS_PER_ROOM + 9] = 10;
    const state = { ...base, compiled };
    const room = roomSnapshot(state, roomId(1), null);
    for (const [id, slot] of [[19, 0], [10, 9]] as const) {
      const rack = rackSnapshot(state, rackId(id), null);
      const start = Math.floor(slot / RACK_SLOTS_PER_ROW) * RACK_SLOTS_PER_ROW;
      expect(rack.slot).toBe(slot);
      expect(rack.row).toHaveLength(RACK_SLOTS_PER_ROW);
      expect(rack.row).toEqual(room.racks.slice(start, start + RACK_SLOTS_PER_ROW));
      expect(rack.row[slot % RACK_SLOTS_PER_ROW]!.rackId).toBe(id);
    }
    expect(rackSnapshot(state, rackId(10), null).row.map((r) => r.rackId))
      .toEqual([18, 10, null, null, null, null, null, null]);
  });

  it('keeps the starter rack at slot zero before Room is opened', () => {
    const state = createInitialState(42);
    expect(state.compiled.room.opened[0]).toBe(0);
    const rack = rackSnapshot(state, rackId(0), null);
    expect(rack.parent).toBeNull();
    expect(rack.slot).toBe(0);
    expect(rack.row.map((r) => r.rackId)).toEqual([0, null, null, null, null, null, null, null]);
  });
});

describe('server running-family contract (R37)', () => {
  it('shows the running family in the rack fixture and null for idle or empty slots', () => {
    const state = fixtureState('rack');
    const rack = rackSnapshot(state, rackId(0), null);
    const head = state.hot.sys.head[0]!;
    expect(head).toBeGreaterThanOrEqual(0);
    expect(rack.servers[0]!.family).toBe(state.hot.rec.family[head]);
    expect(rack.servers[2]!.family).toBeNull();
    const empty = rackSnapshot(createInitialState(42), rackId(0), null);
    expect(empty.servers[0]!.family).toBeNull();
    expect(empty.servers[1]!.family).toBeNull();
  });

  it('selects the oldest take across resource lists, breaking ties by task ID', () => {
    const base = createInitialState(42), hot = cloneHot(base.hot);
    const state = { ...base, hot };
    const record = (family: number, taken: number, taskId: number): number => {
      const r = allocRecord(hot);
      hot.rec.family[r] = family; hot.rec.taken[r] = taken; hot.rec.taskId[r] = taskId;
      hot.rec.loc[r] = LOC.running; hot.rec.owner[r] = 0; hot.rec.count[r] = 1;
      return r;
    };
    const cpu = record(0, 20, 1), ram = record(1, 10, 3), gpu = record(2, 10, 2), io = record(3, 30, 4);
    hot.sys.head[0] = cpu;
    hot.sys.head[1] = ram;
    hot.sys.accelHead[ACCEL_CLOCKS - 1] = gpu;
    hot.sys.head[3] = io;
    hot.sys.running[0] = 4;
    expect(rackSnapshot(state, rackId(0), null).servers[0]!.family).toBe(familyId(2));
    hot.rec.taken[io] = 5;
    expect(rackSnapshot(state, rackId(0), null).servers[0]!.family).toBe(familyId(3));
    const olderCpu = record(4, 1, 5);
    hot.rec.next[cpu] = olderCpu;
    hot.rec.prev[olderCpu] = cpu;
    hot.sys.running[0] = 5;
    expect(rackSnapshot(state, rackId(0), null).servers[0]!.family).toBe(familyId(4));
  });
});

describe('system part-value contract (R40)', () => {
  it('matches catalog values and compiled capacities for the top fixture system', () => {
    const state = fixtureState('systemTop'), id = systemId(0);
    const snap = systemSnapshot(state, id, null), c = state.compiled.sys;
    const spec = state.build.systems[id]!.spec;
    const sum = (parts: readonly { readonly capacityBits?: number; readonly rateBits?: number }[], key: 'capacityBits' | 'rateBits') =>
      parts.reduce((total, p) => total + p[key]!, 0);
    expect(snap.chip.pipe.speed).toBe(c.pipeSpeed[id]);
    expect(snap.chip.clock.hz).toBe(c.clockHz[id]);
    expect(snap.chip.cores.length * snap.cpuCount).toBe(c.cores[id]);
    expect(snap.psu.capacityW).toBe(c.psuCapW[id]! * POWER_SCALE);
    for (let i = 0; i < spec.ram.length; i += 1) {
      const p = spec.ram[i]!;
      expect(snap.ram[i]).toMatchObject({
        capacityBits: capacity(PARTS.ram, p.gen, p.level), rateBits: capacity2(PARTS.ram, p.gen, p.level),
      });
    }
    expect(sum(snap.ram, 'capacityBits')).toBe(c.ramCap[id]);
    // Step-curve bandwidths are not whole numbers: the sums agree to rounding.
    expect(sum(snap.ram, 'rateBits') / c.ramBw[id]!).toBeCloseTo(1, 12);
    expect(sum(snap.storage, 'capacityBits')).toBe(c.storageCap[id]);
    expect(sum(snap.storage, 'rateBits')).toBe(c.ioRate[id]);
    for (let i = 0; i < snap.gpu.length; i += 1) {
      const card = spec.accels[i]!;
      if (card.kind !== 'gpu') throw new Error('GPU fixture');
      expect(snap.gpu[i]!.gpu).toMatchObject({
        model: card.model, cores: c.accelCores[id * MAX_ACCELS + i], vramBits: c.accelVram[id * MAX_ACCELS + i],
      });
    }
  });

  it('keeps mixed RAM and drive values per part instead of splitting system totals', () => {
    const base = fixtureState('systemTop'), system = base.build.systems[0]!;
    const spec = {
      ...system.spec,
      ram: [{ gen: 0, level: 1, ecc: false }, { gen: 1, level: 3, ecc: true }],
      drives: [{ gen: 0, level: 2 }, { gen: 1, level: 3 }],
    };
    const build = { ...base.build, systems: [{ ...system, spec }] };
    const compiled = compileAll(build, base.research);
    const snap = systemSnapshot({ ...base, build, compiled }, systemId(0), null);
    for (const [parts, builds, row] of [[snap.ram, spec.ram, PARTS.ram], [snap.storage, spec.drives, PARTS.storage]] as const) {
      for (let i = 0; i < parts.length; i += 1) {
        const p = builds[i]!;
        expect(parts[i]).toMatchObject({ capacityBits: capacity(row, p.gen, p.level), rateBits: capacity2(row, p.gen, p.level) });
      }
    }
    expect(snap.ram.reduce((total, p) => total + p.capacityBits!, 0)).toBe(compiled.sys.ramCap[0]);
    expect(Math.min(...snap.ram.map((p) => p.rateBits!))).toBe(compiled.sys.ramBw[0]);
    expect(snap.storage.reduce((total, p) => total + p.capacityBits!, 0)).toBe(compiled.sys.storageCap[0]);
    expect(snap.storage.reduce((total, p) => total + p.rateBits!, 0)).toBe(compiled.sys.ioRate[0]);
  });
});
