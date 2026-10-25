import { applyAction, debitCredits, debitData } from './actions';
import { createInitialState } from './state';
import { amount } from '../amount';
import { advanceGame } from './advance';

describe('action dispatcher', () => {
  it('rejects unimplemented actions as invalid without touching state', () => {
    const state = createInitialState(42);
    const outcome = applyAction(state, { type: 'cancelResearch' });
    expect(outcome.ok).toBe(false);
    expect(outcome.state).toBe(state);
    if (!outcome.ok) expect(outcome.rejection.code).toBe('invalid');
  });

  it('resets to a fresh game with a bumped epoch and the same seed', () => {
    const played = advanceGame(createInitialState(7), 5_000).state;
    const outcome = applyAction(played, { type: 'reset' });
    expect(outcome.ok).toBe(true);
    expect(outcome.state.epoch).toBe(1);
    expect(outcome.state.seed).toBe(7);
    expect(outcome.state.clock.tick).toBe(0);
  });

  it('debits whole Credits and Data only when affordable', () => {
    const base = createInitialState(42);
    const rich = { ...base, wallet: { ...base.wallet, credits: amount(10), data: amount(3) } };
    const paid = debitCredits(rich, amount(4));
    expect(paid.ok && paid.state.wallet.credits).toBe('6');
    expect(paid.ok && paid.state.ledger.creditsSpent).toBe('4');
    const broke = debitCredits(rich, amount(11));
    expect(!broke.ok && broke.rejection.code).toBe('funds');
    const data = debitData(rich, amount(3));
    expect(data.ok && data.state.wallet.data).toBe('0');
    expect(debitData(rich, amount(4)).ok).toBe(false);
  });
});
