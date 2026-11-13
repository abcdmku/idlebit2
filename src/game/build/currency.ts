import type { GameAction } from '../types/actions';
import type { BuildState } from '../types/build';
import type { GpuModelId } from '../types/gpu';
import type { PartRef, PartSlotKind } from '../types/ids';
import type { HardwareAsset } from './assets';
import { gpuDataValue, gpuModel } from './catalog/gpuModels';

/**
 * D83: storage parts are bought with Data. Cache, RAM capacity, drive capacity and NPUs cost Data at their
 * Credit value ÷ 50; clocks, RAM and drive speed tracks and every other part cost Credits. A GPU splits its value
 * by type (D89, gpuDataValue).
 * Prices stay authored in Credit value; the split happens once per purchase.
 */
export const CREDITS_PER_DATA_PART = 50n;

export interface Cost { readonly credits: bigint; readonly data: bigint }

const DATA_SLOTS: ReadonlySet<PartSlotKind> = new Set(['cache', 'ram', 'drive', 'gpu']);

/** The part of an asset's value paid as Data. A RAM or drive `:speed` asset is a frequency track and stays on Credits. */
export function assetDataValue(asset: HardwareAsset, value: bigint): bigint {
  if (asset.ref === null || !DATA_SLOTS.has(asset.ref.slot.kind) || asset.key.endsWith(':speed')) return 0n;
  // A GPU asset's version is its model; an NPU's is not.
  const card = asset.ref.slot.kind === 'gpu' ? gpuModel(asset.version) : null;
  return card ? gpuDataValue(card.model, value) : value;
}

/** The card in a GPU slot, or null for an NPU, an empty slot or another part. */
function slotGpu(build: BuildState, ref: PartRef): GpuModelId | null {
  if (ref.unit.kind !== 'system' || ref.slot.kind !== 'gpu') return null;
  const card = build.systems[ref.unit.id]?.spec.accels[ref.slot.index];
  return card?.kind === 'gpu' ? card.model : null;
}

/** Credit value paid as Data, rounded up so no nonzero value is free. */
export const dataFor = (value: bigint): bigint => (value + CREDITS_PER_DATA_PART - 1n) / CREDITS_PER_DATA_PART;

/** Splits a value into Credits and Data by the share that buys Data parts. */
export const splitCost = (price: bigint, dataValue: bigint): Cost => ({ credits: price - dataValue, data: dataFor(dataValue) });

/**
 * The cost of an action that buys one kind of part, which is one currency; null for a purchase that may buy both
 * kinds (Replace CPU, an added CPU, ECC conversion, a new unit, a config, upgrading every GPU of a generation),
 * which splits by changed asset (investments.ts). Quotes and commits both call it, so a quote charges what the
 * action charges. A GPU buys one card, split by its type.
 */
export function singleCost(action: GameAction, price: bigint, build: BuildState): Cost | null {
  const data = (on: boolean): Cost => splitCost(price, on ? price : 0n);
  const card = (model: GpuModelId | null): Cost | null => model ? splitCost(price, gpuDataValue(model, price)) : null;
  switch (action.type) {
    case 'installGpu': return card(action.model);
    case 'upgradePart': case 'upgradePartTo': case 'downgradePart': case 'replacePart': case 'removePart':
      return card(slotGpu(build, action.part))
        ?? data(DATA_SLOTS.has(action.part.slot.kind) && !('axis' in action && action.axis === 'speed'));
    case 'addPart': return action.kind === 'socket' ? null : data(action.kind === 'ram' || action.kind === 'drive' || action.kind === 'gpu' || action.kind === 'npu');
    case 'upgradeAll': return action.kind === 'gpu' ? null : data(action.axis !== 'speed');
    case 'convertRamToEcc': case 'replaceCpu': case 'addUnit': case 'applyConfig': return null;
    default: return data(false);
  }
}
