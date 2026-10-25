// Input to commands. A tap on the world becomes a ViewCommand; sim actions come only from the
// deck, the callout and plates, through `shell.dispatch`, and the sim re-quotes them.
import type { HitTarget } from '../../render/core';
import type { ShellContextValue } from '../storeHooks';

type Shell = Pick<ShellContextValue, 'view'>;

/**
 * Empty space cancels. A tap selects (its callout opens); tapping a selected unit again goes inside
 * it, as in the approved mockup.
 */
export function activateTarget(shell: Shell, hit: HitTarget | null): void {
  if (!hit) { shell.view.dispatch({ type: 'cancel' }); return; }
  if (hit.drill && shell.view.getState().selectedId === hit.id) {
    shell.view.dispatch({ type: 'drill', ref: hit.drill }); return;
  }
  shell.view.dispatch({ type: 'select', target: hit });
}

export function zoomGesture(shell: Shell, direction: 'in' | 'out', hit: HitTarget | null): void {
  shell.view.dispatch({ type: 'zoomStep', direction, drill: direction === 'in' ? hit?.drill ?? null : null });
}

/** Return to market, from the round plate or the strip key. Only valid when the round is not running. */
export function returnToMarket(shell: Pick<ShellContextValue, 'dispatch' | 'view'>): void {
  shell.view.dispatch({ type: 'cancel' });
  shell.dispatch({ type: 'returnToMarket' });
}
