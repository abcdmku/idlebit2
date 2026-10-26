import { evaluateGpu } from '../build/catalog/gpuModels';
import { LOC } from '../core/buffers';
import { allocRecord } from '../core/pool';
import { createInitialState } from '../core/state';
import { FAMILIES } from '../market/families';
import type { GameState } from '../types/state';
import { deserializeSave, serializeSave } from './serialize';
import { SAVE_VERSION } from './schema';
import { validateState } from './validate';
import { decodeArray, encodeArray } from './typedArrays';
import { researchId } from '../types/ids';

function gpuState(running = false): GameState {
  const base = createInitialState(42), first = base.build.systems[0]!;
  const build = { ...first, spec: { ...first.spec, accels: [{ kind: 'gpu', model: '1330', upgrades: 0 } as const] } };
  const state: GameState = {
    ...base, build: { ...base.build, systems: [build] },
    research: { ...base.research, unlocks: { ...base.research.unlocks, gens: { ...base.research.unlocks.gens, gpu: 1 } } },
  };
  const gpu = evaluateGpu('1330', 0), c = state.compiled.sys;
  c.accelKind[0] = 1; c.accelCores[0] = gpu.cores; c.accelClockHz[0] = gpu.clockHz;
  c.accelVram[0] = gpu.vramBits; c.accelOps[0] = gpu.opsPerS; c.accelTensorOps[0] = gpu.tensorOpsPerS;
  c.accelIdleW[0] = gpu.idleW; c.accelLoadW[0] = gpu.loadW;
  if (running) {
    const h = state.hot, r = allocRecord(h), family = FAMILIES.find((f) => f.key === 'imageBlur')!;
    h.rec.loc[r] = LOC.running; h.rec.owner[r] = 0; h.rec.accelDomain[r] = 0;
    h.rec.family[r] = family.id; h.rec.stage[r] = 1; h.rec.count[r] = 1; h.rec.units[r] = 60;
    h.rec.start[r] = 3; h.rec.finish[r] = 103;
    h.sys.accelHead[0] = r; h.sys.accelActive[0] = 1; h.sys.active[2] = 1;
    h.sys.accelHolders[0] = 1; h.sys.accelUsedVram[0] = 60; h.sys.usedVram[0] = 60;
    h.sys.accelWAnchor[0] = 5; h.sys.accelEAnchor[0] = 0.25; h.sys.accelRate[0] = 4000; h.sys.accelDue[0] = 0.2745;
    h.sys.accelTaskS[0] = 0.025; h.sys.accelResearchS[0] = 0.075; h.sys.accelResearchOps[0] = 300;
  }
  return state;
}

const invalid = (state: GameState, pattern: RegExp) => {
  const loaded = validateState(state);
  expect(loaded.ok).toBe(false);
  if (!loaded.ok) expect(loaded.error).toMatch(pattern);
};

