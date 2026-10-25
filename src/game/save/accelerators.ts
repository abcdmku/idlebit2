import { accelNeed, readAccelDomain } from '../core/accelerators';
import { LOC } from '../core/buffers';
import { ACCEL_CLOCKS, ACCEL_DOMAINS, DT_S, GENERAL_MAX_GPUS, MAX_ACCELS } from '../core/constants';
import { FAMILIES } from '../market/families';
import { partClock } from '../exec/memory';
import { shapeOf } from '../exec/shape';
import { evaluateGpu, gpuModel } from '../build/catalog/gpuModels';
import { installedGpuStats } from '../build/gpu';
import type { GameState } from '../types/state';

type Reject = (path: string, reason: string) => never;
type Obj = Record<string, unknown>;
const object = (value: unknown): value is Obj => typeof value === 'object' && value !== null && !Array.isArray(value);
const nonnegative = (value: number) => Number.isFinite(value) && value >= 0;
/** Validation only: bounded accumulation/subtraction roundoff, never an eligibility tolerance. */
const close = (a: number, b: number, terms: number) => Math.abs(a - b) <= Number.EPSILON * Math.max(1, a, b) * Math.max(16, 4 * terms);

/** Validate both installed and saved hardware; legacy GPU gen/level objects intentionally reset. */
export function validateAccelBuilds(state: GameState, fail: Reject): void {
  const unlocks = state.research.unlocks;
  if (!object(unlocks.gens) || !object(unlocks.ceilings)) fail('research.unlocks', 'missing generation or slot unlocks');
  if (!Array.isArray(unlocks.rules) || !object(unlocks.ruleParams)) fail('research.unlocks', 'missing technology rules');
  for (const [rule, params] of Object.entries(unlocks.ruleParams)) {
    if (!object(params) || Object.values(params).some((n) => typeof n !== 'number' || !Number.isFinite(n))) fail(`research.unlocks.ruleParams.${rule}`, 'invalid technology parameters');
  }
  const visit = (value: unknown, path: string, depth = 0): void => {
    if (depth > 3) fail(path, 'configuration hierarchy exceeds site depth');
    if (!object(value)) fail(path, 'expected configuration object');
    if ('spec' in value) { spec(value.spec, `${path}.spec`); return; }
    for (const key of ['servers', 'racks', 'zones']) {
      if (!(key in value)) continue;
      if (!Array.isArray(value[key])) fail(`${path}.${key}`, 'expected array');
      (value[key] as unknown[]).forEach((child, i) => { if (child !== null) visit(child, `${path}.${key}[${i}]`, depth + 1); });
      return;
    }
    fail(path, 'missing nested hardware');
  };
  const spec = (value: unknown, path: string): void => {
    if (!object(value) || !Array.isArray(value.accels)) fail(path, 'expected accelerator array');
    if (value.board !== 'general' && value.board !== 'accelerator') fail(`${path}.board`, 'unknown board');
    const max = value.board === 'general' ? GENERAL_MAX_GPUS : MAX_ACCELS;
    if (value.accels.length > max) fail(`${path}.accels`, `exceeds ${max} slots`);
    if (value.board === 'general' && value.accels.length > unlocks.ceilings.gpuSlots) fail(`${path}.accels`, 'accelerator slot is locked');
    value.accels.forEach((raw: unknown, slot: number) => {
      const at = `${path}.accels[${slot}]`;
      if (!object(raw)) fail(at, 'expected accelerator build');
      if (raw.kind === 'gpu') {
        const model = typeof raw.model === 'string' ? gpuModel(raw.model) : null;
        if (!model) fail(`${at}.model`, 'invalid GPU model');
        if (!Number.isInteger(raw.upgrades) || (raw.upgrades as number) < 0 || (raw.upgrades as number) > 5) fail(`${at}.upgrades`, 'expected 0..5 hot upgrades');
        if ('gen' in raw || 'level' in raw) fail(at, 'obsolete GPU gen/level build');
        evaluateGpu(model.model, raw.upgrades as number);
        const gen = model.generation - 1;
        if (!(unlocks.gens.gpu & 1) || !(unlocks.gens.gpu & (1 << gen))) fail(at, 'GPU generation is locked');
      } else if (raw.kind === 'npu') {
        if (!Number.isInteger(raw.gen) || (raw.gen as number) < 0 || (raw.gen as number) > 3) fail(`${at}.gen`, 'expected NPU generation 0..3');
        if (!Number.isInteger(raw.level) || (raw.level as number) < 1 || (raw.level as number) > 11 + (raw.gen as number)) fail(`${at}.level`, 'invalid NPU level');
        if (!(unlocks.gens.npu & 1) || !(unlocks.gens.npu & (1 << (raw.gen as number)))) fail(at, 'NPU generation is locked');
        const required = ['npu', ...(raw.gen === 1 ? ['gpuGen2'] : raw.gen === 2 ? ['tensorCores'] : raw.gen === 3 ? ['matrixGpu'] : [])];
        if (required.some((id) => !state.research.completed.some((done) => done === id))) fail(at, 'NPU prerequisite is locked');
      } else fail(`${at}.kind`, 'unknown accelerator kind');
    });
  };
  state.build.systems.forEach((system, i) => { if (system !== null) visit(system, `build.systems[${i}]`); });
  for (const kind of ['system', 'rack', 'room', 'site'] as const) {
    state.configs[kind].forEach((saved, i) => {
      if (!object(saved)) fail(`configs.${kind}[${i}]`, 'expected saved configuration');
      visit(saved.config, `configs.${kind}[${i}].config`);
    });
  }
}

