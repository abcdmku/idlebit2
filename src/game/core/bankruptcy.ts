import { amountAdd, ZERO_AMOUNT } from '../amount';
import type { GameState } from '../types/state';
import { accept, reject } from './actions';
import { toAmount } from './world';

/** Whole-Data prices round up. A zero Data balance has no fee. */
export function selectBankruptcy(state: GameState) {
  return { available: state.wallet.credits !== ZERO_AMOUNT, dataCost: toAmount((BigInt(state.wallet.data) + 9n) / 10n) };
}

export function declareBankruptcy(state: GameState) {
  const { available, dataCost } = selectBankruptcy(state);
  if (!available) return reject(state, 'invalid', 'Credits are already zero');
  return accept({
    ...state,
    wallet: { ...state.wallet, credits: ZERO_AMOUNT, data: toAmount(BigInt(state.wallet.data) - BigInt(dataCost)) },
    ledger: { ...state.ledger, dataSpent: amountAdd(state.ledger.dataSpent, dataCost) },
    research: state.research.stoppedInsolvent ? { ...state.research, stoppedInsolvent: false } : state.research,
  });
}
