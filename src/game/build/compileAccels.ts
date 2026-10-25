import type { CompiledBuffers } from '../core/buffers';
import { MAX_ACCELS } from '../core/constants';
import type { SystemBuild } from '../types/build';
import type { Unlocks } from '../types/state';
import { capacity, capacity2, PARTS, partWatts } from './catalog';
import { installedGpuStats } from './gpu';
import { hasRule, ruleParam } from './research/unlocks';

/** Physical slots are authoritative. Aggregate columns are GPU-only diagnostics. */
export function compileAccels(c: CompiledBuffers, build: SystemBuild, u: Unlocks): { idle: number; load: number } {
  if (build.spec.accels.length > MAX_ACCELS) throw new RangeError('Too many accelerators');
  const s = c.sys, sys = build.id, offset = sys * MAX_ACCELS;
  for (const key of ['accelKind', 'accelCores', 'accelClockHz', 'accelVram', 'accelOps', 'accelTensorOps', 'accelIdleW', 'accelLoadW'] as const) {
    s[key].fill(0, offset, offset + MAX_ACCELS);
  }
  let idle = 0, load = 0, npus = 0, opsMax = 0, opsSum = 0, tensorMax = 0, tensorSum = 0, vramMax = 0, vramSum = 0;
  build.spec.accels.forEach((card, slot) => {
    const at = offset + slot;
    if (card.kind === 'gpu') {
      const stats = installedGpuStats(card, u);
      s.accelKind[at] = 1;
      s.accelCores[at] = stats.cores; s.accelClockHz[at] = stats.clockHz;
      s.accelVram[at] = stats.vramBits; s.accelOps[at] = stats.opsPerS; s.accelTensorOps[at] = stats.tensorOpsPerS;
      s.accelIdleW[at] = stats.idleW; s.accelLoadW[at] = stats.loadW;
      opsMax = Math.max(opsMax, stats.opsPerS); opsSum += stats.opsPerS;
      tensorMax = Math.max(tensorMax, stats.tensorOpsPerS); tensorSum += stats.tensorOpsPerS;
      vramMax = Math.max(vramMax, stats.vramBits); vramSum += stats.vramBits;
    } else {
      const row = PARTS.npu;
      const watts = partWatts(row, card.gen, card.level);
      s.accelKind[at] = 2;
      s.accelVram[at] = capacity2(row, card.gen, card.level) * ruleParam(u, 'vramPerLevel', 'factor', 1);
      s.accelTensorOps[at] = capacity(row, card.gen, card.level) * row.tensorFactor![card.gen]!;
      s.accelIdleW[at] = watts.idle; s.accelLoadW[at] = watts.load;
      npus += 1;
    }
    idle += s.accelIdleW[at]!; load += s.accelLoadW[at]!;
  });
  const link = hasRule(u, 'gpuLink');
  s.gpuLinked[sys] = link ? 1 : 0;
  s.gpuOps[sys] = link ? opsSum : opsMax;
  s.tensorOps[sys] = link ? tensorSum : tensorMax;
  s.vram[sys] = link ? vramSum : vramMax;
  s.npu[sys] = npus;
  return { idle, load };
}
