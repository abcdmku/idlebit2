import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { amount } from '../game/amount';
import { FAMILIES, systemId, type PartRef } from '../game';
import { TASK_TYPES, typeColor, typeOf } from '../render/core';
import type { CanvasRenderer, HitTarget, Rect } from '../render/core';
import { Callout } from './callout/Callout';
import { Deck } from './deck/Deck';
import { NowCard } from './deck/NowCard';
import { OffersScope } from './deck/useOffers';
import { entry, fakeStore, mount, report, type FakeStore, type Mounted } from './hooks/testShell';
import { Hud } from './Hud';
import { QueueStrip } from './QueueStrip';
import { RoundPlate } from './RoundPlate';

let mounted: Mounted | null = null;
beforeEach(() => { vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null); });
afterEach(() => { mounted?.unmount(); mounted = null; vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const $ = (sel: string) => mounted!.host.querySelector<HTMLElement>(sel);
const text = (sel: string) => $(sel)?.textContent;
const rectOf = (sel: string) => { const s = $(sel)!.style; return [s.left, s.top, s.width, s.height].join(' '); };
const DESKTOP = { width: 1440, height: 900 };

describe('band', () => {
  it('shows whole Credits and Data, SLA and the round clock', () => {
    const store = fakeStore();
    store.set({ hud: { credits: amount(1_480_000), data: amount(41_200), roundElapsedMs: 38_400 } });
    mounted = mount(<Hud />, store, DESKTOP);
    expect([text('[data-testid=credits]'), text('[data-testid=data]'), text('[data-testid=sla]')]).toEqual(['1.48M', '41.2k', '100.0%']);
    expect(text('[data-testid=sla-gauge]')).toContain('0:38');
    act(() => store.set({ hud: { credits: amount(5) } }));
    expect(text('[data-testid=credits]')).toBe('5');
  });
  it('keeps all five rungs in place; a locked rung opens research', () => {
    mounted = mount(<Hud />, fakeStore(), DESKTOP);
    const rungs = [...mounted.host.querySelectorAll<HTMLButtonElement>('.rung')];
    expect(rungs.map(r => [r.dataset.level, r.classList.contains('locked'), r.style.left])).toEqual([
      ['chip', false, '48px'], ['system', true, '96px'], ['rack', true, '144px'], ['room', true, '192px'], ['global', true, '240px']]);
    act(() => rungs[1]!.click());
    expect(mounted.shell.view.getState().sheet).toBe('research');
  });
});

describe('queue strip (D10, D17.1)', () => {
  it.each([{ width: 1440, height: 900, n: 3 }, { width: 390, height: 780, n: 2 }])
    ('keeps type accents and rims through family changes and blocking at $width px', size => {
      const store = fakeStore();
      mounted = mount(<><QueueStrip /><NowCard /></>, store, size);
      const geometry = ['.head-slot', '.card', '.now'].map(rectOf);
      for (const type of TASK_TYPES) {
        const family = FAMILIES.find(f => typeOf(f.id) === type)!.id;
        act(() => store.set({ feed: { window: [entry(1, family), entry(2, family)] } }));
        for (const selector of ['.head-slot', '.card', '.now']) {
          const card = $(selector)!, stripe = card.querySelector<HTMLElement>('.task-accent')!;
          expect(card.style.getPropertyValue('--task-color')).toBe(typeColor(type));
          expect(stripe.style.width).toBe(`${size.n}px`);
          expect([stripe.style.left, stripe.style.top, stripe.style.bottom]).toEqual(['0px', '0px', '0px']);
          expect(card.style.color).toBe('');
        }
        expect($('.head-slot')!.style.getPropertyValue('--rim')).toBe(typeColor(type));
        expect($('.now')!.style.getPropertyValue('--rim')).toBe(typeColor(type));
        act(() => store.set({ feed: { window: store.getSnapshot().feed.window.map(t => ({ ...t, blockedBy: 'cache' })) } }));
        for (const selector of ['.head-slot', '.card', '.now']) {
          expect($(selector)!.classList.contains('blocked')).toBe(true);
          expect($(selector)!.style.getPropertyValue('--task-color')).toBe(typeColor(type));
        }
        expect($('.now')!.style.getPropertyValue('--rim')).toBe(typeColor(type));
        expect(['.head-slot', '.card', '.now'].map(rectOf)).toEqual(geometry);
      }
      expect(mounted.host.querySelectorAll('.card .task-accent')).toHaveLength(1);
      act(() => store.set({ feed: { window: [] } }));
      expect(mounted.host.querySelectorAll('.task-accent')).toHaveLength(0);
      expect($('.head-slot')!.style.getPropertyValue('--rim')).toBe('');
      expect($('.now')!.style.getPropertyValue('--rim')).toBe('');
    });
  it('leads with the head and its real 10 s clock, then the next 4', () => {
    const store = fakeStore();
    mounted = mount(<QueueStrip />, store, { width: 390, height: 780 });
    // a task reads as its icon and name: no task numbers (user)
    expect(text('[data-testid=head-slot]')).toContain('Bit Flip');
    expect(text('[data-testid=head-slot]')).not.toContain('#');
    expect(text('[data-testid=head-clock]')).toBe('10 s');
    mounted.frame(3000);
    expect(text('[data-testid=head-clock]')).toBe('7 s');
    mounted.unmount();
    // desktop: the rim is the head's clock; the cards read name, payout and pipe time
    mounted = mount(<QueueStrip />, store, DESKTOP);
    expect($('.head-slot .rim-fill')!.style.width).toBe(`${(240 / 3 - 2) * 3}px`);
    mounted.frame(5000);
    expect($('.head-slot .rim-fill')!.style.width).toBe(`${39 * 3}px`);
    const cards = [...mounted.host.querySelectorAll<HTMLElement>('.card')];
    expect(cards).toHaveLength(4);
    expect(cards[0]!.dataset.task).toBe('1:1:2');
    expect(cards[0]!.textContent).toContain('+1');
    expect(cards[0]!.textContent).toContain('1 ms');
  });
  it('marks a blocked head and pauses the clock between rounds', () => {
    const store = fakeStore(), feed = store.getSnapshot().feed;
    store.set({ feed: { window: [{ ...entry(20), workingSetBits: 2, blockedBy: 'cache' }, ...feed.window.slice(1)], blockedBy: 'cache' } });
    mounted = mount(<QueueStrip />, store, { width: 390, height: 780 });
    expect($('[data-testid=head-slot]')!.classList.contains('blocked')).toBe(true);
    expect(text('[data-testid=head-clock]')).toBe('blocked');
    act(() => store.set({ feed: { timing: 'onReturn', headDeadlineTick: null } }));
    expect(text('[data-testid=head-clock]')).toBe('paused');
  });
});

function deck(store: FakeStore, size = DESKTOP) {
  return mount(<OffersScope><Deck /></OffersScope>, store, size);
}

describe('deck', () => {
  it('the now card repeats the head; Dismiss is free and dismisses the head', () => {
    const store = fakeStore();
    mounted = deck(store);
    expect(text('[data-testid=now]')).toContain('Bit Flip');
    expect(text('[data-testid=now]')).not.toContain('#');
    expect(text('[data-testid=now-clock]')).toBe('10 s to take');
    act(() => $('[data-testid=dismiss]')!.click());
    expect(store.actions).toEqual([{ type: 'dismissTask', task: store.getSnapshot().feed.window[0]!.task }]);
  });
  it('a blocked head says what it needs; returned work cannot be dismissed', () => {
    const store = fakeStore(), feed = store.getSnapshot().feed;
    store.set({ feed: { window: [{ ...entry(20, 0, true), workingSetBits: 2, blockedBy: 'cache' }, ...feed.window.slice(1)] } });
    mounted = deck(store);
    expect(text('[data-testid=now]')).toContain('Needs 2 bits cache');
    expect(text('[data-testid=now-clock]')).toBe('Blocked · 10 s');
    expect(($('[data-testid=dismiss]') as HTMLButtonElement).disabled).toBe(true);
  });
  it('between rounds the same key returns to market', () => {
    const store = fakeStore();
    store.set({ round: { state: 'between', canReturn: true }, feed: { timing: 'onReturn', headDeadlineTick: null } });
    mounted = deck(store);
    expect($('[data-testid=dismiss]')).toBeNull();
    act(() => $('[data-testid=return]')!.click());
    expect(store.actions).toEqual([{ type: 'returnToMarket' }]);
  });
  it('controls never move: the deck keeps its geometry across states', () => {
    const store = fakeStore();
    mounted = deck(store);
    const keys = ['[data-testid=now]', '[data-testid=buy]', '[data-testid=build-rows]', '[data-testid=research-key]'];
    const before = keys.map(rectOf), dismiss = rectOf('[data-testid=dismiss]');
    expect(dismiss).toBe('576px 24px 96px 48px');
    act(() => store.set({ round: { state: 'between', canReturn: true }, feed: { timing: 'onReturn', headDeadlineTick: null } }));
    expect(keys.map(rectOf)).toEqual(before);
    expect(rectOf('[data-testid=return]')).toBe(dismiss);
    act(() => store.set({ research: { active: 'fabKhz' as never, name: 'kHz fab', progress: 0.5 } }));
    expect(keys.map(rectOf)).toEqual(before);
  });
  it('builds five rows from the sim quotes: x → x, prices, and where the pipe upgrades', () => {
    const store = fakeStore();
    mounted = deck(store);
    const rows = [...mounted.host.querySelectorAll<HTMLElement>('[data-row]')];
    expect(rows.map(r => r.dataset.row)).toEqual(['core', 'cache', 'clock', 'scheduler', 'link']);
    expect(rows[4]!.textContent).toContain('Upgrade at the Rack switch');
    expect(rows[2]!.textContent).toMatch(/1 → 2 Hz/);
    expect(rows[1]!.textContent).toMatch(/1 → 2 bits/);
  });
  it('phone: Dismiss, Research and Buy sit in the bottom-right thumb zone; Build opens a sheet', () => {
    const store = fakeStore();
    mounted = deck(store, { width: 390, height: 780 });
    expect([rectOf('[data-testid=build-key]'), rectOf('[data-testid=research-key]'), rectOf('[data-testid=buy]')])
      .toEqual(['8px 704px 80px 64px', '96px 704px 112px 64px', '216px 704px 160px 64px']);
    expect(rectOf('[data-testid=dismiss]')).toBe('256px 16px 96px 48px');
    act(() => $('[data-testid=build-key]')!.click());
    expect($('[data-testid=build-sheet]')).not.toBeNull();
  });
});

describe('upgrade callout (D15.4)', () => {
  const clock: PartRef = { unit: { kind: 'system', id: systemId(0) }, slot: { kind: 'clock', socket: 0 } };
  const target = (over: Partial<HitTarget> = {}): HitTarget => ({ id: 'clock', kind: 'part', owner: { level: 'chip', id: systemId(0) }, drill: null,
    part: clock, unit: null, sw: null, port: null, slot: null, rect: { x: 0, y: 0, w: 10, h: 10 }, ...over });
  /** A renderer whose targets all sit at `at`; `only` limits it to one id. */
  function withRenderer(m: Mounted, at: Rect, only?: string) {
    m.shell.surface.renderer = { transition: null,
      anchor: (id: string, out: Rect) => { if (only && id !== only) return false; Object.assign(out, at); return true; } } as unknown as CanvasRenderer;
  }
  it('opens beside the tapped part with x → x, price and Buy, and closes on cancel', () => {
    const store = fakeStore();
    mounted = mount(<OffersScope><Callout /></OffersScope>, store, DESKTOP);
    withRenderer(mounted, { x: 600, y: 300, w: 96, h: 96 });
    act(() => mounted!.shell.view.dispatch({ type: 'select', target: target() }));
    const c = $('[data-testid=callout]')!;
    expect(c.textContent).toContain('Clock');
    expect(c.textContent).toMatch(/1 → 2 Hz/);
    // beside the package, never over it (the package edge is 19 art px out from the cache), on the lattice
    expect([c.style.left, c.style.top, c.style.width, c.style.height]).toEqual(['792px', '312px', '288px', '96px']);
    act(() => mounted!.shell.view.dispatch({ type: 'cancel' }));
    expect($('[data-testid=callout]')).toBeNull();
  });
  it('phone keys are at least 44 px tall', () => {
    mounted = mount(<OffersScope><Callout /></OffersScope>, fakeStore());
    withRenderer(mounted, { x: 160, y: 400, w: 48, h: 48 });
    act(() => mounted!.shell.view.dispatch({ type: 'select', target: target() }));
    expect($('[data-testid=callout]')!.style.height).toBe('104px');
    expect($('[data-testid=callout-buy]')!.style.height).toBe('48px');
  });
  it('a unit offers Open, which drills in; More opens the full plate instead', () => {
    const store = fakeStore();
    store.set({ unlocked: { chip: true, system: true, rack: false, room: false, global: false } });
    mounted = mount(<OffersScope><Callout /></OffersScope>, store, DESKTOP);
    withRenderer(mounted, { x: 1200, y: 300, w: 96, h: 96 }, 'sys0');
    const sys = { level: 'system', id: systemId(0) } as const;
    act(() => mounted!.shell.view.dispatch({ type: 'select', target: target({ id: 'sys0', kind: 'child', part: null, drill: sys }) }));
    const c = $('[data-testid=callout]')!;
    expect(c.style.left).toBe('888px');   // no room on the right: it sits left of the unit
    expect(c.textContent).toContain('System 1');
    act(() => $('[data-testid=callout-open]')!.click());
    expect(mounted.shell.view.getState().focus).toEqual(sys);
  });
});

describe('round plate', () => {
  it('reports the round and offers one Return to market', () => {
    const store = fakeStore();
    store.set({ round: { state: 'ended', lastReport: report(), canReturn: true }, hud: { sla: { met: 28_400, failed: 7129, percent: 79.9, deliveredWork: 28_400, failedWork: 7_129, grace: 10 } } });
    mounted = mount(<RoundPlate />, store);
    expect(text('.p-sub')).toBe('Round 14 · 14:05');
    expect(text('.rp-v')).toBe('79.9%');
    expect(text('[data-testid=rp-failed]')).toBe('7,129');
    expect(text('[data-testid=rp-detail]')).toBe("Can't run · RAM 387");
    act(() => ($('[data-testid=rp-return]') as HTMLButtonElement).click());
    expect(store.actions).toEqual([{ type: 'returnToMarket' }]);
  });
  it('closing dismisses the report; it does not show while running', () => {
    const store = fakeStore();
    store.set({ round: { state: 'ended', lastReport: report(), canReturn: true } });
    mounted = mount(<RoundPlate />, store);
    act(() => ($('.rp-x') as HTMLButtonElement).click());
    expect(store.actions).toEqual([{ type: 'dismissReport' }]);
    act(() => store.set({ round: { state: 'running' } }));
    expect($('[data-testid=round-plate]')).toBeNull();
  });
});
