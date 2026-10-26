import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HitTarget } from '../../render/core';
import { fakeStore, mount, report, type Mounted } from '../hooks/testShell';
import type { ShellContextValue } from '../storeHooks';
import { useShell } from '../storeHooks';
import { closeTopmost, GUARD, LeaveDialog, useBackGuard } from './backGuard';

let mounted: Mounted | null = null;
beforeEach(() => { vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null); window.history.replaceState(null, '', '/?fresh'); });
afterEach(() => { mounted?.unmount(); mounted = null; vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const target = { id: 'clock', kind: 'part', owner: { level: 'chip', id: 0 }, drill: null, part: null, unit: null, sw: null, port: null, slot: null,
  rect: { x: 0, y: 0, w: 8, h: 8 } } as unknown as HitTarget;

describe('back closes the topmost menu, one per press', () => {
  it('task detail, then the plate (to its callout), the callout, the sheet; then nothing', () => {
    const store = fakeStore();
    mounted = mount(<></>, store);
    const v = mounted.shell.view;
    v.dispatch({ type: 'select', target }); v.dispatch({ type: 'openPlate' });
    v.dispatch({ type: 'toggleSheet', sheet: 'research' });
    expect(v.getState().selected).toBeNull(); // a sheet replaces a callout
    v.dispatch({ type: 'select', target }); v.dispatch({ type: 'openPlate' });
    const seen: string[] = [];
    const step = () => { closeTopmost(mounted!.shell); const s = v.getState(); seen.push(`${s.plate}/${!!s.selected}/${s.sheet}`); };
    step(); step();
    expect(seen).toEqual(['false/true/null', 'false/false/null']);
    v.dispatch({ type: 'openTask', task: '1:1:1' });
    expect(v.getState().task).toBe('1:1:1');
    expect(closeTopmost(mounted.shell)).toBe(true);
    expect(v.getState().task).toBeNull();
    expect(closeTopmost(mounted.shell)).toBe(false);
  });
  it('closes the round report after the view menus', () => {
    const store = fakeStore();
    store.set({ round: { state: 'ended', lastReport: report() } });
    mounted = mount(<></>, store);
    expect(closeTopmost(mounted.shell)).toBe(true);
    expect(store.actions).toEqual([{ type: 'dismissReport' }]);
  });
});

function Guarded({ save }: { save: () => void }) {
  const shell = useShell(), guard = useBackGuard(shell, save);
  return <LeaveDialog guard={guard} />;
}

describe('the back guard and the leave dialog', () => {
  const back = () => act(() => { window.dispatchEvent(new PopStateEvent('popstate', { state: null })); });
  let save: ReturnType<typeof vi.fn>, go: ReturnType<typeof vi.spyOn>, shell: ShellContextValue;
  beforeEach(() => {
    save = vi.fn(); go = vi.spyOn(window.history, 'go').mockImplementation(() => undefined);
    mounted = mount(<Guarded save={save as never} />, fakeStore()); shell = mounted.shell;
  });
  it('pushes one guard entry on the same URL, so query flags keep working', () => {
    expect(window.history.state).toEqual(GUARD);
    expect(window.location.search).toBe('?fresh');
  });
  it('back with a menu open closes it and re-arms the guard; with nothing open it asks, Stay keeps the game', () => {
    act(() => shell.view.dispatch({ type: 'openTask', task: '1:1:1' }));
    back();
    expect(shell.view.getState().task).toBeNull();
    expect(window.history.state).toEqual(GUARD);
    expect(mounted!.host.querySelector('[data-testid=leave-dialog]')).toBeNull();
    back();
    const dialog = mounted!.host.querySelector('[data-testid=leave-dialog]')!;
    expect(dialog.textContent).toContain('Leave idlebit2?');
    expect(dialog.textContent).toContain('Your progress is saved.');
    expect(document.activeElement?.textContent).toBe('Stay');
    act(() => (document.activeElement as HTMLButtonElement).click());
    expect(mounted!.host.querySelector('[data-testid=leave-dialog]')).toBeNull();
    expect(go).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });
  it('Leave saves first, then steps past the guard and the page; a second back counts as Leave', () => {
    back();
    const leave = [...mounted!.host.querySelectorAll('button')].find(b => b.textContent === 'Leave')!;
    act(() => leave.click());
    expect(save).toHaveBeenCalledOnce();
    expect(go).toHaveBeenCalledWith(-2);
    back();
    back();
    expect(save).toHaveBeenCalledTimes(2);
    expect(go).toHaveBeenLastCalledWith(-1);
  });
});
