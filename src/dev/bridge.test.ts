import { afterEach, describe, expect, it } from 'vitest';
import { createInitialState } from '../game';
import { createGameStore, createPersistenceAdapter, createRuntime, gameOfflineEngine, type GameRuntime } from '../platform';
import { createOfflineRunner } from '../platform/offlineRunner';
import { attachLiveBridge, installEarlyBridge, type V3Bridge } from './bridge';

let runtime: GameRuntime | null = null;
afterEach(() => { runtime?.dispose(); runtime = null; installEarlyBridge().dispose(); });

describe('v3 DEV bridge', () => {
  it('exposes the real store and runtime on window.__br once ready', async () => {
    const boot = installEarlyBridge();
    const bridge = (window as unknown as { __br: V3Bridge }).__br;
    expect(bridge).toBe(boot.bridge);
    expect(bridge.bootStatus).toBe('booting');

    const store = createGameStore({ initialState: createInitialState(42) });
    runtime = createRuntime(store, {
      persistence: createPersistenceAdapter({ namespace: 'bridge-v3-test' }), fresh: true, seed: 42,
      createRunner: () => createOfflineRunner({ engine: gameOfflineEngine }),
      requestFrame: () => 0, cancelFrame: () => {},
    });
    attachLiveBridge(store, runtime);
    await bridge.ready();
    expect(bridge.bootStatus).toBe('ready');

    bridge.pause!();
    expect((await bridge.advance!(1_000)).ticks).toBe(10);
    expect(bridge.getSnapshot!().tick).toBe(10);
    await bridge.simulateOffline!(30_000);
    expect(bridge.getState!().clock.tick).toBe(310);
    expect((await bridge.dispatch!({ type: 'reset' }))?.ok).toBe(true);
    expect(bridge.getState!().epoch).toBe(1);
    await expect(bridge.advance!(1.5)).rejects.toThrow(RangeError);
  });
});
