import { describe, expect, it, vi } from 'vitest';
import { advanceGame, createInitialState, serializeSave, systemId, type SnapshotScope } from '../game';
import { createGameStore, DEFAULT_SCOPE } from './store';

const systemScope: SnapshotScope = { focus: { level: 'system', id: systemId(0) }, partner: null };

describe('v3 game store', () => {
  it('publishes and rebuilds the snapshot only when an advance ticks', () => {
    const store = createGameStore({ initialState: createInitialState(42) });
    const listener = vi.fn();
    store.subscribe(listener);
    const first = store.getSnapshot();
    expect(store.getSnapshot()).toBe(first);
    expect(store.advance(50).ticks).toBe(0);
    expect(listener).not.toHaveBeenCalled();
    expect(store.getSnapshot()).toBe(first);
    expect(store.getState().clock).toEqual({ tick: 0, carryMs: 50 });
    expect(store.advance(50).ticks).toBe(1);
    expect(listener).toHaveBeenCalledTimes(1);
    const next = store.getSnapshot();
    expect(next).not.toBe(first);
    expect(next.tick).toBe(1);
  });

  it('rebuilds for a new scope and ignores an equal one', () => {
    const store = createGameStore({ initialState: createInitialState(42) });
    const listener = vi.fn();
    store.subscribe(listener);
    const chip = store.getSnapshot();
    store.setScope({ focus: { level: 'chip', id: systemId(0) }, partner: null });
    expect(listener).not.toHaveBeenCalled();
    store.setScope(systemScope);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getScope()).toBe(systemScope);
    expect(store.getSnapshot()).not.toBe(chip);
    expect(DEFAULT_SCOPE.focus.level).toBe('chip');
  });

  it('queues actions until hydrated, then applies them in order after the boundary', () => {
    const store = createGameStore({ initialState: createInitialState(42) });
    const boundary = vi.fn();
    store.setActionBoundary(boundary);
    expect(store.dispatch({ type: 'reset' })).toBeNull();
    expect(store.queuedCount()).toBe(1);
    store.setLifecycle({ hydrated: true });
    expect(store.flushQueued()).toBe(1);
    expect(boundary).toHaveBeenCalledTimes(1);
    expect(store.getState().epoch).toBe(1);
    const outcome = store.dispatch({ type: 'reset' });
    expect(outcome?.ok).toBe(true);
    expect(store.getState().epoch).toBe(2);
  });

  it('notifies once per batch', () => {
    const store = createGameStore({ initialState: createInitialState(42) });
    const listener = vi.fn();
    store.subscribe(listener);
    store.batch(() => {
      store.setNotice('a'); store.setCatchUp({ simulatedMs: 0, totalMs: 10, awayMs: 10 }); store.advance(100);
    });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('advances its own states in place but never one handed in (D9)', () => {
    const start = createInitialState(42), saved = serializeSave(start);
    const store = createGameStore({ initialState: start });
    for (let frame = 0; frame < 40; frame++) store.advance(50);
    const ticked = store.getState();
    store.advance(50);
    expect(serializeSave(start)).toBe(saved);
    expect(() => ticked.clock).toThrow(/consumed/);
    expect(store.getState()).toEqual(advanceGame(start, 41 * 50).state);
    const replaced = advanceGame(start, 1_000).state, kept = serializeSave(replaced);
    store.replaceState(replaced);
    store.advance(500);
    expect(serializeSave(replaced)).toBe(kept);
  });
});
