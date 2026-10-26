// Sandbox mode (user, 26 Oct): `?sandbox` plays on its own save with effectively infinite Credits and
// Data; `?sandbox&reset` starts it fresh. The real save is never read or written. It works in production:
// it is only a separate local save. The wallet is set on the store, as the QA fixtures do; no sim action.
import type { Amount, GameState } from '../../game';
import { createPersistenceAdapter, type PersistenceAdapter, type RuntimeStore } from '../../platform';

/** Its own storage namespace, so the real save (`idlebit2:*`) is untouched. */
export const SANDBOX_NAMESPACE = 'idlebit2-sandbox';
/** 1e100, exact. */
export const SANDBOX_WALLET = `1${'0'.repeat(100)}` as Amount;
/** Below 1e90 (91 digits) either currency refills to 1e100. */
const FLOOR_DIGITS = 91;

export interface SandboxFlags { readonly on: boolean; readonly reset: boolean }
export const sandboxFlags = (search: string): SandboxFlags => {
  const p = new URLSearchParams(search);
  return { on: p.has('sandbox'), reset: p.has('sandbox') && p.has('reset') };
};

/** The sandbox's persistence: its own namespace. */
export const sandboxPersistence = (): PersistenceAdapter => createPersistenceAdapter({ namespace: SANDBOX_NAMESPACE });

const low = (a: Amount) => a.startsWith('-') || a.length < FLOOR_DIGITS;

/** The state with both currencies at 1e100 when either fell below 1e90; the same state otherwise. */
export function toppedUp(state: GameState): GameState {
  const w = state.wallet;
  if (!low(w.credits) && !low(w.data)) return state;
  return { ...state, wallet: { ...w, credits: low(w.credits) ? SANDBOX_WALLET : w.credits, data: low(w.data) ? SANDBOX_WALLET : w.data } };
}

/** Keeps the store's wallet topped up between ticks. Returns the stop function. */
export function startSandbox(store: Pick<RuntimeStore, 'getState' | 'replaceState' | 'subscribe'>): () => void {
  let busy = false;
  const check = () => {
    if (busy) return;
    const s = store.getState(), next = toppedUp(s);
    if (next === s) return;
    busy = true;
    try { store.replaceState(next, false); } finally { busy = false; }
  };
  check();
  return store.subscribe(check);
}

/** Read once at boot: the UI's tag. */
export const IS_SANDBOX = typeof location !== 'undefined' && sandboxFlags(location.search).on;
