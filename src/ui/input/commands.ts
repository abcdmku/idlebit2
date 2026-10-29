// Input to commands. A tap on the world becomes a ViewCommand; sim actions come only from the
// deck, the callout and plates, through `shell.dispatch`, and the sim re-quotes them.
import type { HitTarget } from '../../render/core';
import type { ShellContextValue } from '../storeHooks';
import { hasPlate } from '../plates/PlateLayer';
import { isAdd, tapAdd } from './addTap';
import { actionAtSource, runSourceAction } from './sourceAction';

type Shell = Pick<ShellContextValue, 'view' | 'store' | 'dispatch' | 'quote'>;

/**
 * One tap (user, 26 Oct): a unit with its own view (a sled in a rack, a rack in a room, a room or site on the
 * map) zooms into it. A simple component buys on its source; actual choices and operating settings open a menu.
 * A board CPU opens its component plate.
 * The same other part again closes it; another swaps; empty space clears the selection.
 */
export function activateTarget(shell: Shell, hit: HitTarget | null): void {
  if (hit && actionAtSource(shell, hit)) { runSourceAction(shell, hit); return; }
  if (!hit || shell.view.getState().selectedId === hit.id) { shell.view.dispatch({ type: 'cancel' }); return; }
  if (hit.drill) { shell.view.dispatch({ type: 'drill', ref: hit.drill }); return; }
  // Slots with a build choice open that picker. A single installation buys on its source above.
  if (isAdd(hit)) { tapAdd(shell, hit); return; }
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
