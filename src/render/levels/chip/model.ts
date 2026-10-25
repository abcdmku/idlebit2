// Stable PartRefs per system and block, so hit targets never allocate per tap.
import type { PartRef, SystemId } from '../../../game';
import { MAX_CORES } from './layout';

export type TargetId = `core${number}` | `site${number}` | 'cache' | 'queue' | 'clock' | 'pipe';
export const CORE_IDS: readonly TargetId[] = Array.from({ length: MAX_CORES }, (_, i): TargetId => `core${i}`);
export const SITE_IDS: readonly TargetId[] = Array.from({ length: MAX_CORES }, (_, i): TargetId => `site${i}`);

const refs = new Map<string, PartRef>();
export function partRef(system: SystemId, id: 'clock' | 'cache' | 'queue' | `core${number}`): PartRef {
  const key = `${system}:${id}`;
  let ref = refs.get(key);
  if (!ref) {
    const unit = { kind: 'system', id: system } as const;
    const slot: PartRef['slot'] = id === 'clock' ? { kind: 'clock', socket: 0 } : id === 'cache' ? { kind: 'l1', socket: 0 }
      : id === 'queue' ? { kind: 'scheduler' } : { kind: 'core', socket: 0, index: Number(id.slice(4)) };
    ref = { unit, slot }; refs.set(key, ref);
  }
  return ref;
}
