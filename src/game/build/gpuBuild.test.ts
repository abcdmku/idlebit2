import { amount } from '../amount';
import { applyAction } from '../core/actions';
import { DT_S, MAX_ACCELS } from '../core/constants';
import { compileAll } from '../core/topology';
import { buildState } from '../testkit/builders';
import type { SystemSpec } from '../types/build';
import type { AccelBuild } from '../types/gpu';
import { systemId, type PartRef } from '../types/ids';
import type { GameState } from '../types/state';
import { deserializeSave, serializeSave } from '../save/serialize';
import { GPU_MODEL_IDS, gpuInstallPrice, gpuNativePrice, gpuPriceToLevel, gpuUpgradePrice, PARTS } from './catalog';
import { mergeSpec, saveConfig, planApplyConfig } from './configs';
import { systemLock } from './configModel';
import { installedGpuStats } from './gpu';
import { planInstallGpu } from './gpuPlans';
import { readPart, writePart } from './partAccess';
import { planAdd } from './partPlans';
import { systemSpecPrice } from './pricing';
import { quote } from './quotes';
import { deriveUnlocks } from './research/effects';
import { RESEARCH } from './research/tree';
import { genUnlocked } from './research/unlocks';

const card = (model: '1330' | '1530' | '1390' | '1990' | '3350' | '9990' = '1330', upgrades = 0): AccelBuild => ({ kind: 'gpu', model, upgrades });
const id = systemId(0);
const ref = (index = 0): PartRef => ({ unit: { kind: 'system', id }, slot: { kind: 'gpu', index } });
function fixture(accels: readonly AccelBuild[] = [], board: SystemSpec['board'] = 'general'): GameState {
  const base = buildState({ seed: 42, sites: 1, zonesPerSite: 1, racksPerZone: 1, serversPerRack: 1 });
  const completed = RESEARCH.filter((r) => r.id !== 'gpuLink').map((r) => r.id);
  const research = { ...base.research, completed, unlocks: deriveUnlocks(completed) };
  const build = { ...base.build, systems: base.build.systems.map((s) => s && ({ ...s, spec: { ...s.spec, board, accels } })) };
  const compiled = compileAll(build, research);
  return { ...base, build, compiled, research,
    wallet: { ...base.wallet, credits: amount('1000000000000000000000000000000') } };
}

