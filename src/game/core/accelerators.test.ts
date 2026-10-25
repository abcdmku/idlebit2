import type { FamilyDef } from '../types/catalog';
import { familyId } from '../types/ids';
import { accelGate, accelNeed, chooseAccel, readAccelDomain, type AccelNeed } from './accelerators';
import { allocCompiled, allocHot } from './buffers';

const size = { systems: 1, racks: 1, rooms: 1, sites: 1, links: 0 };
const need = (gpuCores = 1, vramBits = 60, tensor = false): AccelNeed => ({ required: true, tensor, gpuCores, vramBits });
const fixture = () => ({ c: allocCompiled(size), h: allocHot(size) });
function card(c: ReturnType<typeof allocCompiled>, slot: number, cores: number, vram: number, hz: number, npu = false) {
  const s = c.sys;
  s.accelKind[slot] = npu ? 2 : 1; s.accelCores[slot] = npu ? 0 : cores;
  s.accelVram[slot] = vram; s.accelClockHz[slot] = hz;
  s.accelOps[slot] = npu ? 0 : cores * hz; s.accelTensorOps[slot] = npu ? hz : cores * hz * 4;
}

describe('paired accelerator domains', () => {
  it('keeps a fitting slow card paired with its own rate and ignores minimum clock', () => {
    const { c, h } = fixture();
    card(c, 0, 8, 10, 1e9); card(c, 1, 8, 100, 0.125);
    expect(accelGate(c, 0, need(8))).toBe(0);
    expect(chooseAccel(c, h, 0, need(8), 4)).toEqual({ domain: 1, take: 1, opsPerS: 1 });
    expect(accelGate(c, 0, need(9))).toBe(4);
    expect(accelGate(c, 0, need(8, 101))).toBe(5);
  });

  it('never combines unlinked capacity and sums rates of only linked GPUs', () => {
    const { c } = fixture();
    card(c, 0, 2, 60, 10); card(c, 1, 3, 60, 100); card(c, 2, 0, 1000, 1e6, true);
    expect(accelGate(c, 0, need(5, 100))).toBe(4);
    c.sys.gpuLinked[0] = 1;
    expect(readAccelDomain(c, 0, 0)).toBeNull();
    expect(readAccelDomain(c, 0, 8)).toEqual({ kind: 'gpu', gpuCores: 5, vramBits: 120, opsPerS: 320, tensorOpsPerS: 1280 });
    expect(chooseAccel(c, null, 0, need(5, 100), 3)).toEqual({ domain: 8, take: 1, opsPerS: 320 });
    expect(readAccelDomain(c, 0, 2)?.kind).toBe('npu');
  });

  it('uses zero-core tensor NPUs independently, without lending their memory to GPUs', () => {
    const { c } = fixture(); card(c, 0, 0, 100, 500, true);
    expect(accelGate(c, 0, need(0))).toBe(3);
    expect(accelGate(c, 0, need(1, 60, true))).toBe(4);
    expect(chooseAccel(c, null, 0, need(0, 60, true), 1)).toEqual({ domain: 0, take: 1, opsPerS: 500 });
    card(c, 1, 4, 20, 100); c.sys.gpuLinked[0] = 1;
    expect(accelGate(c, 0, need(1, 60))).toBe(5);
  });

  it('honors lifetime holds while static eligibility remains true', () => {
    const { c, h } = fixture(); card(c, 0, 8, 100, 100); card(c, 1, 8, 100, 100);
    expect(chooseAccel(c, h, 0, need(), 10)).toEqual({ domain: 0, take: 1, opsPerS: 800 });
    h.sys.accelUsedVram[0] = 60;
    expect(chooseAccel(c, h, 0, need(), 10)?.domain).toBe(1);
    h.sys.accelUsedVram[1] = 60;
    expect(chooseAccel(c, h, 0, need(), 1)).toBeNull();
    expect(accelGate(c, 0, need())).toBe(0);
    expect(chooseAccel(c, null, 0, need(), 1)?.domain).toBe(0);
    expect(chooseAccel(c, h, 0, need(1, 0), 20)?.take).toBe(20);
  });

  it('keeps fixed core minima and existing VRAM size arithmetic', () => {
    const family: FamilyDef = {
      id: familyId(0), key: 'test', name: 'Test', band: 'gpu', note: '', window: { from: 0, to: 1 }, weight: 1,
      stages: [{ resource: 'gpu', work: { fixed: 1, perSize: 0 } }], threads: 1,
      tensor: true, gpuCoresMin: 32, vramBits: { fixed: 0.25, perSize: 0.5 },
      workingSet: { fixed: 0, perSize: 0 }, storageBits: { fixed: 0, perSize: 0 },
      members: 1, minZones: 1, region: { kind: 'any' }, ecc: false, affinity: 'accelerator', dataRatio: 10,
    };
    expect(accelNeed(family, 1.5)).toEqual({ required: true, tensor: true, gpuCores: 32, vramBits: 1 });
    expect(accelNeed(family, 2)).toEqual({ required: true, tensor: true, gpuCores: 32, vramBits: 1.25 });
    const { c, h } = fixture();
    expect(chooseAccel(c, h, 0, { ...need(), required: false }, 3)).toEqual({ domain: -1, take: 3, opsPerS: 0 });
  });
});
