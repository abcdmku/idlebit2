import { afterEach, describe, expect, it } from 'vitest';
import { advanceGame, createInitialState, offlineCapMs, type GameAction } from '../game';
import { gameOfflineEngine } from './offline';
import { createOfflineRunner } from './offlineRunner';
import { createPersistenceAdapter } from './persistence';
import { createRuntime, type GameRuntime } from './runtime';
import { loadGame, saveGame } from './saveGame';
import { createGameStore, type RuntimeStore } from './store';

let n = 0;
const HOUR = 3_600_000;

function harness(options: { wall?: number; save?: { ticksMs: number; savedAtMs: number }; chunkMs?: number } = {}) {
  const persistence = createPersistenceAdapter({ namespace: `runtime-v3-${n++}` });
  if (options.save) saveGame(advanceGame(createInitialState(42), options.save.ticksMs).state, options.save.savedAtMs, persistence);
  const clock = { wall: options.wall ?? 1_000_000, mono: 0 };
  const frames = new Map<number, FrameRequestCallback>();
  let frameId = 0;
  const listeners = new Map<string, Set<() => void>>();
  const on = (type: string, fn: () => void) => { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type)!.add(fn); };
  const off = (type: string, fn: () => void) => listeners.get(type)?.delete(fn);
  const doc = { visibilityState: 'visible' as DocumentVisibilityState, addEventListener: on, removeEventListener: off };
  const store: RuntimeStore = createGameStore({ initialState: createInitialState(42) });
  const runtime: GameRuntime = createRuntime(store, {
    persistence, seed: 42, now: () => clock.wall, monoNow: () => clock.mono,
    requestFrame: cb => { frames.set(++frameId, cb); return frameId; }, cancelFrame: id => { frames.delete(id); },
    document: doc as unknown as Document, window: { addEventListener: on, removeEventListener: off } as unknown as Window,
    createRunner: () => createOfflineRunner({ engine: gameOfflineEngine, mainSliceMs: 10_000 }),
    chunkMs: options.chunkMs ?? 60_000,
  });
  const frame = (ms: number) => {
    clock.wall += ms; clock.mono += ms;
    const batch = [...frames.values()]; frames.clear();
    for (const cb of batch) cb(clock.mono);
  };
  const setVisible = (visible: boolean) => {
    doc.visibilityState = visible ? 'visible' : 'hidden';
    for (const fn of listeners.get('visibilitychange') ?? []) fn();
  };
  return { store, runtime, persistence, clock, frame, setVisible };
}

const simMs = (store: RuntimeStore) => store.getState().clock.tick * 100 + store.getState().clock.carryMs;
let active: GameRuntime | null = null;
afterEach(() => { active?.dispose(); active = null; });

