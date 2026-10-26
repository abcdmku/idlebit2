import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { systemId } from '../../game';
import type { HitTarget } from '../../render/core';
import { OffersScope } from '../deck/useOffers';
import { fakeStore, mount, type Mounted } from '../hooks/testShell';
import { PlateLayer } from '../plates/PlateLayer';
import { closeTopmost } from '../shell/backGuard';
import { activateTarget } from './commands';

let mounted: Mounted | null = null;
beforeEach(() => { vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null); });
afterEach(() => { mounted?.unmount(); mounted = null; vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const part = (id: string, slot: object): HitTarget => ({ id, kind: 'part', owner: { level: 'chip', id: systemId(0) } as never, drill: null,
  part: { unit: { kind: 'system', id: systemId(0) }, slot } as never, unit: null, sw: null, port: null, slot: null, rect: { x: 0, y: 0, w: 8, h: 8 } });
const clock = part('clock', { kind: 'clock', socket: 0 }), core = part('core0', { kind: 'core', socket: 0, index: 0 });

describe('one tap shows a part\'s whole detail (user, 26 Oct)', () => {
  it('a tap opens the plate at once; the same part again closes it; another part swaps; back closes', () => {
    mounted = mount(<OffersScope><PlateLayer /></OffersScope>, fakeStore(), { width: 1440, height: 900 });
    const v = () => mounted!.shell.view.getState();
    act(() => activateTarget(mounted!.shell, clock));
    expect([v().selectedId, v().plate]).toEqual(['clock', true]);
    act(() => activateTarget(mounted!.shell, core));
    expect([v().selectedId, v().plate]).toEqual(['core0', true]);
    // the core's plate leads with the key that sells the next core (or the clock)
    expect(mounted.host.querySelector('.v3-plate .p-title')?.textContent).toBe('Cores');
    expect(mounted.host.querySelector('.v3-plate .core-list')?.textContent).toContain('1');
    expect(mounted.host.querySelector('.v3-plate .keys')).not.toBeNull();
    // D39: cores are never research-locked: one plain "Add core" key
    expect(mounted.host.querySelector('.v3-plate .keys button')?.textContent).toMatch(/^Add core( · .+)?$/);
    act(() => activateTarget(mounted!.shell, core));
    expect(v().selected).toBeNull();
    act(() => activateTarget(mounted!.shell, clock));
    act(() => { closeTopmost(mounted!.shell); });
    expect(v().selected).toBeNull();
    act(() => activateTarget(mounted!.shell, clock));
    act(() => activateTarget(mounted!.shell, null));
    expect(v().selected).toBeNull();
  });
  it('a thing with its own view zooms in on tap: the CPU in the System view goes to the CPU', () => {
    const store = fakeStore();
    store.set({ unlocked: { chip: true, system: true, rack: false, room: false, global: false } });
    mounted = mount(<OffersScope><PlateLayer /></OffersScope>, store, { width: 1440, height: 900 });
    act(() => { mounted!.shell.view.dispatch({ type: 'drill', ref: { level: 'system', id: systemId(0) } as never }); mounted!.shell.view.settle(false); });
    const cpu: HitTarget = { ...part('child0', { kind: 'cpu', socket: 0 }), kind: 'child', part: null, owner: { level: 'system', id: systemId(0) } as never,
      drill: { level: 'chip', id: systemId(0) } as never };
    act(() => activateTarget(mounted!.shell, cpu));
    expect(mounted.shell.view.getState().focus).toEqual({ level: 'chip', id: 0 });
    expect(mounted.shell.view.getState().selected).toBeNull();
  });
});
