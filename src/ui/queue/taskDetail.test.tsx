import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FAMILIES } from '../../game';
import { OffersScope } from '../deck/useOffers';
import { entry, fakeStore, mount, type Mounted } from '../hooks/testShell';
import { QueueStrip } from '../QueueStrip';
import { capableText, fixLabel, keepUnits, needLines, statusLine, TaskDetail, workLine } from './TaskDetail';

const NB = '\u00a0';

let mounted: Mounted | null = null;
beforeEach(() => { vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null); });
afterEach(() => { mounted?.unmount(); mounted = null; vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const $ = (sel: string) => mounted!.host.querySelector<HTMLElement>(sel);

describe('task detail words (user, 26 Oct)', () => {
  it('says the work and how its input lands, what it needs, and its status', () => {
    const t = { ...entry(1), work: 1000, transferS: 1, workingSetBits: 2048 };
    // every number keeps its unit (no break between "1" and "kHz")
    expect(workLine(t)).toBe(`1k${NB}ops · lands in 1.00${NB}s on 1${NB}kHz`);
    expect(keepUnits('needs 2 kb cache · 4 systems')).toBe(`needs 2${NB}kb cache · 4${NB}systems`);
    expect(needLines(t)[0]).toMatch(/^2\.05\u00a0kb working memory/);
    expect(needLines({ ...t, workingSetBits: 0 })).toEqual(['Nothing beyond a free CPU']);
    expect(needLines({ ...t, members: 4, minZones: 2 })).toEqual(expect.arrayContaining([`4${NB}systems at once (it splits into shards)`, `Systems in 2${NB}zones`]));
    expect(statusLine(t, true, true)).toEqual({ text: 'Ready', tone: '' });
    expect(statusLine({ ...t, committed: true }, true, true).text).toBe('Waiting for a free system');
    expect(statusLine({ ...t, blockedBy: 'cache' }, true, true)).toEqual({ text: `Blocked: needs 2.05${NB}kb cache`, tone: 'warn' });
    expect(statusLine(t, false, false).text).toBe('Starts after Return');
    expect([capableText(0), capableText(3)]).toEqual(['none of your systems can run it', '3 of your systems can run it']);
  });
});

describe('tapping a strip card opens its detail', () => {
  it('the head: name, pays Credits and Data, the pickup clock, and Dismiss at no SLA cost', () => {
    const store = fakeStore();
    store.set({ feed: { window: [{ ...entry(1), work: 1200 }, entry(2), entry(3)] } });
    mounted = mount(<><QueueStrip /><OffersScope><TaskDetail /></OffersScope></>, store, { width: 1440, height: 900 });
    act(() => $('.head-slot .tag')!.click());
    const plate = $('.task-detail')!;
    expect(plate.querySelector('.p-title')?.textContent).toBe(FAMILIES[0]!.name);
    expect($('[data-testid=td-status]')?.textContent).toBe('Ready');
    expect($('[data-testid=td-pays]')?.textContent).toContain('1,200');
    expect(plate.textContent).toContain('Pickup');
    expect(plate.textContent).not.toMatch(/#|task 1\b/i);
    act(() => $('[data-testid=td-dismiss]')!.click());
    expect(store.actions).toEqual([{ type: 'dismissTask', task: { epoch: 1, roundIndex: 1, taskId: 1 } }]);
    expect(mounted.shell.view.getState().task).toBeNull();
  });
  it('a later card has no pickup clock and no Dismiss', () => {
    const store = fakeStore();
    store.set({ feed: { window: [entry(1), entry(2), entry(3)] } });
    mounted = mount(<><QueueStrip /><OffersScope><TaskDetail /></OffersScope></>, store, { width: 390, height: 780 });
    act(() => mounted!.host.querySelectorAll<HTMLElement>('.slot .tag')[1]!.click());
    // right under the tapped card, pointing up at it (user, 26 Oct), on phone too
    expect($('.task-detail')?.getAttribute('data-tip')).toBe('up');
    expect($('.task-detail')!.textContent).not.toContain('Pickup');
    expect($('[data-testid=td-dismiss]')).toBeNull();
    expect($('[data-testid=td-status]')?.textContent).toBe('Ready when it reaches the front');
  });
});

describe('fix lines (user, 26 Oct)', () => {
  const o = (over: object) => ({ key: 'cache', icon: 'cache', name: 'Cache', slot: 'l1', change: '2 → 16 b', quote: { action: { type: 'upgradePart' } },
    price: 9, affordable: true, lock: null, where: false, right: { kind: 'price' }, ...over }) as never;
  it('buy the levels it needs, install a missing part, or research what locks it', () => {
    expect(fixLabel(o({}))).toBe('Buy Cache 2 → 16 b');
    expect(fixLabel(o({ name: 'Add RAM', change: '0 → 2 slots', quote: { action: { type: 'addPart' } } }))).toBe('Install RAM 0 → 2 slots');
    expect(fixLabel(o({ right: { kind: 'research', node: 'kHz fab' } }))).toBe('Research kHz fab');
  });
});
