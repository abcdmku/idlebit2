import { cloneHot, LOC } from '../core/buffers';
import { allocRecord, pushBack, queueList } from '../core/pool';
import { createInitialState } from '../core/state';
import { compileAll } from '../core/topology';
import { familyId, systemId } from '../types/ids';
import { chipSnapshot } from './chip';

describe('chip task identity contract (R42)', () => {
  it('publishes running task identities and queued families, oldest taken first then task ID', () => {
    const base = createInitialState(42), system = base.build.systems[0]!;
    const cpu = system.spec.cpu!;
    const spec = {
      ...system.spec, cpu: { ...cpu, cores: Array.from({ length: 4 }, () => cpu.cores[0]!) },
      scheduler: { gen: 0, level: 3, strategy: 'fifo' as const },
    };
    const build = { ...base.build, systems: [{ ...system, spec }] };
    const hot = cloneHot(base.hot);
    const state = { ...base, build, hot, compiled: compileAll(build, base.research) };
    const record = (taskId: number, family: number, taken: number, loc: number): number => {
      const r = allocRecord(hot);
      hot.rec.taskId[r] = taskId; hot.rec.family[r] = family; hot.rec.taken[r] = taken;
      hot.rec.loc[r] = loc; hot.rec.owner[r] = 0; hot.rec.threads[r] = 1; hot.rec.count[r] = 1;
      return r;
    };
    // Run-list order is deliberately different from take order and the task-ID tiebreak.
    const newer = record(381, 0, 20, LOC.running);
    const tied = record(384, 1, 10, LOC.running);
    const oldest = record(383, 2, 10, LOC.running);
    hot.sys.head[0] = newer; hot.rec.next[newer] = tied; hot.rec.next[tied] = oldest;
    hot.sys.running[0] = 3; hot.sys.busyThreads[0] = 3;
    const queued = [record(387, 3, 30, LOC.queue), record(386, 4, 30, LOC.queue), record(388, 5, 25, LOC.queue)];
    for (const r of queued) pushBack(hot, queueList(hot, 0), r);

    const chip = chipSnapshot(state, systemId(0), null);
    expect(chip.cores.map(({ taskId, family }) => ({ taskId, family }))).toEqual([
      { taskId: 383, family: familyId(2) }, { taskId: 384, family: familyId(1) },
      { taskId: 381, family: familyId(0) }, { taskId: null, family: null },
    ]);
    expect(chip.queue).toEqual([
      { taskId: 388, family: familyId(5) }, { taskId: 386, family: familyId(4) }, { taskId: 387, family: familyId(3) },
    ]);
    expect(hot.sys.head[0]).toBe(newer);
    expect(hot.sys.queueHead[0]).toBe(queued[0]);
  });

  it('publishes null identity on idle cores and no wells without a scheduler', () => {
    const chip = chipSnapshot(createInitialState(42), systemId(0), null);
    expect(chip.cores[0]).toMatchObject({ taskId: null, family: null });
    expect(chip.scheduler).toBeNull();
    expect(chip.queue).toEqual([]);
  });
});
