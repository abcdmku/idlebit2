import { describe, expect, it } from 'vitest';
import { createInitialState, quote, rackId, systemId, type Quote } from '../../game';
import { fixtureSnapshot } from '../../game/fixtures';
import type { HitTarget } from '../../render/core';
import { buildOffers, changeText } from '../deck/offers';
import { calloutModel, placeCallout } from './model';

const bounds = { x: 48, y: 144, w: 1344, h: 504 };
describe('callout placement: beside the target, never over it', () => {
  it('right of it when there is room, level with it, on the lattice', () => {
    expect(placeCallout({ x: 600, y: 300, w: 96, h: 96 }, { w: 288, h: 96 }, bounds, 24)).toEqual({ x: 720, y: 312, w: 288, h: 96 });
  });
  it('left of it when the right is full', () => {
    expect(placeCallout({ x: 1200, y: 300, w: 96, h: 96 }, { w: 288, h: 96 }, bounds, 24)).toEqual({ x: 888, y: 312, w: 288, h: 96 });
  });
  it('above it, else below, when neither side has room (phone)', () => {
    const phone = { x: 16, y: 144, w: 352, h: 456 };
    expect(placeCallout({ x: 40, y: 400, w: 300, h: 80 }, { w: 200, h: 88 }, phone, 8)).toEqual({ x: 88, y: 304, w: 200, h: 88 });
    expect(placeCallout({ x: 40, y: 160, w: 300, h: 80 }, { w: 200, h: 88 }, phone, 8)).toEqual({ x: 88, y: 248, w: 200, h: 88 });
  });
});

const q = (cost: number, extra: Partial<Quote> = {}): Quote => ({ action: { type: 'returnToMarket' }, label: 'x', cost: String(cost) as never,
  currency: 'credits', affordable: true, locked: null, cold: false, downtimeMs: 0, effect: null, workOps: null, ...extra });
const eff = (a: number, b: number, unit: 'bits' | 'ops/s' | 'bit/s' | 'Hz') =>
  ({ capacityBefore: a, capacityAfter: b, unit, wattsBefore: 0, wattsAfter: 0, energyPerMinuteDelta: '0' as never, paybackS: null });

describe('offers: the deck words quotes, it never prices', () => {
  it('"x → x" with the unit once', () => {
    expect(changeText(eff(1, 2, 'bits'))).toBe('1 → 2 b');
    expect(changeText(eff(1, 2, 'Hz'))).toBe('1 → 2 Hz');
    expect(changeText(eff(500, 2000, 'bit/s'))).toBe('500 Hz → 2 kHz');
  });
  it('Buy is the cheapest affordable offer, else the cheapest priced one; locks name what they need', () => {
    const lock = { code: 'research' as const, node: 'dualCore' as never, text: 'Needs Dual core' };
    const tray = [q(6000, { locked: lock }), q(3, { effect: eff(1, 2, 'bits') }), q(2, { affordable: false }), q(9)];
    const pipe = q(0, { effect: eff(1000, 2000, 'bit/s'), locked: { code: 'research', node: 'rack' as never, text: 'Upgrade at the Rack switch' } });
    const o = buildOffers('chip', tray, pipe);
    expect(o.rows.map(r => [r.name, r.change, r.price, r.lock])).toEqual([
      ['Cores', 'x', null, 'Needs Dual core'], ['Cache', '1 → 2 b', 3, null], ['Clock', 'x', 2, null], ['Queue', 'x', 9, null],
      ['Pipe', '1 kHz', null, 'Upgrade at the Rack switch']]);
    expect(o.rows[4]!.where).toBe(true);
    expect([o.best, o.next?.name]).toEqual([1, 'Cache']);
    const poor = buildOffers('chip', tray.map(x => ({ ...x, affordable: false })), null);
    expect([poor.best, poor.next?.name]).toEqual([-1, 'Clock']);
  });
});

