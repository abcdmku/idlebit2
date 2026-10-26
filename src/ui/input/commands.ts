// Input to commands. A tap on the world becomes a ViewCommand; sim actions come only from the
// deck, the callout and plates, through `shell.dispatch`, and the sim re-quotes them.
import type { HitTarget } from '../../render/core';
import type { ShellContextValue } from '../storeHooks';
import { hasPlate } from '../plates/PlateLayer';

type Shell = Pick<ShellContextValue, 'view' | 'store'>;

/**
 * One tap (user, 26 Oct): a thing with its own view (the CPU in a system, a sled in a rack, a rack in a room,
 * a room or site on the map) zooms into it; anything else opens its whole detail with its keys, its plate
 * where it has one, else its callout. The same part again closes it; another swaps; empty space closes.
 */
export function activateTarget(shell: Shell, hit: HitTarget | null): void {
  if (!hit || shell.view.getState().selectedId === hit.id) { shell.view.dispatch({ type: 'cancel' }); return; }
  if (hit.drill) { shell.view.dispatch({ type: 'drill', ref: hit.drill }); return; }
  shell.view.dispatch({ type: 'select', target: hit, plate: hasPlate(hit, shell.store.getSnapshot().focus) });
}

export function zoomGesture(shell: Shell, direction: 'in' | 'out', hit: HitTarget | null): void {
  shell.view.dispatch({ type: 'zoomStep', direction, drill: direction === 'in' ? hit?.drill ?? null : null });
}

/** Return to market, from the round plate or the strip key. Only valid when the round is not running. */
export function returnToMarket(shell: Pick<ShellContextValue, 'dispatch' | 'view'>): void {
  shell.view.dispatch({ type: 'cancel' });
  shell.dispatch({ type: 'returnToMarket' });
}
