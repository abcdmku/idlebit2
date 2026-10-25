import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLevelRegistry, ORDER, setRect } from '../core';
import type { LevelId, LevelRenderer, LevelRegistry } from '../core';
import { fixtureSnapshot, fixtureSystem } from '../core/fixtureLevels';
import { recordingContext } from '../core/testCanvas';
import { createGameRegistry, loadLevels, registerLevels, registeredLevelIds } from '.';
import type { LevelModules } from '.';

// A real lazy-glob import must contain an evaluation failure, before its factory runs.
vi.mock('./room/index.ts', () => { throw new Error('room module evaluation failed'); });

afterEach(() => vi.restoreAllMocks());

function renderer<L extends LevelId>(id: L): LevelRenderer<L> {
  return {
    id, name: `Healthy ${id}`,
    size: (_s, out) => setRect(out, 0, 0, 160, 200),
    focus: (_s, _vp, out) => setRect(out, 0, 0, 160, 200),
    draw: vi.fn(), drawMini: vi.fn(), icon: vi.fn(),
    children: () => 0, targets: (_s, _v, _out, from) => from,
  };
}

function healthyModules(): Record<string, LevelModules> {
  return {
    './chip/index.ts': { createChipRenderer: () => renderer('chip') },
    './system/index.ts': { createSystemRenderer: () => renderer('system') },
    './rack/index.ts': { createRackRenderer: () => renderer('rack') },
    './room/index.ts': { createRoomRenderer: () => renderer('room') },
    './global/index.ts': { createGlobalRenderer: () => renderer('global') },
  };
}

function loaders(found: Record<string, LevelModules>) {
  return Object.fromEntries(Object.entries(found).map(([path, module]) => [path, async () => module]));
}

describe('independent level registration', () => {
  it('contains a real module evaluation failure with the default lazy imports', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const registry = await createGameRegistry();
    expect(registry.level('room').name).toBe('room');
    expect(registry.level('chip').name).toBe('CPU');
    expect(registry.level('system').name).toBe('System');
    expect(registry.level('global').name).toBe('World');
    expect(log.mock.calls.filter(([message]) => String(message).includes('"room"'))).toEqual([
      ['Failed to load level "room"', expect.objectContaining({
        cause: expect.objectContaining({ message: 'room module evaluation failed' }),
      })],
    ]);
  });

  it.each(['reject', 'throw'] as const)('keeps every other level when a loader fails by %s', async mode => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const error = new Error('Cannot access GATE_STYLE before initialization');
    const found = loaders(healthyModules());
    found['./room/index.ts'] = () => {
      if (mode === 'throw') throw error;
      return Promise.reject(error);
    };
    const registry = createLevelRegistry();
    await loadLevels(registry, found);
    expect(registeredLevelIds(registry)).toEqual(ORDER);
    for (const id of ORDER.filter(id => id !== 'room')) expect(registry.level(id).name).toBe(`Healthy ${id}`);
    expect(log.mock.calls).toEqual([['Failed to load level "room"', error]]);

    // A surviving parent can still draw a failed child's mini, without touching the canvas.
    const { g, fills } = recordingContext(), s = fixtureSystem(), snapshot = fixtureSnapshot(s);
    const frame = { snapshot, timeMs: 0, paused: false, reducedMotion: false, zoom: null };
    registry.level('room').drawMini(g, {} as Parameters<LevelRenderer<'room'>['drawMini']>[1],
      { x: 0, y: 0, w: 10, h: 10 }, frame);
    registry.level('room').icon(g);
    expect(fills).toHaveLength(0);
  });

  it.each(['factory', 'validation', 'missing', 'wrong id'] as const)('contains %s failures in the sync path', kind => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const error = new Error('factory failed'), found = healthyModules();
    found['./system/index.ts'] = kind === 'missing' ? {} : {
      createSystemRenderer: () => {
        if (kind === 'factory') throw error;
        if (kind === 'wrong id') return renderer('room') as unknown as LevelRenderer<'system'>;
        return { ...renderer('system'), drawMini: undefined } as unknown as LevelRenderer<'system'>;
      },
    };
    const registry = createGameRegistry(found);
    expect(registry.level('system').name).toBe('system');
    for (const id of ORDER.filter(id => id !== 'system')) expect(registry.level(id).name).toBe(`Healthy ${id}`);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith('Failed to register level "system"', expect.any(Error));
    if (kind === 'factory') expect(log).toHaveBeenCalledWith('Failed to register level "system"', error);
  });

  it('logs registration failures after async loading and still registers later levels', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const error = new Error('room factory failed'), found = healthyModules();
    found['./room/index.ts'] = { createRoomRenderer: () => { throw error; } };
    const registry = createLevelRegistry();
    await loadLevels(registry, loaders(found));
    expect(registry.level('room').name).toBe('room');
    expect(registry.level('global').name).toBe('Healthy global');
    expect(log.mock.calls).toEqual([['Failed to register level "room"', error]]);
  });

  it('passes the same registry to factories and fills absent levels synchronously', () => {
    let received: LevelRegistry | undefined;
    const registry = createLevelRegistry();
    expect(registerLevels(registry, { './chip/index.ts': { createChipRenderer: shared => {
      received = shared;
      return renderer('chip');
    } } })).toBeUndefined();
    expect(received).toBe(registry);
    const s = fixtureSystem(), out = { x: -1, y: -1, w: 0, h: 0 };
    expect(registry.level('system').size(s, out)).toBe(out);
    expect(out).toEqual({ x: 0, y: 0, w: 160, h: 200 });
    expect(registry.level('system').focus(s, out, out)).toBe(out);
    expect(registry.level('system').children(s, [])).toBe(0);
    expect(registry.level('system').targets(s,
      { selectedId: null, picked: null, quotes: null, reducedMotion: false }, [], 3)).toBe(3);
  });
});
