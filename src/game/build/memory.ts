import type { MemoryBuild } from '../types/build';
import { installPrice, upgradePrice, type CatalogRow } from './catalog';

/** Each independent track pays half the former combined step, rounded up to whole Credits. */
export const memoryUpgradePrice = (row: CatalogRow, gen: number, level: number): bigint =>
  (upgradePrice(row, gen, level) + 1n) / 2n;

export function memorySteps(row: CatalogRow, gen: number, from: number, to: number): bigint {
  let price = 0n;
  for (let level = from; level < to; level += 1) price += memoryUpgradePrice(row, gen, level);
  return price;
}

/** One install, then the separately purchased capacity and speed levels. */
export const memoryPrice = (row: CatalogRow, part: MemoryBuild): bigint => installPrice(row, part.gen)
  + memorySteps(row, part.gen, 1, part.level) + memorySteps(row, part.gen, 1, part.speedLevel);
