// Stable PartRefs per system and block, so hit targets never allocate per tap.
import type { PartRef, SystemId } from '../../../game';
import { MAX_CORES } from './layout';

export type TargetId = `core${number}` | `site${number}` | 'cores' | 'cache' | 'queue' | 'clock' | 'pipe';
export const CORE_IDS: readonly TargetId[] = Array.from({ length: MAX_CORES }, (_, i): TargetId => `core${i}`);
export const SITE_IDS: readonly TargetId[] = Array.from({ length: MAX_CORES }, (_, i): TargetId => `site${i}`);

const refs = new Map<string, PartRef>();
export function partRef(system: SystemId, id: 'clock' | 'cache' | 'queue' | `core${number}`, socket = 0): PartRef {
  const key = `${system}:${socket}:${id}`;
  let ref = refs.get(key);
  if (!ref) {
    const unit = { kind: 'system', id: system } as const;
    const slot: PartRef['slot'] = id === 'clock' ? { kind: 'clock', socket } : id === 'cache' ? { kind: 'cache', socket }
      : id === 'queue' ? { kind: 'scheduler' } : { kind: 'core', socket, index: Number(id.slice(4)) };
    ref = { unit, slot }; refs.set(key, ref);
  }
  return ref;
}
