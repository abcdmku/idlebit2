import type { AccelBuild } from '../types/build';
import type { GpuModelId } from '../types/gpu';
import type { PartRef, SystemId } from '../types/ids';
import type { GameState } from '../types/state';
import { evaluateGpu, gpuInstallPrice, gpuModel, gpuUpgradePrice } from './catalog/gpuModels';
import { genLock } from './locks';
import { withSpec } from './partAccess';
import { boardLimit } from './partPlans';
import { coldScopes, fail, locked, planned, type Plan } from './plan';

/**
 * A replacement card must be a strictly better model than the installed one (user, 25 Oct: no "replace with" a
 * lower tier). Model against model, native, since hot pushes are not a tier: more ops/s and no less VRAM. A
 * cross-series sidegrade (more VRAM, fewer ops, or the reverse) is not offered. Any card may replace an NPU.
 */
export function gpuBetter(installed: AccelBuild, model: GpuModelId): boolean {
  if (installed.kind !== 'gpu') return true;
  const have = evaluateGpu(installed.model, 0), next = evaluateGpu(model, 0);
  return next.opsPerS > have.opsPerS && next.vramBits >= have.vramBits;
}

/** A replacement always buys a native card and scraps the previous model and its pushes. */
export function planInstallGpu(state: GameState, system: SystemId, model: GpuModelId, index: number | null): Plan {
  const spec = state.build.systems[system]?.spec;
  const native = gpuModel(model);
  if (!spec || !native) return fail('invalid', 'Choose a GPU model');
  if (spec.kind !== 'server') return fail('invalid', 'GPUs need a server');
  if (index !== null && (!Number.isInteger(index) || index < 0 || !spec.accels[index])) return fail('invalid', 'No such accelerator');
  if (index !== null && !gpuBetter(spec.accels[index]!, model)) return fail('invalid', 'Only a better card', `GPU ${model}`);
  const otherGpus = spec.accels.filter((card, slot) => card.kind === 'gpu' && slot !== index).length;
  const price = gpuInstallPrice(model, otherGpus);
  const label = `GPU ${model}`;
  const lock = genLock(state.research.unlocks, 'gpu', native.generation - 1);
  if (lock) return locked(lock, label, price);
  if (index === null && spec.accels.length >= boardLimit(spec, state.research.unlocks, 'gpu')) {
    return locked({ code: 'cap', node: null, text: 'No free accelerator slot' }, label, price);
  }
  const card = { kind: 'gpu' as const, model, upgrades: 0 };
  const accels = index === null ? [...spec.accels, card] : spec.accels.map((old, slot) => slot === index ? card : old);
  return planned({ build: withSpec(state.build, system, { ...spec, accels }), price,
    // Spec §4.5: a card into an empty slot is hot and keeps the system's work; replacing a card is cold.
    ...(index === null ? {} : { cold: coldScopes(state, { kind: 'system', id: system }), kill: [{ kind: 'system' as const, id: system }],
      inventoryChangedSystems: [system] }) }, label);
}

export function planGpuUpgrade(state: GameState, ref: PartRef): Plan {
  if (ref.unit.kind !== 'system' || ref.slot.kind !== 'gpu') return fail('invalid', 'No such GPU');
  const spec = state.build.systems[ref.unit.id]?.spec;
  const card = spec?.accels[ref.slot.index];
  if (!spec || !card || card.kind !== 'gpu' || !gpuModel(card.model)) return fail('invalid', 'No such GPU');
  const label = `GPU ${card.model} · upgrade ${card.upgrades + 1}`;
  if (card.upgrades >= 5) return locked({ code: 'ceiling', node: null, text: 'Max' }, label);
  const price = gpuUpgradePrice(card.model, card.upgrades);
  const index = ref.slot.index;
  const accels = spec.accels.map((old, slot) => slot === index ? { ...card, upgrades: card.upgrades + 1 } : old);
  return planned({ build: withSpec(state.build, ref.unit.id, { ...spec, accels }), price }, label);
}