/** Validate paired hardware, lifetime holds and every accelerator run-list without changing state. */
export function validateAccelRuntime(state: GameState, fail: Reject): void {
  const { compiled: c, hot: h } = state, s = c.sys, hot = h.sys, rec = h.rec;
  const holds = new Float64Array(s.len * ACCEL_DOMAINS), holders = new Float64Array(holds.length);
  const seen = new Uint8Array(rec.len), sums = new Float64Array(holds.length);
  const demand = (r: number) => {
    const f = FAMILIES[rec.family[r]!];
    if (!f || rec.stage[r]! >= f.stages.length || !nonnegative(rec.units[r]!)) fail(`hot.rec[${r}]`, 'invalid family, stage or scale');
    return { family: f, need: accelNeed(f, rec.units[r]!) };
  };
  const list = (sys: number, head: number, resource: number, domain = -1, tensor = false): number => {
    let count = 0, prev = -1, finish = -Infinity;
    for (let r = head; r !== -1; r = rec.next[r]!) {
      if (r < 0 || r >= rec.len || seen[r]) fail('hot.sys', 'invalid, cyclic or multiply owned run list');
      seen[r] = 1;
      if (rec.loc[r] !== LOC.running || rec.owner[r] !== sys || rec.prev[r] !== prev) fail(`hot.rec[${r}]`, 'run-list ownership mismatch');
      const { family } = demand(r);
      // D26.2: the record's current stage part names its clock (a mem stage's RAM and disk parts).
      if (rec.part[r]! > 2 || partClock(shapeOf(rec.family[r]!), rec.stage[r]!, rec.part[r]!) !== resource) fail(`hot.rec[${r}]`, 'wrong resource list');
      if (resource === 2 && (rec.accelDomain[r] !== domain || family.tensor !== tensor)) fail(`hot.rec[${r}].accelDomain`, 'wrong accelerator clock');
      const waitingIo = resource === 3 && rec.start[r] === Infinity && rec.finish[r] === Infinity;
      // Linking rebases in-flight work onto a new clock; completed work can put its start below zero.
      if (!waitingIo && (!Number.isFinite(rec.start[r]!) || !nonnegative(rec.finish[r]!) || rec.start[r]! > rec.finish[r]!)) fail(`hot.rec[${r}]`, 'invalid stage work positions');
      if (rec.finish[r]! < finish) fail(`hot.rec[${r}].finish`, 'unsorted finish');
      finish = rec.finish[r]!; count += rec.count[r]!; prev = r;
    }
    return count;
  };
  for (let sys = 0; sys < s.len; sys += 1) {
    const spec = state.build.systems[sys]?.spec;
    const linked = s.alive[sys] === 1 && state.research.unlocks.rules.includes('gpuLink');
    if (s.gpuLinked[sys] !== Number(linked)) fail(`compiled.sys.gpuLinked[${sys}]`, 'does not match live GPU-link research');
    for (let slot = 0; slot < MAX_ACCELS; slot += 1) {
      const p = sys * MAX_ACCELS + slot, build = spec?.accels[slot], kind = s.accelKind[p]!;
      if (kind !== (build ? build.kind === 'gpu' ? 1 : 2 : 0)) fail(`compiled.sys.accelKind[${p}]`, 'does not match installed hardware');
      for (const key of ['accelCores', 'accelClockHz', 'accelVram', 'accelOps', 'accelTensorOps', 'accelIdleW', 'accelLoadW'] as const) {
        if (!nonnegative(s[key][p]!) || (!kind && s[key][p] !== 0)) fail(`compiled.sys.${key}[${p}]`, 'invalid physical stat');
      }
      if (kind === 1 && (!Number.isSafeInteger(s.accelCores[p]) || !(s.accelCores[p]! > 0 && s.accelClockHz[p]! > 0 && s.accelOps[p]! > 0))) fail(`compiled.sys.accelCores[${p}]`, 'GPU requires positive integral cores and rate');
      if (build?.kind === 'gpu') {
        let expected;
        try { expected = installedGpuStats(build, state.research.unlocks); }
        catch { fail(`build.systems[${sys}].spec.accels[${slot}]`, 'invalid GPU technology'); }
        const fields = { accelCores: expected.cores, accelClockHz: expected.clockHz, accelVram: expected.vramBits,
          accelOps: expected.opsPerS, accelTensorOps: expected.tensorOpsPerS, accelIdleW: expected.idleW, accelLoadW: expected.loadW };
        for (const [key, value] of Object.entries(fields)) if (s[key as keyof typeof fields][p] !== value) fail(`compiled.sys.${key}[${p}]`, 'does not match evaluated GPU model');
      }
      if (kind === 2 && (s.accelCores[p] !== 0 || s.accelOps[p] !== 0 || !(s.accelTensorOps[p]! > 0))) fail(`compiled.sys.accelOps[${p}]`, 'NPU must be tensor only');
      const task = hot.accelTaskS[p]!, research = hot.accelResearchS[p]!;
      if (!nonnegative(task) || !nonnegative(research) || task + research > DT_S + Number.EPSILON * 16 || (!kind && task + research !== 0)) fail(`hot.sys.accelTaskS[${p}]`, 'invalid per-card duty');
    }
    if (!nonnegative(hot.accelResearchOps[sys]!)) fail(`hot.sys.accelResearchOps[${sys}]`, 'invalid research work');
    const old = sys * 4 + 2;
    if (hot.head[old] !== -1 || hot.rate[old] !== 0 || hot.due[old] !== Infinity) fail(`hot.sys.head[${old}]`, 'obsolete system GPU clock must be empty');
    for (const resource of [0, 1, 3]) list(sys, hot.head[sys * 4 + resource]!, resource);
    let gpuActive = 0;
    for (let domain = 0; domain < ACCEL_DOMAINS; domain += 1) {
      const at = sys * ACCEL_DOMAINS + domain, enabled = readAccelDomain(c, sys, domain);
      if (!nonnegative(hot.accelUsedVram[at]!)) fail(`hot.sys.accelUsedVram[${at}]`, 'invalid hold');
      if (!enabled && (hot.accelUsedVram[at] !== 0 || hot.accelHolders[at] !== 0)) fail(`hot.sys.accelHolders[${at}]`, 'disabled domain has holders');
      for (let tensor = 0; tensor < 2; tensor += 1) {
        const clock = sys * ACCEL_CLOCKS + 2 * domain + tensor;
        for (const key of ['accelWAnchor', 'accelEAnchor', 'accelRate'] as const) if (!nonnegative(hot[key][clock]!)) fail(`hot.sys.${key}[${clock}]`, 'invalid clock anchor or rate');
        const due = hot.accelDue[clock]!;
        if (!nonnegative(due) && due !== Infinity) fail(`hot.sys.accelDue[${clock}]`, 'invalid due');
        if ((!enabled || enabled.kind === 'npu' && tensor === 0) && (hot.accelHead[clock] !== -1 || hot.accelActive[clock] !== 0 || hot.accelRate[clock] !== 0 || due !== Infinity)) fail(`hot.sys.accelHead[${clock}]`, 'disabled domain clock is not empty');
        const active = list(sys, hot.accelHead[clock]!, 2, domain, tensor === 1);
        if (active !== hot.accelActive[clock]) fail(`hot.sys.accelActive[${clock}]`, 'does not match run-list count');
        gpuActive += active;
      }
    }
    if (gpuActive !== hot.active[old]) fail(`hot.sys.active[${old}]`, 'GPU summary does not match accelerator clocks');
  }
  for (let r = 0; r < rec.len; r += 1) {
    const domain = rec.accelDomain[r]!;
    if (!Number.isInteger(domain) || domain < -1 || domain >= ACCEL_DOMAINS) fail(`hot.rec.accelDomain[${r}]`, 'invalid domain');
    if (rec.loc[r] !== LOC.running) {
      if (domain !== -1) fail(`hot.rec.accelDomain[${r}]`, 'nonrunning record has accelerator hold');
      continue;
    }
    const sys = rec.owner[r]!;
    if (sys < 0 || sys >= s.len || s.alive[sys] !== 1 || !seen[r] || rec.count[r] === 0) fail(`hot.rec[${r}]`, 'running record has no valid list owner');
    const { family, need } = demand(r);
    if (!need.required) {
      if (domain !== -1) fail(`hot.rec.accelDomain[${r}]`, 'nonaccelerator task has a hold');
      continue;
    }
    const d = readAccelDomain(c, sys, domain);
    if (!d || (d.kind === 'npu' && (!family.tensor || need.gpuCores > 0)) || d.gpuCores < need.gpuCores || d.vramBits + s.unifiedBits[sys]! < need.vramBits || !((family.tensor ? d.tensorOpsPerS : d.opsPerS) > 0)) fail(`hot.rec.accelDomain[${r}]`, 'incompatible accelerator assignment');
    const at = sys * ACCEL_DOMAINS + domain;
    // With unifiedMemory part of the need sits in RAM and on disk (D26.4).
    holds[at] = holds[at]! + rec.count[r]! * Math.max(0, need.vramBits - rec.vramR[r]! - rec.vramD[r]!);
    holders[at] = holders[at]! + rec.count[r]!;
    sums[at] = sums[at]! + 1;
  }
  for (let sys = 0; sys < s.len; sys += 1) {
    let total = 0;
    for (let domain = 0; domain < ACCEL_DOMAINS; domain += 1) {
      const at = sys * ACCEL_DOMAINS + domain, held = hot.accelUsedVram[at]!, d = readAccelDomain(c, sys, domain);
      if (hot.accelHolders[at] !== holders[at] || !close(held, holds[at]!, sums[at]!)) fail(`hot.sys.accelUsedVram[${at}]`, 'reservation totals do not match running records');
      if (!holders[at] && held !== 0 || d && held > d.vramBits && !close(held, d.vramBits, sums[at]!)) fail(`hot.sys.accelUsedVram[${at}]`, 'invalid or over-capacity reservation');
      total += held;
    }
    if (!close(hot.usedVram[sys]!, total, rec.len)) fail(`hot.sys.usedVram[${sys}]`, 'diagnostic total does not match domains');
  }
}