describe('GPU save validation', () => {
  it('round-trips all accelerator columns, model IDs, exact wallets and carry without rebuilding anchors', () => {
    const base = gpuState(true);
    const state = { ...base, clock: { ...base.clock, carryMs: 73 }, wallet: { ...base.wallet, credits: '128000000000000000' as GameState['wallet']['credits'] } };
    const loaded = deserializeSave(serializeSave(state));
    if (!loaded.ok) throw new Error(loaded.error);
    expect(loaded.state).toEqual(state);
    expect(loaded.state.hot.sys.accelDue).toBeInstanceOf(Float64Array);
    expect(loaded.state.hot.sys.accelDue[1]).toBe(Infinity);
  });

  it('resets previous pre-live versions before interpreting their layouts', () => {
    const envelope = { schema: 'bitrouge-v3', version: 2, state: {} };
    const loaded = deserializeSave(JSON.stringify(envelope));
    expect(!loaded.ok && loaded.error).toContain(`version 2 is not ${SAVE_VERSION}`);
  });

  it('round-trips a linked domain with lifetime holds outside its GPU stage', () => {
    const base = gpuState(true);
    const state: GameState = { ...base, research: { ...base.research, unlocks: { ...base.research.unlocks, rules: ['gpuLink'] } } };
    const h = state.hot.sys;
    state.compiled.sys.gpuLinked[0] = 1; state.hot.rec.accelDomain[0] = 8;
    // Its mem stage's RAM part (D26.2).
    state.hot.rec.stage[0] = 0; state.hot.rec.part[0] = 1;
    h.accelHead[0] = -1; h.accelActive[0] = 0; h.active[2] = 0;
    h.accelWAnchor[0] = 0; h.accelEAnchor[0] = 0; h.accelRate[0] = 0; h.accelDue[0] = Infinity;
    h.head[1] = 0; h.active[1] = 1;
    h.accelUsedVram[0] = 0; h.accelHolders[0] = 0; h.accelUsedVram[8] = 60; h.accelHolders[8] = 1;
    const loaded = deserializeSave(serializeSave(state));
    if (!loaded.ok) throw new Error(loaded.error);
    expect(loaded.state).toEqual(state);
  });

  it.each([[0, null], [1, 'gpuGen2'], [2, 'tensorCores'], [3, 'matrixGpu']] as const)('enforces NPU generation %i AND prerequisites', (gen, prerequisite) => {
    const base = gpuState(), first = base.build.systems[0]!;
    const completed = [researchId('systemBoard')]; // D39: the legacy NPU comes with the System board
    let state: GameState = {
      ...base,
      build: { ...base.build, systems: [{ ...first, spec: { ...first.spec, accels: [{ kind: 'npu', gen, level: 1 }] } }] },
      research: { ...base.research, completed, unlocks: { ...base.research.unlocks, gens: { ...base.research.unlocks.gens, npu: 15 } } },
    };
    const c = state.compiled.sys;
    c.accelKind[0] = 2; c.accelCores[0] = 0; c.accelOps[0] = 0; c.accelTensorOps[0] = 32;
    if (prerequisite) {
      invalid(state, /prerequisite/);
      state = { ...state, research: { ...state.research, completed: [...completed, researchId(prerequisite)] } };
    }
    expect(validateState(state).ok).toBe(true);
    state = { ...state, research: { ...state.research, completed: prerequisite ? [researchId(prerequisite)] : [] } };
    invalid(state, /prerequisite/);
  });

  it.each(['0330', '1430', '1340', '13300', { generation: 1, series: 3, tier: 30 }])('rejects invalid model %j', (model) => {
    const state = gpuState();
    (state.build.systems[0]!.spec.accels[0] as unknown as { model: unknown }).model = model;
    invalid(state, /model/);
  });

  it('rejects invalid upgrades, locked generations, and obsolete GPU shapes', () => {
    const state = gpuState();
    (state.build.systems[0]!.spec.accels[0] as unknown as { upgrades: number }).upgrades = 6;
    invalid(state, /upgrades/);
    const locked = gpuState();
    (locked.research.unlocks.gens as unknown as { gpu: number }).gpu = 0;
    invalid(locked, /locked/);
    const old = gpuState();
    (old.build.systems[0]!.spec.accels as unknown[])[0] = { kind: 'gpu', gen: 0, level: 1 };
    invalid(old, /model/);
  });

  it('validates nested saved configurations and general-board two-slot limit', () => {
    const state = gpuState(), system = state.build.systems[0]!;
    const malformed = { ...system, spec: { ...system.spec, accels: Array(3).fill(system.spec.accels[0]) } };
    const configs = { ...state.configs, rack: [{ name: 'bad', config: { servers: [malformed] } }] };
    invalid({ ...state, configs } as unknown as GameState, /configs.rack.*exceeds 2/);
  });

  it.each([
    ['negative hold', (s: GameState) => { s.hot.sys.accelUsedVram[0] = -1; }, /hold/],
    ['wrong sum', (s: GameState) => { s.hot.sys.accelUsedVram[0] = 61; }, /reservation totals/],
    ['wrong holders', (s: GameState) => { s.hot.sys.accelHolders[0] = 2; }, /reservation totals/],
    ['bad domain', (s: GameState) => { s.hot.rec.accelDomain[0] = 9; }, /accelerator clock|domain/],
    ['no list', (s: GameState) => { s.hot.sys.accelHead[0] = -1; s.hot.sys.accelActive[0] = 0; s.hot.sys.active[2] = 0; }, /list owner/],
    ['duplicate list', (s: GameState) => { s.hot.sys.accelHead[1] = 0; }, /multiply owned/],
    ['queued hold', (s: GameState) => { s.hot.rec.loc[0] = LOC.queue; s.hot.sys.accelHead[0] = -1; s.hot.sys.accelActive[0] = 0; s.hot.sys.active[2] = 0; }, /nonrunning/],
    ['old GPU head', (s: GameState) => { s.hot.sys.head[2] = 0; }, /obsolete/],
    ['nonfinite anchor', (s: GameState) => { s.hot.sys.accelEAnchor[0] = Infinity; }, /anchor/],
    ['overdrawn duty', (s: GameState) => { s.hot.sys.accelResearchS[0] = 0.1; }, /duty/],
    ['negative physical rate', (s: GameState) => { s.compiled.sys.accelOps[0] = -1; }, /physical stat/],
    ['disabled pool', (s: GameState) => { s.hot.sys.accelHolders[8] = 1; }, /disabled/],
  ] as const)('rejects %s', (_label, corrupt, pattern) => {
    const state = gpuState(true); corrupt(state); invalid(state, pattern);
  });

  it('accepts bounded reservation subtraction roundoff and preserves the saved values', () => {
    const state = gpuState(true);
    state.hot.sys.accelUsedVram[0] = 60.00000000000001; state.hot.sys.usedVram[0] = 60.00000000000001;
    const loaded = deserializeSave(serializeSave(state));
    if (!loaded.ok) throw new Error(loaded.error);
    expect(loaded.state.hot.sys.accelUsedVram[0]).toBe(60.00000000000001);
  });

  it.each([8, 9, 18])('compresses and exactly restores repeated stride %i columns', (stride) => {
    const column = Float64Array.from({ length: 100 * stride }, (_, i) => i % stride === 0 ? 1 : i % stride === 1 ? -0 : Infinity);
    const encoded = encodeArray(column);
    expect('p' in encoded && encoded.p).toBe(stride);
    expect(decodeArray(encoded)).toEqual(column);
    expect(Object.is(decodeArray(encoded)[1], -0)).toBe(true);
  });
});
