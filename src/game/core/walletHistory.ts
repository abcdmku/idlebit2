import type { GameState, WalletSample } from '../types/state';
import { TICKS_PER_SECOND } from './constants';
import { toAmount, type World } from './world';

export const WALLET_HISTORY_LIMIT = 600;

function append(samples: WalletSample[], sample: WalletSample): void {
  const last = samples.at(-1);
  if (!sample.checkpoint && last && !last.checkpoint
    && Math.floor((last.tick - 1) / TICKS_PER_SECOND) === Math.floor((sample.tick - 1) / TICKS_PER_SECOND)) {
    samples[samples.length - 1] = sample;
  } else samples.push(sample);
  if (samples.length > WALLET_HISTORY_LIMIT) samples.splice(0, samples.length - WALLET_HISTORY_LIMIT);
}

/** End-of-tick balances include energy and research payments, independent of advance chunking. */
export function walletHistoryPhase(w: World): void {
  const l = w.ledger;
  if (l.credits === l.historyCredits && l.data === l.historyData) return;
  append(l.walletHistory, { tick: w.tick + 1, credits: toAmount(l.credits), data: toAmount(l.data), checkpoint: false });
  l.historyCredits = l.credits;
  l.historyData = l.data;
}

/** Preserve immediate purchases and bankruptcy at their actual simulation tick. */
export function recordWalletAction(before: GameState, after: GameState): GameState {
  if (before.epoch !== after.epoch) return after;
  if (before.wallet.credits === after.wallet.credits && before.wallet.data === after.wallet.data) return after;
  const samples = [...after.ledger.walletHistory], tick = after.clock.tick;
  const last = samples.at(-1);
  if (!last || last.tick < tick || last.credits !== before.wallet.credits || last.data !== before.wallet.data) {
    append(samples, { tick, credits: before.wallet.credits, data: before.wallet.data, checkpoint: true });
  }
  append(samples, { tick, credits: after.wallet.credits, data: after.wallet.data, checkpoint: true });
  return { ...after, ledger: { ...after.ledger, walletHistory: samples } };
}
