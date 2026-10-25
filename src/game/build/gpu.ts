import type { GpuBuild, GpuGeneration, GpuStats, GpuTechnology } from '../types/gpu';
import type { Unlocks } from '../types/state';
import { evaluateGpu, gpuModel } from './catalog/gpuModels';
import { hasRule, ruleParam } from './research/unlocks';

/** Memory technologies affect every card; tensor technologies retain generation floors. */
export function gpuTechnology(u: Unlocks, generation: GpuGeneration): GpuTechnology {
  const tensor = hasRule(u, 'tensorRate');
  const minimum = ruleParam(u, 'tensorRate', 'minGpuGen', 4);
  const factor = ruleParam(u, 'tensorRate', 'factor', 4);
  return {
    vramMultiplier: ruleParam(u, 'vramPerLevel', 'factor', 1),
    hbmIdleFactor: ruleParam(u, 'vramScale', 'idle', 1),
    tensorFactor: !tensor || generation < 4 ? 1 : generation >= minimum ? factor : 4,
  };
}

export function installedGpuStats(card: GpuBuild, u: Unlocks): GpuStats {
  const native = gpuModel(card.model);
  if (!native) throw new RangeError(`Unknown GPU model: ${card.model}`);
  return evaluateGpu(card.model, card.upgrades, gpuTechnology(u, native.generation));
}
