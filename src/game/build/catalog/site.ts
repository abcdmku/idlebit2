import { researchId as r } from '../../types/ids';
import type { CatalogRow } from './types';

/** Site and global parts (spec Appendix A.2, post-D5) and shells (A.4). */
export const GRID: CatalogRow = {
  id: 'grid', scope: 'site', names: ['Grid', 'Substation', 'HV intake'], gates: [r('dataCenter'), r('substation'), r('hvIntake')],
  curve: 'flow', base: [1e15, 8e15, 6.4e16], watts: { kind: 'supply', loss: [0.05, 0.03, 0.02], lossPerLevel: 0.002 },
  price: [3.3e14, 1.1e15, 9.1e15], upgrade: [1.5e15, 1.5e15, 1.5e15],
};
/** Granted free with `regions` (price 0). No routing capacity and no levels (D12.5); a fixed idle draw **(s)**. */
export const GLOBAL_SCHEDULER: CatalogRow = {
  id: 'globalScheduler', scope: 'global', names: ['Global scheduler'], gates: [r('regions')], curve: 'fixed',
  base: [0], watts: { kind: 'idle', idle: [40960] }, price: [0], upgrade: [0],
};

/** Shell prices: price × escalation^(paid units of that kind already in the parent). Free containers don't count. */
export interface ShellDef { readonly price: number; readonly escalation: number }
export const SHELLS = {
  rack: { price: 2.4e6, escalation: 1 },
  storageNode: { price: 5e6, escalation: 1 },
  zone: { price: 3.3e14, escalation: 2 },
  site: { price: 4.5e15, escalation: 4 },
} as const satisfies Record<string, ShellDef>;
