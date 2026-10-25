import { researchId as r } from '../../types/ids';
import type { CatalogRow } from './types';

/** Chip parts (spec Appendix A.1, post-D5). Generation g opens with the fab nodes. */
const FAB = [r('fabKhz'), r('fabMhz'), r('fabGhz')];
const TIERS = ['Hz', 'kHz', 'MHz', 'GHz'];
const IDLE = [0.1, 100, 1e5, 1e8];
const idle = (f = 1) => ({ kind: 'idle', idle: IDLE.map((w) => w * f) }) as const;

export const CPU: CatalogRow = {
  id: 'cpu', scope: 'chip', names: TIERS.map((t) => `${t} package`), gates: FAB, curve: 'fixed',
  base: [1, 1, 1, 1], watts: idle(), price: [500, 5e4, 2.1e8, 9.3e10], upgrade: [0, 0, 0, 0],
};
/** Rate part: rate = lanes × socket clock; native = base lanes × CLOCK.base[g]. */
export const CORE: CatalogRow = {
  id: 'core', scope: 'chip', names: TIERS.map((t) => `${t} core`), gates: FAB, curve: 'core',
  base: [1, 2, 4, 8], watts: { kind: 'rate', wPerUnit: 1 },
  price: [6000, 1.25e5, 4.3e8, 1.9e11], upgrade: [10, 1.2e5, 1.5e9, 7.7e12],
};
export const CLOCK: CatalogRow = {
  id: 'clock', scope: 'chip', names: TIERS.map((t) => `${t} oscillator`), gates: FAB, curve: 'flow',
  base: [1, 1e3, 1e6, 1e9], watts: idle(), price: [20, 2e5, 8.6e8, 3.7e11], upgrade: [3, 1.5e4, 9e7, 2.4e11], upgradeDrive: 'lanes',
};
export const L1: CatalogRow = {
  id: 'l1', scope: 'chip', names: TIERS.map((t) => `${t} L1`), gates: FAB, curve: 'flow',
  base: [1, 1024, 2 ** 20, 2 ** 30], watts: idle(), price: [20, 1.25e5, 4.3e8, 1.9e11], upgrade: [3, 1.2e5, 1.5e9, 7.7e12],
};
export const L2: CatalogRow = {
  id: 'l2', scope: 'chip', names: TIERS.map((t) => `${t} L2`), gates: [r('l2Cache'), ...FAB], curve: 'flow',
  base: [8, 8192, 2 ** 23, 2 ** 33], watts: idle(2), price: [4e4, 5e5, 8.6e8, 3.7e11], upgrade: [12, 1.2e5, 1.5e9, 7.7e12],
};
/** L3 levels extend by the `l3LevelBonus` ceiling (stacked3d). */
export const L3: CatalogRow = {
  id: 'l3', scope: 'chip', names: TIERS.map((t) => `${t} L3`), gates: [r('l3Cache'), ...FAB], curve: 'flow',
  base: [64, 65536, 2 ** 26, 2 ** 36], watts: idle(6), price: [2e5, 7e5, 1.7e9, 7.4e11], upgrade: [12, 1.2e5, 1.5e9, 7.7e12],
};
/** base = K (concurrency), base2 = Q (queue). Linear, L 1–8 for every g. */
export const SCHEDULER: CatalogRow = {
  id: 'scheduler', scope: 'chip', names: ['Run queue', 'Multilevel', 'Work queue', 'Cluster runtime'], gates: [r('fifoSched'), ...FAB],
  curve: 'linear', levelMax: 8, base: [1, 2, 3, 4], base2: [2, 4, 6, 8], watts: idle(),
  price: [1000, 3e5, 4.3e8, 1.9e11], upgrade: [100, 1.2e5, 1.5e9, 7.7e12],
};
