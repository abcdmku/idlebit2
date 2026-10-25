import type { ActionOutcome, RejectionCode } from '../types/actions';
import type { PartRef, UnitRef } from '../types/ids';
import type { LockReason } from '../types/quotes';
import type { GameState } from '../types/state';
import { reject } from '../core/actions';
import { commitBuild, type BuildChange } from './commit';
import { hasRule } from './research/unlocks';

/**
 * A priced, validated change. Handlers commit it; quotes show it. Both call the same planner, so
 * a quote's price is exactly what the action charges.
 */
export type Plan =
  | { readonly ok: true; readonly change: BuildChange; readonly label: string }
  | { readonly ok: false; readonly code: RejectionCode; readonly reason: string; readonly lock: LockReason | null; readonly price: bigint | null; readonly label: string };

export const fail = (code: RejectionCode, reason: string, label = '', price: bigint | null = null): Plan =>
  ({ ok: false, code, reason, lock: code === 'locked' || code === 'cap' ? { code: code === 'cap' ? 'cap' : 'research', node: null, text: reason } : null, price, label });
export const locked = (lock: LockReason, label = '', price: bigint | null = null): Plan =>
  ({ ok: false, code: lock.code === 'research' ? 'locked' : 'cap', reason: lock.text, lock, price, label });
export const planned = (change: BuildChange, label: string): Plan => ({ ok: true, change, label });

/** Runs a plan as an action. */
export const commitPlan = (state: GameState, plan: Plan): ActionOutcome =>
  plan.ok ? commitBuild(state, plan.change) : reject(state, plan.code, plan.reason);

export const planPrice = (plan: Plan): bigint | null => (plan.ok ? plan.change.price : plan.price);
export const isCold = (plan: Plan): boolean => plan.ok && (plan.change.cold?.length ?? 0) > 0;

/**
 * The scopes a cold change takes down, after the hot exceptions (spec §4.5): `hotPlug` makes drive
 * changes hot; `hotSwap` makes any change scoped to one system in an opened rack hot.
 */
export function coldScopes(state: GameState, scope: UnitRef | null, ref?: PartRef): UnitRef[] {
  if (!scope) return [];
  const u = state.research.unlocks;
  if (ref?.slot.kind === 'drive' && hasRule(u, 'hotPlug')) return [];
  if (scope.kind === 'system' && hasRule(u, 'hotSwap')) {
    const rack = state.build.racks[state.build.systems[scope.id]?.rack ?? -1];
    if (rack?.opened) return [];
  }
  return [scope];
}