describe('v3 runtime', () => {
  it('boots a new game and advances whole cadence steps per frame', async () => {
    const h = harness(); active = h.runtime;
    await h.runtime.ready;
    expect(h.store.getLifecycle()).toMatchObject({ hydrated: true, catchingUp: false });
    h.frame(16.7); h.frame(16.7);
    expect(simMs(h.store)).toBe(0);
    h.frame(16.7);
    expect(simMs(h.store)).toBe(50);
    for (let i = 0; i < 57; i++) h.frame(16.7);
    expect(simMs(h.store)).toBe(1000);
  });

  it('catches up time away from a save in chunks and reports it', async () => {
    const h = harness({ wall: 2_000_000 + 600_000, save: { ticksMs: 5_000, savedAtMs: 2_000_000 }, chunkMs: 120_000 });
    active = h.runtime;
    const seen: number[] = [];
    h.store.subscribe(() => { const p = h.store.getCatchUp(); if (p) seen.push(p.simulatedMs); });
    await h.runtime.ready;
    expect(simMs(h.store)).toBe(605_000);
    expect(seen.at(-1)).toBe(600_000);
    expect(seen).toContain(120_000);
    expect(h.store.getOfflineReport()?.ticks).toBe(6_000);
    expect(h.store.getCatchUp()).toBeNull();
    expect(h.store.getState()).toEqual(advanceGame(createInitialState(42), 605_000).state);
  });

  it('caps time away at the researched offline cap', async () => {
    const cap = offlineCapMs(createInitialState(42));
    const h = harness({ wall: 10 + cap + 5 * HOUR, save: { ticksMs: 0, savedAtMs: 10 }, chunkMs: HOUR });
    active = h.runtime;
    await h.runtime.ready;
    expect(simMs(h.store)).toBe(cap);
    expect((await loadGame(h.persistence)).savedAtMs).toBe(10 + cap + 5 * HOUR);
  }, 60_000);

  it('saves on hide and catches up the hidden span on return', async () => {
    const h = harness(); active = h.runtime;
    await h.runtime.ready;
    h.frame(100);
    h.setVisible(false);
    const saved = await loadGame(h.persistence);
    expect(saved.savedAtMs).toBe(h.clock.wall);
    h.clock.wall += 300_000; h.clock.mono += 300_000;
    h.setVisible(true);
    expect(h.store.getLifecycle().catchingUp).toBe(true);
    await new Promise<void>(resolve => {
      const unsubscribe = h.store.subscribe(() => {
        if (!h.store.getLifecycle().catchingUp) { unsubscribe(); resolve(); }
      });
    });
    expect(h.store.getLifecycle().catchingUp).toBe(false);
    expect(simMs(h.store)).toBe(300_100);
    expect(h.store.getCatchUp()).toBeNull();
    expect(h.store.getOfflineReport()?.ticks).toBe(3_000);
    expect((await loadGame(h.persistence)).savedAtMs).toBe(h.clock.wall);
    h.frame(100);
    expect(simMs(h.store)).toBe(300_200);
  });

  it('applies actions queued before hydration before the catch-up starts', async () => {
    const h = harness({ wall: 1_000 + 180_000, save: { ticksMs: 0, savedAtMs: 1_000 }, chunkMs: 60_000 });
    active = h.runtime;
    const reset: GameAction = { type: 'reset' };
    expect(h.store.dispatch(reset)).toBeNull();
    await h.runtime.ready;
    expect(h.store.queuedCount()).toBe(0);
    expect(h.store.getState().epoch).toBe(1);
    expect(simMs(h.store)).toBe(180_000);
  });

  it('sends actions queued mid catch-up with the next chunk; a reset ends the absence', async () => {
    const h = harness({ wall: 1_000 + 300_000, save: { ticksMs: 0, savedAtMs: 1_000 }, chunkMs: 60_000 });
    active = h.runtime;
    let sent = false;
    h.store.subscribe(() => {
      if (!sent && (h.store.getCatchUp()?.simulatedMs ?? 0) >= 60_000) { sent = true; h.store.dispatch({ type: 'reset' }); }
    });
    await h.runtime.ready;
    expect(sent).toBe(true);
    expect(h.store.getState().epoch).toBe(1);
    // The reset applied at the start of chunk 2, which then ran 60 s on the new game; the rest was dropped.
    expect(simMs(h.store)).toBe(60_000);
    expect(h.store.getOfflineReport()).toBeNull();
    expect((await loadGame(h.persistence)).savedAtMs).toBe(h.clock.wall);
  });

  it('pauses sim time and simulates an absence through the offline runner', async () => {
    const h = harness(); active = h.runtime;
    await h.runtime.ready;
    h.runtime.pause();
    h.frame(5_000);
    expect(simMs(h.store)).toBe(0);
    await h.runtime.simulateOffline(90_000);
    expect(simMs(h.store)).toBe(90_000);
    expect(h.store.getOfflineReport()?.ticks).toBe(900);
    h.runtime.resume();
    h.frame(100);
    expect(simMs(h.store)).toBe(90_100);
  });
});
