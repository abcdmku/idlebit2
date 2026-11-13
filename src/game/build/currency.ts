import type { GameAction } from '../types/actions';
import type { PartSlotKind } from '../types/ids';
import type { HardwareAsset } from './assets';

/**
 * D83: storage parts are bought with Data. Cache, RAM capacity, drive capacity and accelerator cards cost
 * Data at their Credit value ÷ 50; clocks, RAM and drive speed tracks and every other part cost Credits.
 * Prices stay authored in Credit value; the split happens once per purchase.
 */
export const CREDITS_PER_DATA_PART = 50n;

export interface Cost { readonly credits: bigint; readonly data: bigint }

const DATA_SLOTS: ReadonlySet<PartSlotKind> = new Set(['cache', 'ram', 'drive', 'gpu']);

/** A RAM or drive `:speed` asset is a frequency track and stays on Credits. */
export const isDataAsset = (asset: HardwareAsset): boolean =>
  asset.ref !== null && DATA_SLOTS.has(asset.ref.slot.kind) && !asset.key.endsWith(':speed');

/** Credit value paid as Data, rounded up so no nonzero value is free. */
export const dataFor = (value: bigint): bigint => (value + CREDITS_PER_DATA_PART - 1n) / CREDITS_PER_DATA_PART;

/** Splits a value into Credits and Data by the share that buys Data parts. */
export const splitCost = (price: bigint, dataValue: bigint): Cost => ({ credits: price - dataValue, data: dataFor(dataValue) });

/**
 * The cost of an action that buys one kind of part, which is one currency; null for a purchase that may buy both
 * kinds (Replace CPU, an added CPU, ECC conversion, a new unit, a config), which splits by changed asset
 * (investments.ts). Quotes and commits both call purchaseCost, so a quote charges what the action charges.
 */
export function singleCost(action: GameAction, price: bigint): Cost | null {
  const data = (on: boolean): Cost => splitCost(price, on ? price : 0n);
  switch (action.type) {
    case 'installGpu': return data(true);
    case 'upgradePart': case 'upgradePartTo': case 'downgradePart':
      return data(DATA_SLOTS.has(action.part.slot.kind) && action.axis !== 'speed');
    case 'replacePart': case 'removePart': return data(DATA_SLOTS.has(action.part.slot.kind));
    case 'addPart': return action.kind === 'socket' ? null : data(action.kind === 'ram' || action.kind === 'drive' || action.kind === 'gpu' || action.kind === 'npu');
    case 'upgradeAll': return data(action.axis !== 'speed');
    case 'convertRamToEcc': case 'replaceCpu': case 'addUnit': case 'applyConfig': return null;
    default: return data(false);
  }
}
