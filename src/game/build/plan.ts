import type { ActionOutcome, GameAction, RejectionCode } from '../types/actions';
import type { PartRef, UnitRef } from '../types/ids';
import type { LockReason } from '../types/quotes';
import type { GameState } from '../types/state';
import { reject } from '../core/actions';
import { commitBuild, type BuildChange } from './commit';

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
export const commitPlan = (state: GameState, plan: Plan, action?: GameAction): ActionOutcome =>
  plan.ok ? commitBuild(state, plan.change, action) : reject(state, plan.code, plan.reason);

export const planPrice = (plan: Plan): bigint | null => (plan.ok ? plan.change.price : plan.price);
export const isCold = (plan: Plan): boolean => plan.ok && (plan.change.cold?.length ?? 0) > 0;

/** All hardware edits are live; compatibility is checked during commit. */
export function coldScopes(_state: GameState, _scope: UnitRef | null, _ref?: PartRef): UnitRef[] {
  return [];
}
