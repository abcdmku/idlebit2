import type { AccelBuild } from '../types/gpu';
import { PARTS } from './catalog';
import { gpuInstallPrice, gpuModel, gpuNativePrice, gpuStepPrice } from './catalog/gpuModels';
import { partFromNothing } from './pricing';

/**
 * The same model, or a better one of the same type, stays. A card of the same type at a higher tier and generation is an upgrade at the difference
 * in value (hot within its generation, cold across); any other model or accelerator kind is a cold install.
 */
export function mergeAccels(have: readonly AccelBuild[], want: readonly AccelBuild[]): {
  accels: readonly AccelBuild[]; price: bigint; cold: boolean;
} {
  const working = have.slice(0, want.length);
  let price = 0n, cold = have.length !== want.length;
  for (let slot = 0; slot < want.length; slot += 1) {
    const target = want[slot]!, old = have[slot];
    if (target.kind === 'gpu') {
      if (old?.kind === 'gpu' && old.model === target.model) { working[slot] = old; continue; }
      const others = working.filter((card, index) => card.kind === 'gpu' && index !== slot).length;
      const from = old?.kind === 'gpu' ? gpuModel(old.model) : null, to = gpuModel(target.model)!;
      // A loaded configuration never downgrades a card it already matches or beats on its own line.
      if (from && from.series === to.series && from.generation >= to.generation && from.tier >= to.tier) { working[slot] = old!; continue; }
      if (from && from.series === to.series && from.generation <= to.generation && from.tier <= to.tier
        && gpuNativePrice(target.model) > gpuNativePrice(from.model)) {
        price += gpuStepPrice(from.model, target.model, others);
        if (from.generation !== to.generation) cold = true;
      } else {
        price += gpuInstallPrice(target.model, others);
        cold = true;
      }
    } else if (old?.kind === 'npu' && old.gen === target.gen) {
      if (old.level >= target.level) { working[slot] = old; continue; }
      price += partFromNothing(PARTS.npu, target) - partFromNothing(PARTS.npu, old);
    } else {
      const others = working.filter((card, index) => card.kind === 'npu' && index !== slot).length;
      price += partFromNothing(PARTS.npu, target, others);
      cold = true;
    }
    working[slot] = target;
  }
  return { accels: working, price, cold };
}
