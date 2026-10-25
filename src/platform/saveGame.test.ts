import { beforeEach, describe, expect, it } from 'vitest';
import { advanceGame, createInitialState } from '../game';
import { createPersistenceAdapter } from './persistence';
import { LEGACY_RESET_NOTICE, loadGame, SAVE_KEY, saveGame } from './saveGame';

let n = 0;
const adapter = () => createPersistenceAdapter({ namespace: `save-v3-test-${n++}` });

describe('v3 saves', () => {
  beforeEach(() => window.localStorage.clear());

  it('round-trips a mid-round state and its wall timestamp', async () => {
    const storage = adapter();
    const state = advanceGame(createInitialState(42), 12_345).state;
    expect(saveGame(state, 1_700_000_000_000, storage)).toBe(true);
    const loaded = await loadGame(storage);
    expect(loaded.resetReason).toBeNull();
    expect(loaded.savedAtMs).toBe(1_700_000_000_000);
    expect(loaded.state).toEqual(state);
  });

  it('starts fresh without a save, and says so when only a v2 save exists', async () => {
    const storage = adapter();
    expect(await loadGame(storage, 42)).toMatchObject({ savedAtMs: null, resetReason: null });
    await storage.set('save-v1', 'old');
    const loaded = await loadGame(storage, 42);
    expect(loaded).toMatchObject({ savedAtMs: null, resetReason: LEGACY_RESET_NOTICE });
    expect(loaded.state).toEqual(createInitialState(42));
    expect(await storage.get('save-v1')).toBe('old');
  });

  it('resets unreadable saves with a reason', async () => {
    const storage = adapter();
    await storage.set(SAVE_KEY, { savedAtMs: 1, save: '{"schema":"bitrouge-v2"}' });
    expect((await loadGame(storage)).resetReason).toMatch(/^Save reset: /);
    await storage.set(SAVE_KEY, 'garbage');
    expect((await loadGame(storage)).resetReason).toBe('Invalid save reset.');
  });
});
