// D23 task types: names, bands, colour ramps and requirement pips. The type icons are in setF.ts.
import type { BandId } from '../../../game';

/** The player-facing task types (D23), in display order. */
export type TaskType = 'compute' | 'parallel' | 'memory' | 'accel' | 'storage' | 'cluster' | 'zones' | 'region';
export const TASK_TYPES: readonly TaskType[] = ['compute', 'parallel', 'memory', 'accel', 'storage', 'cluster', 'zones', 'region'];
/** a: the type colour, d: shade, l: light, k: the dark plate icons sit on. */
export interface TypeStyle { readonly name: string; readonly bands: readonly BandId[]; readonly a: string; readonly d: string; readonly l: string; readonly k: string }
export const TYPE: Readonly<Record<TaskType, TypeStyle>> = {
  compute: { name: 'Compute', bands: ['bits', 'ints'], a: '#7fe3ff', d: '#3a8fb8', l: '#d4f8ff', k: '#253649' },
  parallel: { name: 'Parallel', bands: ['threads'], a: '#b18cff', d: '#6447b8', l: '#e3d6ff', k: '#2f2549' },
  memory: { name: 'Memory', bands: ['ram'], a: '#ff8c42', d: '#a8521f', l: '#ffd2a8', k: '#3e2524' },
  accel: { name: 'Accelerated', bands: ['gpu'], a: '#c2e05a', d: '#6c8a26', l: '#effabf', k: '#323628' },
  storage: { name: 'Storage', bands: ['storage'], a: '#d6ab78', d: '#86643f', l: '#f5e0c4', k: '#362b2e' },
  cluster: { name: 'Distributed', bands: ['rackDist', 'roomDist'], a: '#aab3d4', d: '#5c6388', l: '#eceef8', k: '#2d2d41' },
  zones: { name: 'Multi-zone', bands: ['multiAz'], a: '#4f9dff', d: '#2856a6', l: '#bcdcff', k: '#1b2849' },
  region: { name: 'Regional', bands: ['region'], a: '#ff8fb3', d: '#a84870', l: '#ffd6e4', k: '#3e253a' },
};
/** Every catalog band belongs to exactly one type. */
export const BAND_TYPE: Readonly<Record<BandId, TaskType>> = {
  bits: 'compute',
  ints: 'compute',
  threads: 'parallel',
  ram: 'memory',
  gpu: 'accel',
  storage: 'storage',
  rackDist: 'cluster',
  roomDist: 'cluster',
  multiAz: 'zones',
  region: 'region',
};
export const BAND_ORDER: readonly BandId[] = ['bits', 'ints', 'threads', 'ram', 'gpu', 'storage', 'rackDist', 'roomDist', 'multiAz', 'region'];
export const BAND_NAME: Readonly<Record<BandId, string>> = {
  bits: 'Bits',
  ints: 'Integers',
  threads: 'Threads',
  ram: 'Memory',
  gpu: 'GPU',
  storage: 'Storage',
  rackDist: 'Rack-scale',
  roomDist: 'Room-scale',
  multiAz: 'Multi-AZ',
  region: 'Regional',
};
/** Requirement pips: 5×5 and 3×3. */
export const PIPS: Readonly<Record<string, { readonly name: string; readonly c: string; readonly px: readonly string[]; readonly mini: readonly string[] }>> = {
  cpu: { name: 'CPU', c: '#e6dcff', px: ['.w.w.', 'wwwww', '.w.w.', 'wwwww', '.w.w.'], mini: ['www', 'w.w', 'www'] },
  ram: { name: 'RAM', c: '#ffa94d', px: ['wwwww', 'w.w.w', 'w.w.w', 'wwwww', 'w.w.w'], mini: ['w.w', 'w.w', 'www'] },
  gpu: { name: 'GPU', c: '#ff7ad9', px: ['wwwww', 'w.w.w', 'wwwww', 'w.w.w', 'wwwww'], mini: ['www', 'www', 'w.w'] },
  stor: { name: 'Storage', c: '#e0b07a', px: ['.www.', 'w...w', '.www.', 'w...w', '.www.'], mini: ['www', '...', 'www'] },
  net: { name: 'Network', c: '#7be38f', px: ['..w..', '.www.', '..w..', 'wwwww', 'w.w.w'], mini: ['.w.', 'www', '.w.'] },
  members: { name: 'Systems', c: '#a6f6ff', px: ['ww.ww', 'ww.ww', '.....', 'ww.ww', 'ww.ww'], mini: ['w.w', '...', 'w.w'] },
  zone: { name: 'Zones', c: '#5ab0ff', px: ['ww...', 'ww...', '..w..', '...ww', '...ww'], mini: ['ww.', '...', '.ww'] },
  region: { name: 'Region', c: '#bfe3ff', px: ['.www.', 'w.w.w', 'wwwww', 'w.w.w', '.www.'], mini: ['.w.', 'w.w', '.w.'] },
};