describe('callout quote effects', () => {
  const at = { level: 'chip', id: systemId(0) } as const;
  const target: HitTarget = { id: 'core0', kind: 'part', owner: at, drill: null,
    part: { unit: { kind: 'system', id: systemId(0) }, slot: { kind: 'core', socket: 0, index: 0 } },
    unit: null, sw: null, port: null, slot: null, rect: { x: 0, y: 0, w: 8, h: 8 } };

  it('an installed core reads its own upgrade; an empty core site offers the next core', () => {
    const state = createInitialState(42), focus = fixtureSnapshot('chipBoot').focus;
    const tray = quote(state, { kind: 'tray', at }).quotes;
    const offers = buildOffers('chip', tray, null);
    const own = calloutModel(target, focus, null, offers);
    expect([own.name, own.offer]).toEqual(['Core 1', offers.cores[0]]);
    expect(own.change).toBe(`More lanes: needs ${tray[4]!.locked!.text.replace(/^Needs /, '')}`);
    // Core 2 needs research: the callout names what you get, and its key opens the research (A07)
    const site = calloutModel({ ...target, part: { ...target.part!, slot: { kind: 'core', socket: 0, index: 1 } } }, focus, null, offers);
    expect([site.name, site.change, site.offer]).toEqual(['Add Core 2', `Needs research: ${tray[0]!.locked!.text.replace(/^Needs /, '')}`, offers.rows[0]]);
  });

  it.each(['l1', 'clock'] as const)('uses the same part effect and formatting as the %s tray row', kind => {
    const state = createInitialState(42), focus = fixtureSnapshot('chipBoot').focus;
    const part = { unit: { kind: 'system', id: systemId(0) }, slot: { kind, socket: 0 } } as const;
    const quotes = quote(state, { kind: 'part', part });
    const tray = quote(state, { kind: 'tray', at }).quotes;
    const row = buildOffers('chip', tray, null).rows[kind === 'l1' ? 1 : 2];
    const model = calloutModel({ ...target, part }, focus, quotes, null);
    expect(model.change).toContain('→');
    expect(model.change).toBe(row.change);
  });

  it('formats the switch port quote effect like the inbound deck row', () => {
    const state = createInitialState(42), focus = fixtureSnapshot('chipBoot').focus;
    const sw = { kind: 'rack', id: rackId(0) } as const;
    const quotes = quote(state, { kind: 'switch', sw });
    const link = quote(state, { kind: 'inbound', at }).quotes[0]!;
    const model = calloutModel({ ...target, kind: 'port', part: null, sw, port: 0 }, focus, quotes, null);
    expect(model.change).toContain('→');
    expect(model.change).toBe(changeText(link.effect!));
    expect(model.offer?.quote?.effect).toEqual(link.effect);
  });
});

describe('empty sites and phone placement (user bug, 25 Oct)', () => {
  const at = { level: 'chip', id: systemId(0) } as const;
  const site = (id: string): HitTarget => ({ id, kind: 'slot', owner: at, drill: null, part: null, unit: { kind: 'system', id: systemId(0) },
    sw: null, port: null, slot: 0, rect: { x: 0, y: 0, w: 8, h: 8 } });
  it('names an empty site by what it adds, and reads its deck row', async () => {
    const { slotSite } = await import('./model');
    const chip = fixtureSnapshot('chipBoot').focus, state = createInitialState(42);
    expect([slotSite(site('queue'), chip), slotSite(site('site1'), chip)]).toEqual([{ name: 'Add queue', row: 'scheduler' }, { name: 'Add Core 2', row: 'core' }]);
    const offers = buildOffers('chip', quote(state, { kind: 'tray', at }).quotes, null);
    const m = calloutModel(site('queue'), chip, null, offers);
    expect(m.name).toBe('Add queue');
    expect(m.offer).toBe(offers.rows.find(r => r.key === 'scheduler'));
  });
  it('phone: below the part when it fits, else above, else docked above the head card; the part stays clear', async () => {
    const { placePhone } = await import('./model');
    const bounds = { x: 16, y: 160, w: 352, h: 440 }, size = { w: 200, h: 104 };
    expect(placePhone({ x: 100, y: 200, w: 80, h: 40 }, size, bounds)).toEqual({ x: 40, y: 248, w: 200, h: 104 });
    expect(placePhone({ x: 100, y: 500, w: 80, h: 40 }, size, bounds)).toEqual({ x: 40, y: 384, w: 200, h: 104 });
    expect(placePhone({ x: 40, y: 200, w: 300, h: 380 }, size, bounds)).toEqual({ x: 16, y: 496, w: 352, h: 104 });
  });
});
