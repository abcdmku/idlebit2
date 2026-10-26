import { describe, expect, it } from 'vitest';
import { createInitialState, quote, systemId, type Quote } from '../../game';
import { fixtureSnapshot } from '../../game/fixtures';
import type { HitTarget } from '../../render/core';
import { buildOffers, changeText } from '../deck/offers';
import { calloutModel } from './model';


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


});

describe('empty sites and phone placement (user bug, 25 Oct)', () => {
  const at = { level: 'chip', id: systemId(0) } as const;
  const site = (id: string): HitTarget => ({ id, kind: 'slot', owner: at, drill: null, part: null, unit: { kind: 'system', id: systemId(0) },
    sw: null, port: null, slot: 0, rect: { x: 0, y: 0, w: 8, h: 8 } });
  it('names an empty site by what it adds, and reads its deck row', async () => {
    const { slotSite } = await import('./model');
    const chip = fixtureSnapshot('chipBoot').focus, state = createInitialState(42);
    expect(slotSite(site('queue'), chip)).toEqual({ name: 'Add queue', row: 'scheduler' });
    const offers = buildOffers('chip', quote(state, { kind: 'tray', at }).quotes, null);
    const m = calloutModel(site('queue'), chip, null, offers);
    expect(m.name).toBe('Add queue');
    expect(m.offer).toBe(offers.rows.find(r => r.key === 'scheduler'));
  });
});
