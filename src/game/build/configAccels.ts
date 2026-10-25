import type { AccelBuild } from '../types/gpu';
import { PARTS } from './catalog';
import { gpuInstallPrice, gpuNativePrice, gpuPriceToLevel } from './catalog/gpuModels';
import { partFromNothing } from './pricing';

/** Same model keeps paid pushes; another model or accelerator kind is a cold install. */
export function mergeAccels(have: readonly AccelBuild[], want: readonly AccelBuild[]): {
  accels: readonly AccelBuild[]; price: bigint; cold: boolean;
} {
  const working = have.slice(0, want.length);
  let price = 0n, cold = have.length !== want.length;
  for (let slot = 0; slot < want.length; slot += 1) {
    const target = want[slot]!, old = have[slot];
    if (target.kind === 'gpu') {
      if (old?.kind === 'gpu' && old.model === target.model) {
        if (old.upgrades >= target.upgrades) { working[slot] = old; continue; }
        price += gpuPriceToLevel(target.model, target.upgrades) - gpuPriceToLevel(old.model, old.upgrades);
      } else {
        const others = working.filter((card, index) => card.kind === 'gpu' && index !== slot).length;
        price += gpuInstallPrice(target.model, others) + gpuPriceToLevel(target.model, target.upgrades) - gpuNativePrice(target.model);
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
