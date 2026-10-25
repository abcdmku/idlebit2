import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { LEVEL_FIXTURES } from '../../game/fixtures';
import { rackId, systemId, type Amount, type GameAction, type ScopeRef } from '../../game';
import type { HitTarget } from '../../render/core';
import { ConfigPlate, configOptions, shortfall } from './ConfigPlate';
import { configKind, plateRequest } from './PlateLayer';
import { SavePrompt, nextDefaultName } from './SavePrompt';
import { button, click, mount, q, researchLock, result, type Mounted } from './testkit';

let m: Mounted, acts: GameAction[], onClose: ReturnType<typeof vi.fn<() => void>>;
beforeEach(() => { m = mount(); acts = []; onClose = vi.fn<() => void>(); });
afterEach(() => m.unmount());
const onAction = (a: GameAction) => { acts.push(a); };

const parent: ScopeRef = { kind: 'rack', id: rackId(0) };
const add = (source: Extract<GameAction, { type: 'addUnit' }>['source'], cost: number, label: string, extra = {}) =>
  q({ type: 'addUnit', parent, slot: 7, source }, cost, { label, ...extra });
const quotes = result([
  add({ kind: 'barebones', tier: 0 }, 40, 'Hz'),
  add({ kind: 'barebones', tier: 1 }, 2400, 'kHz'),
  add({ kind: 'barebones', tier: 2 }, 96_000, 'MHz', { locked: researchLock('fabMhz', 'Needs MHz fab research') }),
  add({ kind: 'barebones', tier: 3 }, 4_100_000, 'GHz', { locked: researchLock('fabGhz', 'Needs GHz fab research') }),
  add({ kind: 'copy', from: { kind: 'system', id: systemId(0) } }, 3100, 'Server 1'),
  add({ kind: 'copy', from: { kind: 'system', id: systemId(1) } }, 2980, 'Server 2', { affordable: false }),
  add({ kind: 'saved', name: 'kHz web box 2' }, 3100, 'kHz web box 2'),
  add({ kind: 'saved', name: 'GPU render 1' }, 18_400, 'GPU render 1', { locked: researchLock('gpu', 'Needs GPU research') }),
]);

describe('configuration plate: barebones, copy and saved, with locked reasons and the total price', () => {
  it('splits quotes into the three rows in order', () => {
    const o = configOptions(quotes.quotes);
    expect(o.barebones.map((x) => x.label)).toEqual(['Hz', 'kHz', 'MHz', 'GHz']);
    expect(o.copies.map((x) => x.label)).toEqual(['Server 1', 'Server 2']);
    expect(o.saved.map((x) => x.label)).toEqual(['kHz web box 2', 'GPU render 1']);
  });

  it('prices every option in whole Credits; locked ones say Locked with a lock glyph', () => {
    m.render(<ConfigPlate kind="system" sub="Rack A · slot 8" quotes={quotes} onAction={onAction} onClose={onClose} />);
    expect(m.host.querySelector('.p-title')?.textContent).toBe('New server');
    const tiers = m.host.querySelectorAll('.tiers .cfg-opt');
    expect(Array.from(tiers).map((b) => b.textContent)).toEqual(['Hz40', 'kHz2,400', 'MHz Locked', 'GHz Locked']);
    expect(tiers[2].querySelector('svg.lock')).not.toBeNull();
    expect(m.host.querySelector('.copies .cfg-lab')?.textContent).toBe('Copy a server in this rack');
    expect(m.host.querySelectorAll('.copies .cfg-opt')).toHaveLength(2);
    expect(m.host.querySelector('.cfg-detail')?.textContent).toBe('Pick a starting point. Prices include every part.');
    expect(button(m.host, 'Add server').disabled).toBe(true);
  });

  it('a locked pick names the missing research and cannot be bought', () => {
    m.render(<ConfigPlate kind="system" quotes={quotes} onAction={onAction} onClose={onClose} />);
    click(button(m.host, 'GPU render 1'));
    expect(m.host.querySelector('.cfg-detail')?.textContent).toBe('“GPU render 1” · Needs GPU research');
    const buy = m.host.querySelector('.key.buy') as HTMLButtonElement;
    expect(buy.textContent).toBe('Locked');
    expect(buy.disabled).toBe(true);
  });

  it('buys the picked option with its total price, then closes', () => {
    m.render(<ConfigPlate kind="system" quotes={quotes} onAction={onAction} onClose={onClose} />);
    click(button(m.host, 'kHz2,400'));
    expect(m.host.querySelector('.cfg-detail')?.textContent).toBe('kHz barebones · kHz CPU at level 1, base cache. Nothing else.');
    const buy = button(m.host, 'Add server');
    expect(buy.textContent).toBe('Add server2,400');
    click(buy);
    expect(acts).toEqual([{ type: 'addUnit', parent, slot: 7, source: { kind: 'barebones', tier: 1 } }]);
    expect(onClose).toHaveBeenCalled();
  });

  it('says how many more Credits an unaffordable copy needs', () => {
    m.render(<ConfigPlate kind="system" credits={'1500' as Amount} quotes={quotes} onAction={onAction} onClose={onClose} />);
    click(button(m.host, 'Server 2'));
    expect(m.host.querySelector('.cfg-detail')?.textContent).toBe('Copy of Server 2 · 1,480 more Credits');
    expect(button(m.host, 'Add server').disabled).toBe(true);
    expect(shortfall('3000' as Amount, '5000' as Amount)).toBeNull();
  });

  it('empty rows keep their place with a hint; copies page by three', () => {
    m.render(<ConfigPlate kind="rack" quotes={result(quotes.quotes.slice(0, 2))} onAction={onAction} onClose={onClose} />);
    expect(m.host.querySelector('.copies .cfg-empty')?.textContent).toBe('No other racks yet');
    expect(m.host.querySelector('.saved .cfg-empty')?.textContent).toBe('Save a rack with its floppy icon to reuse it here');
    const many = result([0, 1, 2, 3, 4].map((i) => add({ kind: 'copy', from: { kind: 'system', id: systemId(i) } }, 100 + i, `Server ${i + 1}`)));
    m.render(<ConfigPlate kind="system" quotes={many} onAction={onAction} onClose={onClose} />);
    expect(m.host.querySelectorAll('.copies .cfg-opt.copy')).toHaveLength(3);
    click(button(m.host, 'More'));
    expect(Array.from(m.host.querySelectorAll('.copies .cfg-opt.copy .nm')).map((e) => e.textContent)).toEqual(['Server 4', 'Server 5']);
  });

  it('closes from its × key', () => {
    m.render(<ConfigPlate kind="room" quotes={quotes} onAction={onAction} onClose={onClose} />);
    expect(m.host.querySelector('.p-title')?.textContent).toBe('New zone');
    click(m.host.querySelector('.p-x'));
    expect(onClose).toHaveBeenCalled();
  });
});

