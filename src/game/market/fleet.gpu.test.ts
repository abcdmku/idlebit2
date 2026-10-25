import { evaluateGpu } from '../build/catalog/gpuModels';
import type { CompiledBuffers } from '../core/buffers';
import { ACCEL_DOMAINS, MAX_ACCELS } from '../core/constants';
import { openWorld } from '../core/world';
import type { FamilyDef } from '../types/catalog';
import { FAIL_DETAILS } from '../types/events';
import { FAMILIES } from './families';
import { canRunFleet, classesOf, DETAIL_CODE as D, detailIndex, gateOn } from './fleet';
import { HUGE_CAPS, marketState } from './testState';

interface Card { readonly kind?: 1 | 2; readonly cores: number; readonly vram: number; readonly ops: number; readonly tensor?: number; readonly clock?: number }
const family = (key: string): FamilyDef => FAMILIES.find((f) => f.key === key)!;
function cards(c: CompiledBuffers, sys: number, devices: readonly Card[], linked = false): void {
  const s = c.sys;
  for (const col of ['accelKind', 'accelCores', 'accelClockHz', 'accelVram', 'accelOps', 'accelTensorOps', 'accelIdleW', 'accelLoadW'] as const) {
    s[col].fill(0, sys * MAX_ACCELS, (sys + 1) * MAX_ACCELS);
  }
  s.gpuLinked[sys] = linked ? 1 : 0;
  devices.forEach((d, slot) => {
    const p = sys * MAX_ACCELS + slot;
    s.accelKind[p] = d.kind ?? 1; s.accelCores[p] = d.cores; s.accelClockHz[p] = d.clock ?? (d.cores > 0 ? d.ops / d.cores : 0);
    s.accelVram[p] = d.vram; s.accelOps[p] = d.ops; s.accelTensorOps[p] = d.tensor ?? d.ops;
  });
  // Leave the fixture's aggregate summaries unchanged. No gate or estimate may consult them.
}
const native = (model: Parameters<typeof evaluateGpu>[0]): Card => {
  const g = evaluateGpu(model, 0);
  return { cores: g.cores, vram: g.vramBits, clock: g.clockHz, ops: g.opsPerS, tensor: g.tensorOpsPerS };
};

