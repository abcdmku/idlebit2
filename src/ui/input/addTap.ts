// Tapping a "+" opens that slot's choices and never spends (user, 26 Oct, superseding one-tap buy): the price,
// what each option does, and one key that buys the picked one.
import type { HitTarget } from '../../render/core';
import { hasPlate } from '../plates/PlateLayer';
import type { ShellContextValue } from '../storeHooks';

type Shell = Pick<ShellContextValue, 'view' | 'store'>;

export const isAdd = (t: Pick<HitTarget, 'kind'>) => t.kind === 'add';

/**
 * The target the add's detail opens on: the Power control plate for its bay,
 * else the empty slot's plate (site, GPU picker, server or rack configuration). The id stays the "+"'s own, so
 * the plate anchors to it and a second tap closes it.
 */
export function addDetail(t: HitTarget): HitTarget {
  if (t.id === 'add:core' && t.unit?.kind === 'system')
    return { ...t, kind: 'part', part: { unit: t.unit, slot: { kind: 'core', socket: 0, index: t.slot ?? 0 } }, rect: { ...t.rect } };
  if (t.part) return { ...t, kind: 'part', rect: { ...t.rect } };
  return { ...t, kind: 'slot', rect: { ...t.rect } };
}

/** One tap on a "+": its choices, nothing bought. */
export function tapAdd(shell: Shell, t: HitTarget): void {
  const d = addDetail(t);
  shell.view.dispatch({ type: 'select', target: d, plate: hasPlate(d, shell.store.getSnapshot().focus) });
}
