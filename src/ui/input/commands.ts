// Input to commands. A tap on the world becomes a ViewCommand; sim actions come only from the
// deck, the callout and plates, through `shell.dispatch`, and the sim re-quotes them.
import type { HitTarget } from '../../render/core';
import type { ShellContextValue } from '../storeHooks';
import { hasPlate } from '../plates/PlateLayer';

type Shell = Pick<ShellContextValue, 'view' | 'store'>;

/**
 * One tap opens a part's whole detail with its keys (user, 26 Oct): its plate where it has one, else its
 * callout. The same part again closes it; another part swaps straight to that one; empty space closes.
 */
export function activateTarget(shell: Shell, hit: HitTarget | null): void {
  if (!hit || shell.view.getState().selectedId === hit.id) { shell.view.dispatch({ type: 'cancel' }); return; }
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
