import { amountCompare, amountSubtract, amountAdd, type Amount } from '../amount';
import { buildHandlers } from '../build/actions';
import { marketHandlers } from '../market/actions';
import type { ActionOf, ActionOutcome, GameAction, GameActionType, RejectionCode } from '../types/actions';
import type { GameState } from '../types/state';
import { coreHandlers } from './coreActions';
import { roundRewardHandlers } from '../rewards/actions';

export type ActionHandler<A extends GameAction> = (state: GameState, action: A) => ActionOutcome;
export type HandlerMap = { readonly [T in GameActionType]?: ActionHandler<ActionOf<T>> };

export const accept = (state: GameState): ActionOutcome => ({ ok: true, state });
export const reject = (state: GameState, code: RejectionCode, reason: string): ActionOutcome =>
  ({ ok: false, state, rejection: { code, reason } });

/** Domains register handlers by action type. A type nobody handles is rejected as `invalid`. */
const HANDLERS: HandlerMap = { ...marketHandlers, ...buildHandlers, ...coreHandlers, ...roundRewardHandlers };

/**
 * Applies one player action between ticks (architecture §4). Validates against the current
 * state, debits the quoted Amount, edits build, recompiles only changed units. Never accepts a
 * client price.
 */
export function applyAction(state: GameState, action: GameAction): ActionOutcome {
  const handler = HANDLERS[action.type] as ActionHandler<GameAction> | undefined;
  if (!handler) return reject(state, 'invalid', `Not implemented: ${action.type}`);
  return handler(state, action);
}

/** Debits whole Credits. Purchases need wallet >= price (spec §9.8). */
export function debitCredits(state: GameState, price: Amount): ActionOutcome {
  if (amountCompare(state.wallet.credits, price) < 0) return reject(state, 'funds', 'Not enough Credits');
  return accept({
    ...state,
    wallet: { ...state.wallet, credits: amountSubtract(state.wallet.credits, price) },
    ledger: { ...state.ledger, creditsSpent: amountAdd(state.ledger.creditsSpent, price) },
  });
}

/** Debits whole Data (research starts only, D3.4). */
export function debitData(state: GameState, cost: Amount): ActionOutcome {
  if (amountCompare(state.wallet.data, cost) < 0) return reject(state, 'funds', 'Not enough Data');
  return accept({
    ...state,
    wallet: { ...state.wallet, data: amountSubtract(state.wallet.data, cost) },
    ledger: { ...state.ledger, dataSpent: amountAdd(state.ledger.dataSpent, cost) },
  });
}
