import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { amount } from '../game/amount';
import { FAMILIES, systemId, type PartRef } from '../game';
import { TASK_TYPES, typeColor, typeOf } from '../render/core';
import type { CanvasRenderer, HitTarget, Rect } from '../render/core';
import { Callout } from './callout/Callout';
import { Deck } from './deck/Deck';
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
    // the round number sits beside the clock (A16), with the 60–100% meter and its 80% tick (A12)
    expect(text('[data-testid=round]')).toBe('R1 · 0:38');
    // D28: before 10 resolved tasks the floor doesn't apply: the counts show, and "warming up" in the meter's place
    expect(text('[data-testid=sla-counts]')).toBe('0 / 0');
    expect(text('[data-testid=sla-warming]')).toBe('warming up');
    act(() => store.set({ hud: { credits: amount(5) } }));
    expect(text('[data-testid=credits]')).toBe('5');
  });
  it('once 10 tasks have resolved, the counts sit beside SLA with its meter and 80% tick (D28)', () => {
    const store = fakeStore();
    store.set({ hud: { sla: { met: 41, failed: 3, percent: 93.1, checking: true, window: 50, roundMet: 0, roundFailed: 0, deliveredWork: 0, failedWork: 0, grace: 0 } } });
    mounted = mount(<Hud />, store, DESKTOP);
    expect([text('[data-testid=sla]'), text('[data-testid=sla-counts]')]).toEqual(['93.1%', '41 / 44']);
    expect($('[data-testid=sla-warming]')).toBeNull();
    expect($('.hud-meter em')).not.toBeNull();
  });
  it.each([DESKTOP, { width: 390, height: 780 }])('End round asks once, then ends the round; it waits out a round break ($width px)', size => {
    vi.useFakeTimers();
    const store = fakeStore();
    mounted = mount(<Hud />, store, size);
    const key = () => $('[data-testid=end-round]') as HTMLButtonElement;
    const at = rectOf('[data-testid=end-round]');
    expect(key().textContent).toBe('End round');
    act(() => key().click());
    expect(key().textContent).toBe('End round?Tap again');
    expect(rectOf('[data-testid=end-round]')).toBe(at);
    act(() => { vi.advanceTimersByTime(3000); });
    expect(key().textContent).toBe('End round');
    expect(store.actions).toEqual([]);
    act(() => key().click());
    act(() => key().click());
    expect(store.actions).toEqual([{ type: 'endRound' }]);
    act(() => store.set({ round: { state: 'between' } }));
    expect(key().disabled).toBe(true);
    vi.useRealTimers();
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

describe('queue strip (D10, D17.1): five cards, the head first, updated in place', () => {
  const headTag = () => $('.head-slot .tag');
  const cards = () => [...mounted!.host.querySelectorAll<HTMLElement>('.slot .tag')];
  it.each([{ width: 1440, height: 900, n: 3 }, { width: 390, height: 780, n: 2 }])
    ('keeps type accents and rims through family changes and blocking at $width px', size => {
      const store = fakeStore();
      mounted = mount(<QueueStrip />, store, size);
      const fixed = ['.head-slot', '.slots'];
      const geometry = fixed.map(rectOf);
      for (const type of TASK_TYPES) {
        const family = FAMILIES.find(f => typeOf(f.id) === type)!.id;
        act(() => store.set({ feed: { window: [entry(1, family), entry(2, family)] } }));
        for (const tag of [headTag()!, cards()[0]!]) {
          const stripe = tag.querySelector<HTMLElement>('.task-accent')!;
          expect(tag.style.getPropertyValue('--task-color')).toBe(typeColor(type));
          expect(stripe.style.width).toBe(`${size.n}px`);
          expect(tag.style.color).toBe('');
        }
        expect($('.head-slot')!.style.getPropertyValue('--rim')).toBe(typeColor(type));
        act(() => store.set({ feed: { window: store.getSnapshot().feed.window.map(t => ({ ...t, blockedBy: 'cache' })) } }));
        for (const el of [$('.head-slot')!, headTag()!, cards()[0]!]) expect(el.classList.contains('blocked')).toBe(true);
        expect(fixed.map(rectOf)).toEqual(geometry);
      }
      act(() => store.set({ feed: { window: [] } }));
      expect(mounted.host.querySelectorAll('.task-accent')).toHaveLength(0);
    });
  it('marks the head by its state: its seconds, blocked, or after Return; the next 4 read payout', () => {
    const store = fakeStore();
    mounted = mount(<QueueStrip />, store, DESKTOP);
    expect(headTag()!.textContent).toContain('Bit Flip');
    expect(text('[data-testid=strip-state]')).toBe('10 s');
    mounted.frame(3000);
    expect(text('[data-testid=strip-state]')).toBe('7 s');
    expect($('.head-slot .rim-fill')!.style.width).toBe(`${Math.round((336 / 3 - 2) * 0.7) * 3}px`);
    expect(cards().map(c => c.dataset.task)).toEqual(['1:1:2', '1:1:3', '1:1:4', '1:1:5']);
    expect(cards()[0]!.textContent).toContain('+1');
    act(() => store.set({ feed: { window: store.getSnapshot().feed.window.map((t, i) => (i ? t : { ...t, blockedBy: 'cache' })) } }));
    expect(text('[data-testid=strip-state]')).toBe('blocked');
    act(() => store.set({ round: { state: 'between' }, feed: { timing: 'onReturn', headDeadlineTick: null } }));
    expect(headTag()!.textContent).toContain('next');
    expect(mounted.host.querySelectorAll('.blocked')).toHaveLength(0);
  });
  it('updates in place: a taken head just leaves its slot, nothing slides (user, 25 Oct)', () => {
    const store = fakeStore();
    mounted = mount(<QueueStrip />, store, DESKTOP);
    act(() => store.set({ feed: { window: [2, 3, 4, 5, 6].map(i => entry(i)), taken: 1 } }));
    expect(headTag()!.dataset.task).toBe('1:1:2');
    expect(mounted.host.querySelectorAll('.tag')).toHaveLength(5);
    expect(cards().map(c => c.dataset.task)).toEqual(['1:1:3', '1:1:4', '1:1:5', '1:1:6']);
  });
});

describe('head card (user, 25 Oct: the main task below, above the deck)', () => {
  const card = (store: FakeStore, size = DESKTOP) => mount(<OffersScope><Deck /></OffersScope>, store, size);
  it('reads the head with its values and real 10 s clock; Dismiss is free and dismisses it', () => {
    const store = fakeStore();
    mounted = card(store);
    expect(text('[data-testid=now]')).toContain('Bit Flip');
    expect(text('[data-testid=now]')).toContain('1 op · 1 b');
    expect(text('[data-testid=now]')).not.toContain('#');
    expect(text('[data-testid=head-clock]')).toBe('10 s to take');
    mounted.frame(3000);
    expect(text('[data-testid=head-clock]')).toBe('7 s to take');
    act(() => $('[data-testid=dismiss]')!.click());
    expect(store.actions).toEqual([{ type: 'dismissTask', task: store.getSnapshot().feed.window[0]!.task }]);
  });
  it('a blocked head says what it needs; returned work has no clock, is never "in LB queue" before Rack, and cannot be dismissed', () => {
    const store = fakeStore(), feed = store.getSnapshot().feed;
    store.set({ feed: { window: [{ ...entry(20, 0, true), workingSetBits: 2, blockedBy: 'cache' }, ...feed.window.slice(1)] } });
    mounted = card(store);
    expect(text('[data-testid=now]')).toContain('Needs 2 b cache');
    expect(text('[data-testid=head-clock]')).toBe('Taken · waiting for the CPU');
    expect(($('[data-testid=dismiss]') as HTMLButtonElement).disabled).toBe(true);
  });
  it('between rounds the same key reads Return, in the same place', () => {
    const store = fakeStore();
    mounted = card(store);
    expect(rectOf('[data-testid=dismiss]')).toBe('504px 24px 144px 48px');
    act(() => store.set({ round: { state: 'between', canReturn: true }, feed: { timing: 'onReturn', headDeadlineTick: null } }));
    expect($('[data-testid=dismiss]')).toBeNull();
    expect(rectOf('[data-testid=return]')).toBe('504px 24px 144px 48px');
    expect(text('[data-testid=now]')).toContain('Starts after Return');
    expect(text('[data-testid=return]')).toBe('Return to market');
    act(() => $('[data-testid=return]')!.click());
    expect(store.actions).toEqual([{ type: 'returnToMarket' }]);
  });
});

function deck(store: FakeStore, size = DESKTOP) {
  return mount(<OffersScope><Deck /></OffersScope>, store, size);
}

describe('deck', () => {
  it('controls never move: the head card over Buy, the build rows over Research', () => {
    const store = fakeStore();
    mounted = deck(store);
    const keys = ['[data-testid=now]', '[data-testid=buy]', '[data-testid=build-rows]', '[data-testid=research-key]'];
    const before = keys.map(rectOf);
    expect(before).toEqual(['24px 696px 672px 120px', '24px 816px 672px 48px', '720px 696px 696px 120px', '720px 816px 696px 48px']);
    act(() => store.set({ round: { state: 'between', canReturn: true }, feed: { timing: 'onReturn', headDeadlineTick: null } }));
    expect(keys.map(rectOf)).toEqual(before);
    act(() => store.set({ research: { active: 'fabKhz' as never, name: 'kHz fab', progress: 0.5, opsPerSec: 1200, queued: 2 } }));
    expect(keys.map(rectOf)).toEqual(before);
    mounted.unmount();
    mounted = deck(store);
    expect(text('[data-testid=research-key]')).toBe('Research · kHz fab running · 1.2k ops/s · 2 queued50%');
  });
  it('the Buy key says it is saving up, with no ETA before the round has an income', () => {
    const store = fakeStore();
    mounted = deck(store);
    expect(text('[data-testid=buy]')).toMatch(/· Saving up · —/);
  });
  it('with a round income, the Buy key says how long the saving takes', () => {
    const store = fakeStore();
    store.set({ hud: { income: { dataPerSec: 0, creditsPerSec: 0.001 } } });
    mounted = deck(store);
    expect(text('[data-testid=buy]')).toMatch(/· Saving up · ~\d+ (min|h)/);
  });
  it('builds five rows from the sim quotes: x → x, prices, and where the pipe upgrades', () => {
    const store = fakeStore();
    mounted = deck(store);
    const rows = [...mounted.host.querySelectorAll<HTMLElement>('[data-row]')];
    expect(rows.map(r => r.dataset.row)).toEqual(['core', 'cache', 'clock', 'scheduler', 'link']);
    expect(rows[4]!.textContent).toContain('At the Rack switch');
    expect(rows[2]!.textContent).toMatch(/1 → [0-9.]+ Hz/);
    expect(rows[1]!.textContent).toMatch(/1 → 2 b/);
  });
  it('phone: the head card spans the width above Build · Research · Buy; Build opens a sheet', () => {
    const store = fakeStore();
    mounted = deck(store, { width: 390, height: 780 });
    expect([rectOf('[data-testid=now]'), rectOf('[data-testid=build-key]'), rectOf('[data-testid=research-key]'), rectOf('[data-testid=buy]')])
      .toEqual(['8px 616px 368px 80px', '8px 704px 80px 64px', '96px 704px 112px 64px', '216px 704px 160px 64px']);
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
    expect(c.textContent).toMatch(/1 → [0-9.]+ Hz/);
    // docked in the right gutter, level with the part, with a leader to it (A07)
    expect([c.style.left, c.style.top, c.style.width, c.style.height]).toEqual(['1104px', '304px', '288px', '144px']);
    expect($('.leader')!.style.left).toBe('696px');
    expect($('[data-testid=callout-buy]')!.style.height).toBe('48px');
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
    store.set({ round: { state: 'ended', lastReport: report(), canReturn: true }, hud: { sla: { met: 28_400, failed: 7129, percent: 79.9, checking: true, window: 50, roundMet: 28_400, roundFailed: 7129, deliveredWork: 28_400, failedWork: 7_129, grace: 10 } } });
    mounted = mount(<RoundPlate />, store);
    expect(text('.p-sub')).toBe('Round 14 · 14:05 · SLA under 80%');
    expect(text('.rp-v')).toBe('79.9%');
    expect(text('[data-testid=rp-failed]')).toBe('7,129');
    // D28: the round's own counts; dismissed shows here and nowhere else
    expect([text('[data-testid=rp-met]'), text('[data-testid=rp-dismissed]')]).toEqual(['28.4k', '0']);
    expect(text('[data-testid=rp-detail]')).toBe("Can't run · RAM ×387");
    // no footnote, no type table, no peak intensity (A02, A26); energy and net are listed
    expect(text('[data-testid=round-plate]')).not.toMatch(/rejoins|Peak|Met work/);
    expect(text('[data-testid=rp-net]')).toContain('2.71M');
    expect(text('[data-testid=rp-fix]')).toContain('Fix: —');
    act(() => ($('[data-testid=rp-return]') as HTMLButtonElement).click());
    expect(store.actions).toEqual([{ type: 'returnToMarket' }]);
  });
  it('closing dismisses the report; it does not show while running', () => {
    const store = fakeStore();
    store.set({ round: { state: 'ended', lastReport: report(), canReturn: true } });
    mounted = mount(<RoundPlate />, store);
    act(() => ($('.round-plate .p-x') as HTMLButtonElement).click());
    expect(store.actions).toEqual([{ type: 'dismissReport' }]);
    act(() => store.set({ round: { state: 'running' } }));
    expect($('[data-testid=round-plate]')).toBeNull();
  });
});

describe('round plate fix line (A02)', () => {
  it('names the build that answers the top failure, from the deck\'s own offers', () => {
    const store = fakeStore();
    store.set({ round: { state: 'ended', canReturn: true, lastReport: report({ details: [{ cause: 'cantRun', detail: 'cache', count: 2 }],
      byType: [{ type: 'compute' as never, metWork: 41, failedWork: 18, dismissed: 0 }] }) } });
    mounted = mount(<OffersScope><RoundPlate /></OffersScope>, store, DESKTOP);
    expect(text('[data-testid=rp-detail]')).toBe("Can't run · cache ×2");
    expect(text('[data-testid=rp-fix]')).toMatch(/Cache\s*1 → 2 b/);
    expect(text('[data-testid=rp-types]')).toBe('Failed:Compute 18 ops');
  });
});

describe('round plate with no detail pairs (D26)', () => {
  it('names the top cause, the disk share, and still offers a fix', () => {
    const store = fakeStore();
    store.set({ round: { state: 'ended', canReturn: true, lastReport: report({ details: [], deliveredWork: 100,
      failedByCause: { timeout: 5, cantRun: 0, misroute: 0, power: 0, heat: 0, swap: 0, late: 0 }, spill: { ramWork: 4, diskWork: 74 } }) } });
    mounted = mount(<OffersScope><RoundPlate /></OffersScope>, store, DESKTOP);
    expect(text('[data-testid=rp-detail]')).toBe('Timed out ×5');
    expect(text('[data-testid=rp-spill]')).toBe('From disk: 74% of work · RAM 4%');
    // no RAM row at the CPU level: the next answer to slowness is the clock
    expect(text('[data-testid=rp-fix]')).toMatch(/Clock/);
  });
});

describe('research cuts the line (D27)', () => {
  const research = (running: boolean) => ({ kind: 'research' as const, key: -3, project: 'pipelining' as never, name: 'Pipelining', work: 3000,
    progress: running ? 0.42 : 0, running, holders: running ? 1 : 0, threads: running ? 1 : 0, opsPerSec: running ? 1200 : 0 });
  it('waiting at the front: the strip and the head card show it, with no clock and no Dismiss; the market waits behind', () => {
    const store = fakeStore();
    store.set({ feed: { research: research(false), headDeadlineTick: null } });
    mounted = mount(<><QueueStrip /><OffersScope><Deck /></OffersScope></>, store, DESKTOP);
    expect(text('[data-testid=research-head]')).toBe('Pipelining 3k ops · next');
    expect(text('[data-testid=now]')).toContain('Pipelining 3k ops');
    const cards = [...mounted.host.querySelectorAll<HTMLElement>('.slot .tag')];
    expect(cards[0]!.dataset.task).toBe('1:1:1');
    // the card says the market waits when the line fits whole; at 1440 it keeps the name and payout
    expect(cards[0]!.textContent).toBe('Bit Flip +1');
    expect(text('[data-testid=now]')).toContain('Next in line · runs on free threads');
    expect($('[data-testid=dismiss]')).toBeNull();
    expect(text('[data-testid=research-key]')).toContain('next in line');
  });
  it('once taken it leaves the strip; the tile shows it running', () => {
    const store = fakeStore();
    store.set({ feed: { research: research(true) } });
    mounted = mount(<><QueueStrip /><OffersScope><Deck /></OffersScope></>, store, DESKTOP);
    expect($('[data-testid=research-head]')).toBeNull();
    expect($('.head-slot .tag')!.dataset.task).toBe('1:1:1');
    expect(text('[data-testid=research-key]')).toBe('Research · Pipelining running · 1.2k ops/s42%');
  });
  it('phone: the Research tile reads two clean lines in every state', () => {
    const store = fakeStore();
    store.set({ feed: { research: research(true) } });
    mounted = mount(<OffersScope><Deck /></OffersScope>, store, { width: 390, height: 780 });
    const lines = () => [...$('[data-testid=research-key]')!.querySelectorAll('.t')].map(e => e.textContent);
    expect(lines()).toEqual(['Research', 'Running 42%']);
    act(() => store.set({ feed: { research: research(false) } }));
    expect(lines()).toEqual(['Research', 'Next in line']);
  });
  it('phone: a project stopped for Credits says so on both lines', () => {
    const store = fakeStore();
    store.set({ feed: { research: research(true) }, research: { stoppedInsolvent: true } });
    mounted = mount(<OffersScope><Deck /></OffersScope>, store, { width: 390, height: 780 });
    expect([...$('[data-testid=research-key]')!.querySelectorAll('.t')].map(e => e.textContent)).toEqual(['Stopped', 'no Credits']);
  });
});

describe('a restarting system says so (user, 25 Oct)', () => {
  it('the head card and the world line read Restarting; returned work waits for the CPU', async () => {
    const { PlatformLine } = await import('./shell/PlatformLine');
    const store = fakeStore(), s = store.getSnapshot();
    store.set({ focus: { ...s.focus, online: 'cold' } as never });
    mounted = mount(<><PlatformLine /><OffersScope><Deck /></OffersScope></>, store, DESKTOP);
    expect(text('[data-testid=now-restart]')).toBe('Restarting');
    expect(text('[data-testid=platform-line]')).toBe('Restarting');
    act(() => store.set({ feed: { window: [{ ...entry(20, 0, true) }, ...s.feed.window.slice(1)] } }));
    expect(text('[data-testid=head-clock]')).toBe('Waiting · CPU restarting');
  });
});