describe('model GPU builds', () => {
  it('compiles paired physical stats and GPU-only summaries, keeping NPUs separate', () => {
    const state = fixture([card('1330'), card('1530'), { kind: 'npu', gen: 3, level: 14 }], 'accelerator');
    const c = state.compiled.sys;
    expect(Array.from(c.accelKind.subarray(0, 4))).toEqual([1, 1, 2, 0]);
    expect(Array.from(c.accelCores.subarray(0, 3))).toEqual([4, 1, 0]);
    expect(Array.from(c.accelOps.subarray(0, 3))).toEqual([4000, 1000, 0]);
    expect(c.accelTensorOps[2]).toBe(2.56e11 * 2 ** 13 * 8);
    expect([c.gpuOps[0], c.tensorOps[0], c.vram[0], c.npu[0]]).toEqual([4000, 4000, 32768 * 16, 1]);
    const research = { ...state.research, unlocks: { ...state.research.unlocks, rules: [...state.research.unlocks.rules, 'gpuLink' as const] } };
    const linked = compileAll(state.build, research).sys;
    expect([linked.gpuOps[0], linked.tensorOps[0], linked.vram[0]]).toEqual([5000, 5000, (8192 + 32768) * 16]);
  });

  it('evaluates total HBM capacity, GPU-only idle savings and generation-floor tensor technology', () => {
    const u = fixture().research.unlocks;
    const g1 = installedGpuStats({ kind: 'gpu', model: '1330', upgrades: 0 }, u);
    expect(g1.vramBits).toBe(8192 * 16);
    expect(g1.tensorOpsPerS).toBe(g1.opsPerS);
    expect(g1.idleW).toBe(5400);
    for (const model of ['4330', '5330', '6330'] as const) {
      const s = installedGpuStats({ kind: 'gpu', model, upgrades: 0 }, u);
      expect(s.tensorOpsPerS / s.opsPerS).toBe(model[0] === '6' ? 8 : 4);
    }
  });

  it('freezes exactly four NPU rows and their own research gates', () => {
    expect(PARTS.npu.base).toEqual([32, 64000, 128000000, 256000000000]);
    expect(PARTS.npu.price).toEqual([3000000, 7500000, 45000000000, 75000000000000]);
    expect(PARTS.npu.gates).toEqual(['npu', 'gpuGen2', 'tensorCores', 'matrixGpu']);
    const withoutNpu = deriveUnlocks(RESEARCH.filter((r) => r.id !== 'npu').map((r) => r.id));
    expect(genUnlocked(withoutNpu, 'npu', 1)).toBe(false);
    const withoutTensor = deriveUnlocks(RESEARCH.filter((r) => !['tensorCores', 'matrixGpu'].includes(r.id)).map((r) => r.id));
    expect(genUnlocked(withoutTensor, 'npu', 1)).toBe(true);
    expect(genUnlocked(withoutTensor, 'npu', 2)).toBe(false);
    expect(genUnlocked(fixture().research.unlocks, 'npu', 4)).toBe(false);
  });

  it('rejects generic GPU adds and replacements without a model', () => {
    const state = fixture([card()]);
    expect(planAdd(state, id, 'gpu', 0).ok).toBe(false);
    expect(applyAction(state, { type: 'replacePart', part: ref(), generation: 1, preserveCapacity: false }).ok).toBe(false);
  });

  it('keeps general boards at two shared slots and accelerator boards at eight', () => {
    expect(planInstallGpu(fixture([card(), card()]), id, '1330', null).ok).toBe(false);
    expect(planInstallGpu(fixture(Array.from({ length: 7 }, () => card()), 'accelerator'), id, '1330', null).ok).toBe(true);
    expect(planInstallGpu(fixture(Array.from({ length: MAX_ACCELS }, () => card()), 'accelerator'), id, '1330', null).ok).toBe(false);
  });

  it('enumerates every concrete model, including legitimate locked next-generation choices', () => {
    const full = fixture();
    const unlocks = deriveUnlocks(RESEARCH.filter((r) => !/^gpuGen[2-9]$/.test(r.id)).map((r) => r.id));
    const state = { ...full, research: { ...full.research, unlocks } };
    const quotes = quote(state, { kind: 'gpuModels', system: id, index: null, generation: 2 }).quotes;
    expect(quotes).toHaveLength(24);
    expect(quotes.map((q) => q.gpu?.after.model)).toEqual(GPU_MODEL_IDS.filter((m) => m[0] === '2'));
    expect(quotes.every((q) => q.locked?.node === 'gpuGen2')).toBe(true);
    const tray = quote(full, { kind: 'tray', at: { level: 'system', id } }).quotes[2]!;
    expect(tray.action.type).toBe('installGpu');
    expect(tray.gpu?.after.model).toBe('9330');
  });

  it('re-quotes exact install escalation at debit and excludes NPUs', () => {
    const before = fixture([card()], 'accelerator');
    const request = { kind: 'gpuModels' as const, system: id, index: null, generation: 9 as const };
    const choice = quote(before, request).quotes.find((q) => q.gpu?.after.model === '9990')!;
    expect(choice.cost).toBe(gpuNativePrice('9990').toString());
    const current = fixture([card(), { kind: 'npu', gen: 0, level: 1 }, card()], 'accelerator');
    const out = applyAction(current, choice.action);
    expect(out.ok).toBe(true);
    expect(BigInt(current.wallet.credits) - BigInt(out.state.wallet.credits)).toBe(gpuInstallPrice('9990', 2));
    expect(out.state.build.systems[0]!.spec.accels[3]).toEqual(card('9990'));
  });

  it('hot upgrades retain model identity and expose adapters without storing gen/level', () => {
    let state = fixture([card('3350')]);
    const original = state.build.systems[0]!.spec.cpu;
    const start = BigInt(state.wallet.credits);
    for (let upgrades = 1; upgrades <= 5; upgrades += 1) {
      const out = applyAction(state, { type: 'upgradePart', part: ref() });
      expect(out.ok).toBe(true);
      state = out.state;
      expect(state.build.systems[0]!.spec.accels[0]).toEqual(card('3350', upgrades));
      expect(readPart(state.build, ref())).toMatchObject({ gen: 2, level: upgrades + 1 });
      expect(state.build.systems[0]!.spec.cpu).toBe(original);
    }
    expect(start - BigInt(state.wallet.credits)).toBe(gpuPriceToLevel('3350', 5) - gpuNativePrice('3350'));
    expect(applyAction(state, { type: 'upgradePart', part: ref() }).ok).toBe(false);
    expect(writePart(state.build, ref(), 3, 1)).toBeNull();
  });

  it('replaces a model in the same generation at its full native cost', () => {
    const state = fixture([card('1330', 5)]);
    const out = applyAction(state, { type: 'installGpu', system: id, index: 0, model: '1990' });
    expect(out.ok).toBe(true);
    expect(out.state.build.systems[0]!.spec.accels).toEqual([card('1990')]);
    expect(BigInt(state.wallet.credits) - BigInt(out.state.wallet.credits)).toBe(gpuNativePrice('1990'));
    const replacement = quote(state, { kind: 'gpuModels', system: id, index: 0, generation: 1 }).quotes.find((q) => q.gpu?.after.model === '1990')!;
    expect(replacement.effect?.capacityBefore).toBe(installedGpuStats({ kind: 'gpu', model: '1330', upgrades: 5 }, state.research.unlocks).opsPerS);
    expect(replacement.effect?.capacityAfter).toBe(384000);
  });

  it('previews the selected card with its actual duty, regardless of CPU busy or another faster card', () => {
    const state = fixture([card('1330'), card('1390')]);
    state.hot.sys.busy[0] = 1;
    state.hot.sys.accelTaskS[0] = DT_S / 2;
    const up = quote(state, { kind: 'part', part: ref() }).quotes[0]!;
    const before = installedGpuStats({ kind: 'gpu', model: '1330', upgrades: 0 }, state.research.unlocks);
    const after = installedGpuStats({ kind: 'gpu', model: '1330', upgrades: 1 }, state.research.unlocks);
    expect(up.gpu).toEqual({ before, after });
    expect(up.effect).toMatchObject({ capacityBefore: 4000, capacityAfter: 10000,
      wattsBefore: before.idleW + before.loadW / 2, wattsAfter: after.idleW + after.loadW / 2 });
  });

  it('prices saved/copied pushed cards and merges only matching models hot', () => {
    const state = fixture([card('3350', 3)]);
    const want = state.build.systems[0]!.spec;
    const empty = { ...want, accels: [] };
    expect(systemSpecPrice(want) - systemSpecPrice(empty)).toBe(gpuPriceToLevel('3350', 3));
    const native = { ...want, accels: [card('3350')] };
    expect(mergeSpec(native, want)).toMatchObject({ cold: false, price: gpuPriceToLevel('3350', 3) - gpuNativePrice('3350') });
    expect(mergeSpec(want, native)).toMatchObject({ cold: false, price: 0n, spec: want });
    expect(mergeSpec({ ...want, accels: [card('1330', 3)] }, want)).toMatchObject({ cold: true, price: gpuPriceToLevel('3350', 3) });
    const saved = saveConfig(state, { kind: 'system', id }, 'Pushed GPU');
    expect(saved.ok).toBe(true);
    expect(saved.state.configs.system[0]!.config.spec.accels).toEqual([card('3350', 3)]);
    const loaded = deserializeSave(serializeSave(saved.state));
    expect(loaded.ok ? loaded.state.configs.system[0]!.config.spec.accels : loaded.error).toEqual([card('3350', 3)]);
    expect(planApplyConfig(saved.state, { kind: 'system', id }, 'Pushed GPU')).toMatchObject({ ok: true, change: { price: 0n } });
    expect(systemLock(state.research.unlocks, { ...want, accels: [{ kind: 'gpu', model: '1330', upgrades: 6 }] })?.text).toBe('Invalid GPU upgrades');
    expect(gpuUpgradePrice('3350', 0)).toBe(120000000n);
  });

  it('charges escalated native prices and every push when copying a mixed accelerator configuration', () => {
    const state = fixture([card('3350', 3), { kind: 'npu', gen: 0, level: 1 }, card('3350', 2), card('3350', 1)], 'accelerator');
    const spec = state.build.systems[0]!.spec;
    const empty = { ...spec, accels: [] };
    const upgrades = [3, 2, 1].reduce((sum, u) => sum + gpuPriceToLevel('3350', u) - gpuNativePrice('3350'), 0n);
    const native = [0, 1, 2].reduce((sum, n) => sum + gpuInstallPrice('3350', n), 0n);
    expect(systemSpecPrice(spec) - systemSpecPrice(empty)).toBe(upgrades + native + 3000000n);
    expect(mergeSpec(empty, spec)).toMatchObject({ cold: true, price: upgrades + native + 3000000n });
  });
});
