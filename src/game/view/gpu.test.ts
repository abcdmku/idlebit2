import { installedGpuStats } from '../build/gpu';
import { cloneCompiled, cloneHot, G, LOC } from '../core/buffers';
import { ACCEL_CLOCKS, ACCEL_DOMAINS, DT_S, MAX_ACCELS, POOL_DOMAIN } from '../core/constants';
import { allocRecord, frontList, pushBack, queueList } from '../core/pool';
import { createInitialState } from '../core/state';
import { FAMILIES } from '../market/families';
import type { AccelBuild } from '../types/build';
import { systemId } from '../types/ids';
import type { GameState } from '../types/state';
import { queueWindow } from './feed';
import { systemSnapshot } from './system';
import { forEachRunning, queuedTasks, runningTasks, stageProgress } from './tasks';

const cards: readonly AccelBuild[] = [
  { kind: 'gpu', model: '3350', upgrades: 2 },
  { kind: 'gpu', model: '5590', upgrades: 0 },
  { kind: 'npu', gen: 0, level: 1 },
];

function gpuState(linked = false): GameState {
  const base = createInitialState(42);
  const system = base.build.systems[0]!;
  const compiled = cloneCompiled(base.compiled), hot = cloneHot(base.hot);
  const state: GameState = {
    ...base, compiled, hot,
    build: { ...base.build, systems: [{ ...system, spec: { ...system.spec, board: 'accelerator', accels: cards } }] },
  };
  compiled.sys.gpuLinked[0] = linked ? 1 : 0;
  for (let slot = 0; slot < cards.length; slot += 1) {
    const card = cards[slot]!;
    compiled.sys.accelKind[slot] = card.kind === 'gpu' ? 1 : 2;
    if (card.kind === 'gpu') {
      const gpu = installedGpuStats(card, state.research.unlocks);
      compiled.sys.accelVram[slot] = gpu.vramBits;
      compiled.sys.accelOps[slot] = gpu.opsPerS;
      compiled.sys.accelTensorOps[slot] = gpu.tensorOpsPerS;
      compiled.sys.accelCores[slot] = gpu.cores;
    }
  }
  compiled.sys.accelVram[2] = 4096;
  compiled.sys.accelTensorOps[2] = 256;
  hot.sys.active[2] = 9;
  return state;
}

function task(state: GameState, tensor: boolean, domain: number, count = 1): number {
  const family = FAMILIES.find((f) => f.tensor === tensor && f.stages.some((stage) => stage.resource === 'gpu'))!;
  const r = allocRecord(state.hot);
  state.hot.rec.family[r] = family.id;
  state.hot.rec.stage[r] = family.stages.findIndex((stage) => stage.resource === 'gpu');
  state.hot.rec.units[r] = 13.25;
  state.hot.rec.count[r] = count;
  state.hot.rec.owner[r] = 0;
  state.hot.rec.accelDomain[r] = domain;
  state.hot.rec.start[r] = 100;
  state.hot.rec.finish[r] = 200;
  state.hot.rec.loc[r] = LOC.running;
  return r;
}

describe('GPU system views', () => {
  it('reports evaluated model identity and upgrade count with actual per-card duty', () => {
    const state = gpuState();
    state.hot.sys.accelTaskS[0] = DT_S * 0.75;
    state.hot.sys.accelResearchS[0] = DT_S * 0.25;
    state.hot.sys.accelResearchS[2] = DT_S * 0.5;
    state.hot.sys.accelUsedVram[0] = 100;
    state.hot.sys.accelUsedVram[2] = 64;
    const snap = systemSnapshot(state, systemId(0), null);
    expect(snap.gpu[0]).toMatchObject({ kind: 'gpu', generation: 2, level: 3, active: true, resourceBusy: 1, vramUsedBits: 100 });
    expect(snap.gpu[0]!.gpu).toEqual(installedGpuStats(cards[0] as Extract<AccelBuild, { kind: 'gpu' }>, state.research.unlocks));
    expect(snap.gpu[1]).toMatchObject({ active: false, resourceBusy: 0, vramUsedBits: 0, gpu: { model: '5590', upgrades: 0 } });
    expect(snap.gpu[2]).toMatchObject({ kind: 'npu', generation: 0, level: 1, active: true, resourceBusy: 0.5, vramUsedBits: 64 });
    expect(snap.gpu[2]!.gpu).toBeUndefined();
    const cpu = systemSnapshot(createInitialState(42), systemId(0), null);
    expect(snap.cpu).toEqual(cpu.cpu);
    expect(snap.cpuBusy).toEqual(cpu.cpuBusy);
    expect(snap.chip).toEqual(cpu.chip);
  });

  it('stripes linked reservations by physical GPU VRAM and keeps NPU holds separate', () => {
    const state = gpuState(true);
    const total = state.compiled.sys.accelVram[0]! + state.compiled.sys.accelVram[1]!;
    state.hot.sys.accelUsedVram[POOL_DOMAIN] = total * 0.375;
    state.hot.sys.accelUsedVram[2] = 123;
    const snap = systemSnapshot(state, systemId(0), null);
    expect(snap.gpu[0]!.vramUsedBits).toBe(state.compiled.sys.accelVram[0]! * 0.375);
    expect(snap.gpu[1]!.vramUsedBits).toBe(state.compiled.sys.accelVram[1]! * 0.375);
    expect(snap.gpu[2]!.vramUsedBits).toBe(123);
    expect(snap.gpu[0]!.vramUsedBits! + snap.gpu[1]!.vramUsedBits!).toBe(state.hot.sys.accelUsedVram[POOL_DOMAIN]);
  });

  it('shows a lifetime memory hold while the assigned task is in a CPU stage', () => {
    const state = gpuState(), r = task(state, false, 0, 2);
    state.hot.rec.family[r] = FAMILIES.find((f) => f.key === 'thumbnail')!.id;
    state.hot.sys.head[0] = r;
    state.hot.sys.active[2] = 0;
    state.hot.sys.accelUsedVram[0] = 26.5;
    state.hot.rec.stage[r] = 0;
    const snap = systemSnapshot(state, systemId(0), null);
    expect(snap.running[0]).toMatchObject({ resource: 'compute', accelDomain: 0, vramBits: 13.25 });
    expect(snap.gpu[0]).toMatchObject({ active: false, resourceBusy: 0, vramUsedBits: 26.5 });
  });
});

