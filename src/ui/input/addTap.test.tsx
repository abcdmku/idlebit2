import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createInitialState, systemId, type Amount, type GameState, type Quote } from '../../game';
import { createGameStore, type RuntimeStore } from '../../platform';
import type { HitTarget } from '../../render/core';
import { mount, type Mounted } from '../hooks/testShell';
import { OffersScope } from '../deck/useOffers';
import { PlateLayer } from '../plates/PlateLayer';
import { overSupplyText, supplyRequest } from '../plates/overSupply';
import { OverSupplyNote } from '../plates/widgets';
import { hideSupplyToast, showSupplyToast, SupplyToast, supplyToastNow, supplyToastText } from '../shell/supplyToast';
import { activateTarget } from './commands';

const sys = systemId(0);
let mounted: Mounted | undefined, store: RuntimeStore | undefined;
beforeEach(() => { vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null); });
afterEach(() => { mounted?.unmount(); mounted = undefined; store?.dispose(); store = undefined; hideSupplyToast(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function setup(credits: string): Mounted {
  const base = createInitialState(42);
  const state: GameState = { ...base, wallet: { ...base.wallet, credits: credits as Amount } };
  store = createGameStore({ initialState: state });
  store.setLifecycle({ hydrated: true });
  mounted = mount(<OffersScope><PlateLayer /></OffersScope>, store);
  return mounted;
}
const coreAdd = (m: Mounted): HitTarget => {
  const owner = m.shell.view.getState().focus;
  return { id: 'add:core', kind: 'add', owner, unit: { kind: 'system', id: sys }, slot: store!.getState().build.systems[0]!.spec.cpu!.cores.length,
    part: null, drill: null, sw: null, port: null, rect: { x: 0, y: 0, w: 8, h: 8 } } as HitTarget;
};

describe('tapping a "+" buys that component (user, 26 Oct)', () => {
  it('buys the next core at once when it can be afforded, with no plate', () => {
    const m = setup('1000000000000');
    const cores = store!.getState().build.systems[0]!.spec.cpu!.cores.length;
    act(() => activateTarget(m.shell, coreAdd(m)));
    expect(store!.getState().build.systems[0]!.spec.cpu!.cores.length).toBe(cores + 1);
    expect(m.shell.view.getState()).toMatchObject({ selected: null, plate: false });
  });

  it('opens the Cores plate at that slot when short of Credits, and buys nothing', () => {
    const m = setup('0');
    const before = store!.getState().build.systems[0]!.spec.cpu!.cores.length;
    act(() => activateTarget(m.shell, coreAdd(m)));
    expect(store!.getState().build.systems[0]!.spec.cpu!.cores.length).toBe(before);
    expect(m.shell.view.getState()).toMatchObject({ selectedId: 'add:core', plate: true });
    expect(m.host.querySelector('.p-title')?.textContent).toBe('Cores');
    // a second tap on the same "+" closes it
    act(() => activateTarget(m.shell, coreAdd(m)));
    expect(m.shell.view.getState().selected).toBeNull();
  });
});

describe('over a supply (sim overSupply, view watts)', () => {
  const os = { part: 'psu', capW: 64, afterW: 80 } as const;
  it('words the warning and asks for the focused system\'s power supply quote', () => {
    expect(overSupplyText(os)).toBe('Over the power supply · 64 W → 80 W');
    expect(overSupplyText({ part: 'pdu', capW: 2000, afterW: 2500 })).toMatch(/^Over the rack PDU · /);
    expect(overSupplyText({ part: 'ups', capW: 2000, afterW: 2500 })).toMatch(/^Over the room UPS · /);
    const m = setup('0');
    expect(supplyRequest(os, m.shell.store.getSnapshot())).toEqual({ kind: 'part', part: { unit: { kind: 'system', id: sys }, slot: { kind: 'psu' } } });
  });

  it('shows the warning line and an upgrade key for the supply on a key whose quote carries it', () => {
    const m = setup('1000000000000');
    mounted!.unmount();
    const q = { action: { type: 'returnToMarket' }, overSupply: os } as unknown as Quote;
    mounted = mount(<div className="v3-plate"><OverSupplyNote quote={q} onAction={() => undefined} /></div>, m.shell.store);
    expect(mounted.host.querySelector('[data-testid=over-supply]')?.textContent).toBe('Over the power supply · 64 W → 80 W');
    expect(mounted.host.querySelector('.key .kl')?.textContent).toBe('Upgrade power supply');
  });

  it('a buy over a supply raises a brief toast with a key to the supply', () => {
    const m = setup('0');
    mounted!.unmount();
    mounted = mount(<SupplyToast />, m.shell.store);
    act(() => showSupplyToast(os));
    expect(mounted.host.querySelector('[data-testid=supply-toast]')?.textContent).toContain(supplyToastText(os));
    expect(supplyToastText(os)).toBe('Over the power supply · upgrade it first');
    act(() => (mounted!.host.querySelector('[data-testid=supply-toast] button') as HTMLButtonElement).click());
    expect(supplyToastNow()).toBeNull();
  });
});
