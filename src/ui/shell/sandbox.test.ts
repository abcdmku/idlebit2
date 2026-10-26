import { afterEach, describe, expect, it } from 'vitest';
import { createInitialState, type Amount } from '../../game';
import { bitRougePersistence, createGameStore } from '../../platform';
import { SANDBOX_NAMESPACE, SANDBOX_WALLET, sandboxFlags, sandboxPersistence, startSandbox, toppedUp } from './sandbox';

afterEach(() => localStorage.clear());

describe('sandbox (user, 26 Oct: infinite Credits and Data on a separate save)', () => {
  it('reads ?sandbox and ?sandbox&reset', () => {
    expect([sandboxFlags('?sandbox'), sandboxFlags('?sandbox&reset'), sandboxFlags('?reset'), sandboxFlags('')]).toEqual([
      { on: true, reset: false }, { on: true, reset: true }, { on: false, reset: false }, { on: false, reset: false }]);
  });
  it('saves under its own key, never the real save', async () => {
    await sandboxPersistence().set('save', 'sandbox');
    const keys = Object.keys(localStorage);
    expect(keys.some(k => k.startsWith(`${SANDBOX_NAMESPACE}:`))).toBe(true);
    expect(await bitRougePersistence.get('save')).toBeNull();
  });
  it('starts at 1e100 of each and refills either below 1e90', () => {
    const store = createGameStore({ initialState: createInitialState(1) });
    const stop = startSandbox(store);
    expect(store.getState().wallet).toMatchObject({ credits: SANDBOX_WALLET, data: SANDBOX_WALLET });
    expect(SANDBOX_WALLET).toBe(`1${'0'.repeat(100)}`);
    const s = store.getState();
    store.replaceState({ ...s, wallet: { ...s.wallet, credits: `9${'0'.repeat(80)}` as Amount } });
    expect(store.getState().wallet.credits).toBe(SANDBOX_WALLET);
    // plenty left: untouched
    const rich = { ...s, wallet: { ...s.wallet, credits: `5${'0'.repeat(95)}` as Amount } };
    expect(toppedUp(rich)).toBe(rich);
    stop(); store.dispose?.();
  });
});
