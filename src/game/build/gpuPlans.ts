import type { AccelBuild } from '../types/build';
import type { GpuModelId } from '../types/gpu';
import type { PartRef, SystemId } from '../types/ids';
import type { GameState } from '../types/state';
import { gpuAtGeneration, gpuInstallPrice, gpuModel, gpuNextTier, gpuStepPrice, gpuTypeChangePrice } from './catalog/gpuModels';
import { genLock } from './locks';
import { withSpec } from './partAccess';
import { boardLimit } from './partPlans';
import { coldScopes, fail, locked, planned, type Plan } from './plan';

/**
 * What may go into an occupied slot: any GPU in place of an NPU; in place of a GPU, the same type and tier in a
 * later generation (strictly better on every spec, D39.8), or another type at the same generation and tier (a type
 * change). Tiers step in place (planGpuUpgrade).
 */
export function gpuSlotChange(installed: AccelBuild, model: GpuModelId): 'install' | 'generation' | 'type' | null {
  if (installed.kind !== 'gpu') return 'install';
  const have = gpuModel(installed.model), next = gpuModel(model);
  if (!have || !next) return null;
  if (gpuAtGeneration(installed.model, next.generation) === model) return 'generation';
  return next.generation === have.generation && next.tier === have.tier && next.series !== have.series ? 'type' : null;
}

const otherGpus = (accels: readonly AccelBuild[], index: number | null) =>
  accels.filter((card, slot) => card.kind === 'gpu' && slot !== index).length;

/**
 * An empty slot installs any researched model at its value. An occupied GPU slot moves to a later generation at
 * the same type and tier, a cold change that costs the difference in value (the card is traded in, so tier
 * steps already bought carry over).
 */
export function planInstallGpu(state: GameState, system: SystemId, model: GpuModelId, index: number | null): Plan {
  const spec = state.build.systems[system]?.spec;
  const native = gpuModel(model);
  if (!spec || !native) return fail('invalid', 'Choose a GPU model');
  if (spec.kind !== 'server') return fail('invalid', 'GPUs need a server');
  if (index !== null && (!Number.isInteger(index) || index < 0 || !spec.accels[index])) return fail('invalid', 'No such accelerator');
  const old = index === null ? null : spec.accels[index]!;
  const change = old ? gpuSlotChange(old, model) : 'install';
  if (!change) return fail('invalid', 'Only a later generation or another type', `GPU ${model}`);
  const others = otherGpus(spec.accels, index);
  const price = old?.kind !== 'gpu' ? gpuInstallPrice(model, others)
    : change === 'type' ? gpuTypeChangePrice(old.model, model, others) : gpuStepPrice(old.model, model, others);
  const label = `GPU ${model}`;
  const lock = genLock(state.research.unlocks, 'gpu', native.generation - 1);
  if (lock) return locked(lock, label, price);
  if (index === null && spec.accels.length >= boardLimit(spec, state.research.unlocks, 'gpu')) {
    return locked({ code: 'cap', node: null, text: 'No free accelerator slot' }, label, price);
  }
  const card = { kind: 'gpu' as const, model };
  const accels = index === null ? [...spec.accels, card] : spec.accels.map((prev, slot) => slot === index ? card : prev);
  return planned({ build: withSpec(state.build, system, { ...spec, accels }), price,
    // Spec §4.5: a card into an empty slot is hot and keeps the system's work; replacing a card is cold.
    ...(index === null ? {} : { cold: coldScopes(state, { kind: 'system', id: system }), kill: [{ kind: 'system' as const, id: system }],
      inventoryChangedSystems: [system] }) }, label);
}

/** Tier up in place: hot, running work kept, priced at the difference in value. Tier 90 is the top. */
export function planGpuUpgrade(state: GameState, ref: PartRef): Plan {
  if (ref.unit.kind !== 'system' || ref.slot.kind !== 'gpu') return fail('invalid', 'No such GPU');
  const spec = state.build.systems[ref.unit.id]?.spec;
  const card = spec?.accels[ref.slot.index];
  if (!spec || !card || card.kind !== 'gpu' || !gpuModel(card.model)) return fail('invalid', 'No such GPU');
  const next = gpuNextTier(card.model);
  if (!next) return locked({ code: 'ceiling', node: null, text: 'Max' }, `GPU ${card.model}`);
  const label = `GPU ${next}`;
  const price = gpuStepPrice(card.model, next, otherGpus(spec.accels, ref.slot.index));
  const index = ref.slot.index;
  const accels = spec.accels.map((old, slot) => slot === index ? { kind: 'gpu' as const, model: next } : old);
  return planned({ build: withSpec(state.build, ref.unit.id, { ...spec, accels }), price }, label);
}