describe('GPU task views', () => {
  it.each([false, true])('reads ordinary/tensor clocks in domain order, linked=%s', (linked) => {
    const state = gpuState(linked), hot = state.hot;
    hot.rack.effClock[0] = 12;
    hot.sys.wAnchor[2] = 10_000;
    const domains = linked ? [2, POOL_DOMAIN, POOL_DOMAIN] : [0, 1, 2];
    const modes = linked ? [true, false, true] : [false, true, true];
    const records = domains.map((domain, k) => task(state, modes[k]!, domain));
    for (let k = 0; k < records.length; k += 1) {
      const r = records[k]!, tensor = modes[k] ? 1 : 0;
      const i = 2 * hot.rec.accelDomain[r]! + tensor;
      hot.sys.accelHead[i] = r;
      hot.sys.accelWAnchor[i] = 100 + k * 25;
      hot.sys.accelEAnchor[i] = 10;
      hot.sys.accelRate[i] = 10;
    }
    const running = runningTasks(state, 0, 8);
    expect(running.map((v) => v.accelDomain)).toEqual(domains);
    expect(running.map((v) => v.progress)).toEqual([0.2, 0.45, 0.7]);
    expect(runningTasks(state, 0, 2)).toHaveLength(2);
    const visited: number[] = [];
    forEachRunning(state, 0, (r) => { visited.push(r); });
    expect(visited).toEqual(records);
  });

  it('keeps fixed core minima and unrounded per-member VRAM in running, queued and queue-front views', () => {
    const state = gpuState(), r = task(state, false, 0, 3), hot = state.hot;
    const def = FAMILIES[hot.rec.family[r]!]!;
    const expected = { gpuCoresMin: def.gpuCoresMin, vramBits: def.vramBits.fixed + def.vramBits.perSize * 13.25 };
    hot.sys.accelHead[0] = r;
    expect(runningTasks(state, 0, 1)[0]).toMatchObject({ ...expected, count: 3, accelDomain: 0 });
    hot.sys.accelHead[0] = -1;
    hot.rec.accelDomain[r] = -1;
    hot.rec.loc[r] = LOC.queue;
    pushBack(hot, queueList(hot, 0), r);
    expect(queuedTasks(state, 0, 0, 1)[0]).toMatchObject({ ...expected, accelDomain: null, progress: 0 });
    const f = task(state, false, -1, 7);
    hot.rec.loc[f] = LOC.front;
    pushBack(hot, frontList(hot), f);
    expect(queueWindow(state)[0]).toMatchObject({ ...expected, committed: true, dismissible: false });
    expect(queueWindow(state)[0]).not.toHaveProperty('gpus');
    expect(queueWindow(state)[0]).not.toHaveProperty('clockHz');
    expect(hot.g[G.frontHead]).toBe(f);
  });

  it('does not borrow another clock for an unassigned GPU stage', () => {
    const state = gpuState(), r = task(state, false, -1);
    expect(stageProgress(state.hot, 1, r, 0, 0, 2)).toBe(0);
    expect(state.hot.sys.accelHead.length).toBeGreaterThanOrEqual(ACCEL_CLOCKS);
    expect(state.hot.sys.accelUsedVram.length).toBeGreaterThanOrEqual(ACCEL_DOMAINS);
    expect(state.compiled.sys.accelKind.length).toBeGreaterThanOrEqual(MAX_ACCELS);
  });
});
