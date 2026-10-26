import { researchId as r } from '../../types/ids';
import type { CatalogRow } from './types';

/** Board parts (spec Appendix A.1, post-D5). */
const UP = [12, 1.2e5, 1.5e9, 7.7e12];

/** RAM capacity factor per level (hardware-progression.md §4, the source sheet's capacity column). */
export const RAM_CAPACITY_FACTOR: readonly number[] = [1, 2, 4, 6, 8, 12, 16, 20, 24, 28, 32, 40, 48, 56, 64, 80, 96, 112,
  128, 160, 192, 224, 256, 320, 384, 448, 512, 640, 768, 896, 1024, 1280, 1536, 1792, 2048, 3072];

/**
 * base = bits, base2 = bandwidth bit/s (the rated rate). The CSV progression (hardware-progression.md §4):
 * 36 levels, capacity by RAM_CAPACITY_FACTOR, bandwidth ×1.5 and price ×1.7 per level, energy ratio by era.
 */
export const RAM: CatalogRow = {
  id: 'ram', scope: 'system', names: ['SDRAM', 'DDR', 'DDR2', 'DDR3', 'DDR4', 'DDR5'],
  // D37: SDRAM comes with the System board; later generations need their research.
  gates: [r('systemBoard'), r('ddr'), r('ddr2'), r('ddr3'), r('ddr4'), r('ddr5')], curve: 'step',
  // SDRAM and DDR hold the System era's data-heavy working sets (tens of kbit) at mid levels, before E decays into loss.
  base: [256, 512, 2 ** 20, 2 ** 30, 2 ** 32, 2 ** 38], base2: [16, 32, 3.2e4, 6.4e7, 2.56e8, 1.28e11],
  capacityTable: RAM_CAPACITY_FACTOR, watts: { kind: 'ratio', era: [0, 0, 1, 2, 2, 3] },
  price: [3e5, 4.5e5, 5e6, 3e10, 5e10, 5e13], upgrade: [12, 12, 1.2e5, 1.5e9, 1.5e9, 7.7e12],
};
/** GPU metadata for generation adapters. Model evaluation owns specs and prices. */
export const GPU: CatalogRow = {
  id: 'gpu', scope: 'system', names: ['1 kHz GPU', '10 kHz GPU', '100 kHz GPU', '1 MHz GPU', '10 MHz GPU', '100 MHz GPU', '1 GHz GPU', '10 GHz GPU', '100 GHz GPU'],
  gates: Array.from({ length: 9 }, (_, g) => r(`gpuGen${g + 1}`)), curve: 'fixed', levelMax: 6,
  base: Array.from({ length: 9 }, (_, g) => 4000 * 20 ** g),
  base2: Array.from({ length: 9 }, (_, g) => 8192 * 16 ** g),
  watts: { kind: 'rate', wPerUnit: 0.5 },
  price: Array.from({ length: 9 }, (_, g) => 4e6 * 10 ** g), upgrade: Array(9).fill(0),
};
/** Frozen legacy NPU catalog. Its four generations do not follow GPU models. */
export const NPU: CatalogRow = {
  id: 'npu', scope: 'system', names: ['Vector NPU', 'SIMT NPU', 'Tensor NPU', 'Matrix NPU'],
  gates: [r('npu'), r('gpuGen2'), r('tensorCores'), r('matrixGpu')], curve: 'flow',
  base: [32, 6.4e4, 1.28e8, 2.56e11], base2: [64, 2 ** 19, 2 ** 30, 2 ** 39],
  tensorFactor: [1, 1, 4, 8], watts: { kind: 'rate', wPerUnit: 0.125 },
  price: [3e6, 7.5e6, 45e9, 75e12], upgrade: UP,
};
/** base = bits, base2 = IO bit/s (the rated rate). */
export const STORAGE: CatalogRow = {
  id: 'storage', scope: 'system', names: ['HDD', 'SSD', 'NVMe', 'SCM'], gates: [r('storageCtl'), r('ssd'), r('nvme'), r('scm')],
  // D26.2: IO re-based to 1/16 (HDD, SSD), 1/4 (NVMe) and 1/2 (SCM) of the era's RAM bandwidth, so spill to disk is slow.
  // The HDD is the System-era drive: big and slow, priced like the SDRAM module. Its IO at L1 is about 1/16 of
  // SDRAM at the levels a System-era box holds (L15–L25), so spill slows work 4–16× instead of stalling it.
  curve: 'flow', base: [2048, 2 ** 24, 2 ** 34, 2 ** 44], base2: [512, 2000, 1.6e7, 6.4e10], watts: { kind: 'rate', wPerUnit: 1 },
  price: [3e5, 5e6, 3e10, 5e13], upgrade: UP,
};
/** Board PSU: a supply (capacity W, loss only). */
export const PSU: CatalogRow = {
  id: 'psu', scope: 'system', names: ['Bench', '80 Plus', 'Bronze', 'Gold', 'Platinum', 'Titanium'],
  gates: [r('systemBoard'), r('psu80'), r('psuBronze'), r('psuGold'), r('psuPlatinum'), r('psuTitanium')], curve: 'flow',
  // D8: each era's legal levels hold its largest native GPU through u1.
  base: [32768, 65536, 1.25e5, 1.25e6, 4e8, 5e13], watts: { kind: 'supply', loss: [0.3, 0.2, 0.15, 0.1, 0.07, 0.04], lossPerLevel: 0.01 },
  price: [1000, 1e5, 1e6, 3e6, 1e10, 1e13], upgrade: [12, 12, 1.2e5, 1.2e5, 1.5e9, 7.7e12],
};