describe('save-name prompt', () => {
  const unit = { kind: 'rack', id: rackId(0) } as const;
  it('suggests the next free name and saves the trimmed name', () => {
    expect(nextDefaultName('Rack A', ['Rack A 1', 'Rack A 2'])).toBe('Rack A 3');
    m.render(<SavePrompt unit={unit} defaultName="Rack A 3" onAction={onAction} onClose={onClose} />);
    const input = m.host.querySelector('input')!;
    expect(input.value).toBe('Rack A 3');
    expect(input.maxLength).toBe(24);
    expect(m.host.textContent).toContain('Shows only when you add a new rack.');
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    act(() => { setValue.call(input, '  Web rack  '); input.dispatchEvent(new Event('input', { bubbles: true })); });
    click(button(m.host, 'Save'));
    expect(acts).toEqual([{ type: 'saveConfig', unit, name: 'Web rack' }]);
    expect(onClose).toHaveBeenCalled();
  });
  it('cannot save an empty name, and warns before replacing a saved one', () => {
    m.render(<SavePrompt unit={unit} defaultName="   " onAction={onAction} onClose={onClose} />);
    expect(button(m.host, 'Save').disabled).toBe(true);
    m.render(<SavePrompt key="b" unit={unit} defaultName="Web rack" taken={['Web rack']} onAction={onAction} onClose={onClose} />);
    expect(button(m.host, 'Replace')).toBeTruthy();
    expect(m.host.textContent).toContain('Replaces the saved “Web rack”.');
  });
  it('is pinned to the top of the safe area', () => {
    m.render(<SavePrompt unit={unit} defaultName="A" bounds={{ x: 8, y: 146, w: 374, h: 500 }} onAction={onAction} onClose={onClose} />);
    expect((m.host.querySelector('form') as HTMLElement).style.top).toBe('150px');
  });
});

describe('plate routing', () => {
  const target = (over: Partial<HitTarget>): HitTarget => ({ id: 't', kind: 'part', owner: { level: 'rack', id: rackId(0) }, drill: null, part: null,
    unit: null, sw: null, port: null, slot: null, rect: { x: 0, y: 0, w: 1, h: 1 }, ...over });
  it('an empty rack slot asks for add quotes; infra parts ask infra; ports ask the switch', () => {
    const r = LEVEL_FIXTURES.rack;
    expect(plateRequest(target({ kind: 'slot', slot: 3 }), r)).toEqual({ kind: 'add', parent: { kind: 'rack', id: 0 }, slot: 3 });
    expect(plateRequest(target({ part: { unit: { kind: 'rack', id: rackId(0) }, slot: { kind: 'rackCooler' } } }), r))
      .toEqual({ kind: 'infra', unit: { kind: 'rack', id: 0 }, slot: 'cooling' });
    expect(plateRequest(target({ part: { unit: { kind: 'rack', id: rackId(0) }, slot: { kind: 'switch' } } }), r))
      .toEqual({ kind: 'switch', sw: { kind: 'rack', id: 0 } });
    expect(plateRequest(target({ kind: 'port', sw: { kind: 'rack', id: rackId(0) }, port: 2 }), r)).toEqual({ kind: 'switch', sw: { kind: 'rack', id: 0 } });
    const psu = { unit: { kind: 'system', id: systemId(0) }, slot: { kind: 'psu' } } as const;
    expect(plateRequest(target({ owner: { level: 'system', id: systemId(0) }, part: psu }), LEVEL_FIXTURES.system)).toEqual({ kind: 'part', part: psu });
  });
  it('slots add the right unit at each level', () => {
    expect(configKind('rack', { kind: 'rack', id: rackId(0) })).toBe('system');
    expect(configKind('room', { kind: 'room', id: 0 as never })).toBe('rack');
    expect(configKind('global', { kind: 'site', id: 0 as never })).toBe('room');
    expect(configKind('global', { kind: 'global' })).toBe('site');
    expect(configKind('chip', { kind: 'global' })).toBeNull();
  });
});