describe('paired accelerator market gates', () => {
  it('keeps GPU detail positions and maps core failures to gpuCores', () => {
    expect([D.ok, D.GPU, D.gpuCores, D.VRAM]).toEqual([0, 3, 4, 5]);
    expect(FAIL_DETAILS[detailIndex(D.gpuCores)]).toBe('gpuCores');
  });

  it('requires one actual unlinked card to meet both core and VRAM minima', () => {
    const c = marketState(HUGE_CAPS).compiled, f = family('trainShard'), size = 2 ** 24;
    cards(c, 0, [native('3390'), native('3590')]);
    expect(gateOn(c, 0, f, size)).toBe(D.VRAM);
    c.sys.gpuLinked[0] = 1;
    expect(gateOn(c, 0, f, size)).toBe(0);
  });

  it('lets a slow large GPU pass and rejects a faster card with too few cores', () => {
    const c = marketState({ ...HUGE_CAPS, keff: 1 }).compiled, f = family('rayTrace');
    cards(c, 0, [{ cores: 16, vram: 32, ops: 16, clock: 1 }, { cores: 1, vram: 32, ops: 1e9, clock: 1e9 }]);
    expect(gateOn(c, 0, f, 16)).toBe(0);
    cards(c, 0, [{ cores: 1, vram: 32, ops: 1e9, clock: 1e9 }]);
    expect(gateOn(c, 0, f, 16)).toBe(D.gpuCores);
  });

  it('uses summed cores and actual rates when linked', () => {
    const c = marketState({ ...HUGE_CAPS, keff: 1 }).compiled, f = family('rayTrace');
    const inventory = Array.from({ length: 4 }, () => ({ cores: 4, vram: 8, ops: 4000, clock: 1000 }));
    cards(c, 0, inventory);
    expect(gateOn(c, 0, f, 16)).toBe(D.gpuCores);
    cards(c, 0, inventory, true);
    expect(gateOn(c, 0, f, 16)).toBe(0);
  });

  it('keeps NPU memory and tensor throughput separate from ordinary GPUs and linked pools', () => {
    const c = marketState({ ...HUGE_CAPS, keff: 1 }).compiled;
    const gpu = { cores: 256, vram: 2, ops: 256_000 };
    const npu = { kind: 2 as const, cores: 0, vram: 2 ** 20, ops: 0, tensor: 1e9 };
    for (const linked of [false, true]) {
      cards(c, 0, [gpu, npu], linked);
      expect(gateOn(c, 0, family('imageBlur'), 4)).toBe(D.VRAM);
      expect(gateOn(c, 0, family('trainShard'), 4)).toBe(D.VRAM);
      expect(gateOn(c, 0, family('inference'), 4)).toBe(0);
    }
    cards(c, 0, [npu]);
    expect(gateOn(c, 0, family('imageBlur'), 1)).toBe(D.GPU);
    expect(gateOn(c, 0, family('trainShard'), 1)).toBe(D.gpuCores);
    expect(gateOn(c, 0, family('inference'), 1)).toBe(0);
  });

  it('ignores temporary holds for static eligibility', () => {
    const w = openWorld(marketState(HUGE_CAPS));
    cards(w.compiled, 0, [native('1330')]);
    w.hot.sys.accelUsedVram[0 * ACCEL_DOMAINS] = 8192;
    expect(canRunFleet(w, family('imageBlur'), 8192)).toBe(0);
  });

  it('keeps fixed core floors independent of size and compares unrounded VRAM', () => {
    const c = marketState(HUGE_CAPS).compiled, f = family('transcode');
    cards(c, 0, [{ cores: 4, vram: 3, ops: 4 }]);
    expect(gateOn(c, 0, f, 1.5)).toBe(0);
    expect(gateOn(c, 0, f, 1.5001)).toBe(D.VRAM);
    cards(c, 0, [{ cores: 3, vram: 1e6, ops: 1e9 }]);
    expect(gateOn(c, 0, f, 0.001)).toBe(D.gpuCores);
  });
});

describe('capability classes retain ordered physical inventory', () => {
  it('does not merge independent maxima that hide a different paired capacity', () => {
    const w = openWorld(marketState(HUGE_CAPS, { serversPerRack: 2 }));
    cards(w.compiled, 0, [native('3390'), native('3590')]);
    const a = native('3390'), b = native('3590');
    cards(w.compiled, 1, [{ ...a, vram: b.vram }, { ...b, vram: a.vram }]);
    expect(classesOf(w.compiled).map((cls) => cls.members)).toEqual([[0], [1]]);
    const f = { ...family('trainShard'), members: 1 };
    expect(canRunFleet(w, f, 2 ** 24)).toBe(0);
  });

  it('distinguishes slot order and link state even with identical aggregate summaries', () => {
    const c = marketState(HUGE_CAPS, { serversPerRack: 3 }).compiled;
    const a = native('1330'), b = native('1530');
    cards(c, 0, [a, b]); cards(c, 1, [b, a]); cards(c, 2, [a, b], true);
    expect(classesOf(c).map((cls) => cls.members)).toEqual([[0], [1], [2]]);
  });

  it.each(['accelKind', 'accelCores', 'accelClockHz', 'accelVram', 'accelOps', 'accelTensorOps', 'accelIdleW', 'accelLoadW'] as const)(
    'includes slot eight %s in the complete class signature', (col) => {
      const c = marketState(HUGE_CAPS, { serversPerRack: 2 }).compiled;
      c.sys[col][MAX_ACCELS + 7] = c.sys[col][MAX_ACCELS + 7]! + 1;
      expect(classesOf(c).map((cls) => cls.members)).toEqual([[0], [1]]);
    },
  );
});
