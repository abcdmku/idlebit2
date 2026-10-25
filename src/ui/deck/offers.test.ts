import { describe, expect, it } from 'vitest';
import { createInitialState, quote, rackId, roomId, systemId, type EffectPreview, type NodeRef, type Quote } from '../../game';
import { actionable, buildOffers, changeText, EXTRA_ROWS, extraOffer, extraRequest, linkRequest } from './offers';

const nodes: readonly NodeRef[] = [
  { level: 'chip', id: systemId(0) }, { level: 'system', id: systemId(0) },
  { level: 'rack', id: rackId(0) }, { level: 'room', id: roomId(0) }, { level: 'global', id: 0 },
];
const effect = (unit: EffectPreview['unit'], before = 1, after = 2): EffectPreview => ({
  capacityBefore: before, capacityAfter: after, unit, wattsBefore: 0, wattsAfter: 0,
  energyPerMinuteDelta: '0' as never, paybackS: null,
});
const offer = (preview: EffectPreview): Quote => ({
  action: { type: 'returnToMarket' }, label: 'Quote label', cost: '12' as never, currency: 'credits',
  affordable: true, locked: null, cold: false, downtimeMs: 0, effect: preview, workOps: null,
});

describe('deck quote contracts R42/R43', () => {
  it.each(nodes)('requests the inbound quote at $level', at => {
    expect(linkRequest(at)).toEqual({ kind: 'inbound', at });
    const link = offer(effect('bit/s', 1000, 2000));
    const row = buildOffers(at.level, null, link).rows[4];
    expect(row.change).toBe('1 → 2 kHz');
    expect(row.quote).toBe(link);
    expect(row.price).toBe(12);
  });

  it.each(nodes.slice(0, 4))('shows the sim-owned location lock at $level', at => {
    const state = createInitialState(42);
    const link = quote(state, linkRequest(at)).quotes[0]!;
    expect(link.effect).not.toBeNull();
    expect(link.locked?.code).toBe('research');
    const row = buildOffers(at.level, null, link).rows[4];
    expect(row.change).not.toBe('—');
    expect(row.lock).toBe(link.locked?.text);
    expect(row.where).toBe(true);
    expect(row.price).toBeNull();
    expect(row.affordable).toBe(false);
  });

  it('reads all four tray effects, including counts and research-locked adds', () => {
    const tray = [offer(effect('slots', 3, 4)), offer(effect('bits', 8, 16)),
      offer(effect('Hz', 1000, 2000)), offer(effect('slots', 2, 4))];
    tray[0] = { ...tray[0]!, locked: { code: 'research', node: null, text: 'Needs Dual core' } };
    const rows = buildOffers('chip', tray, null).rows;
    expect(rows.slice(0, 4).map(r => r.change)).toEqual(['3 → 4 slots', '8 → 16 b', '1 → 2 kHz', '2 → 4 slots']);
    expect(rows[0].price).toBeNull();
    expect(rows[0].lock).toBe('Needs Dual core');
    expect(rows[1].quote).toBe(tray[1]);
  });

  it('words real tray quotes directly without separate part requests', () => {
    const state = createInitialState(42), at = nodes[0]!;
    const tray = quote(state, { kind: 'tray', at }).quotes;
    const rows = buildOffers(at.level, tray, null).rows;
    for (const [i, q] of tray.slice(0, 3).entries()) {
      expect(q.effect).not.toBeNull();
      expect(rows[i]!.change).toBe(changeText(q.effect!));
    }
    // The absent, research-locked scheduler has no preview yet.
    expect(rows[3].change).toBe(tray[3]!.effect ? changeText(tray[3]!.effect) : tray[3]!.label);
  });

  it('keeps an empty inbound quote empty when the sim has no link to sell', () => {
    const quotes = quote(createInitialState(42), linkRequest(nodes[4]!)).quotes;
    expect(quotes).toEqual([]);
    expect(buildOffers('global', null, quotes[0] ?? null).rows[4].quote).toBeNull();
  });
});

describe('one grammar and one list (A08, A14)', () => {
  const slots = (before: number, after: number): EffectPreview => ({ ...effect('slots', before, after) });
  it('words a first add as "Add RAM", hides invalid quotes, and names the right column', () => {
    const lock = (code: 'research' | 'ceiling' | 'fit', text: string) => ({ code, node: code === 'research' ? 'dualSocket' as never : null, text });
    const tray = [{ ...offer(slots(1, 2)), locked: lock('research', 'Needs Dual socket') }, offer(slots(0, 1)),
      { ...offer(slots(0, 1)), locked: lock('fit', 'No such part') }, { ...offer(slots(1, 2)), locked: lock('ceiling', 'Max') }];
    const rows = buildOffers('system', tray, null).rows;
    expect(rows.map(r => r.key)).toEqual(['cpu', 'ram', 'storage', 'link', 'psu']);
    expect(rows.map(r => [r.name, r.change, r.right.kind])).toEqual([
      // QA-08, QA-23: a maxed row says only where it stands; one slot is singular
      ['CPU', '1 → 2 slots', 'research'], ['Add RAM', '0 → 1 slot', 'price'], ['Storage', '1 slot', 'max'], ['Pipe', '—', 'none'], ['PSU', '—', 'none']]);
    expect(rows[0]!.right).toEqual({ kind: 'research', node: 'Dual socket' });
  });
  it('the System lists its PSU from the part quote, and the tile names the next unlock when nothing is priced', () => {
    const psu = offer(effect('W', 32_800, 65_500));
    const o = buildOffers('system', null, null, [psu]);
    expect(o.rows.at(-1)).toMatchObject({ key: 'psu', slot: 'psu', name: 'PSU', price: 12 });
    // QA-05: a supply is featured only near its limit
    expect(o.next).toBeNull();
    expect(buildOffers('system', null, null, [psu], { cacheLevels: 1, supplyNear: new Set(['psu']) }).next?.key).toBe('psu');
    const locked = { ...offer(slots(1, 2)), locked: { code: 'research' as const, node: 'dualSocket' as never, text: 'Needs Dual socket' } };
    const none = buildOffers('system', [locked, locked, locked, locked], null);
    expect([none.next, none.unlock?.key]).toEqual([null, 'cpu']);
  });
});

describe('router queue offers (D25.7)', () => {
  it('the rack sells its LB queue as a row the LB callout reads, locked as Max at 32', () => {
    const next = { ...offer(effect('slots', 1, 2)), action: { type: 'upgradeRouterQueue', unit: { kind: 'rack', id: rackId(0) } } } as Quote;
    const row = buildOffers('rack', null, null, [null, next]).rows.find(r => r.key === 'lbQueue')!;
    expect([row.name, row.change, row.slot, row.price]).toEqual(['LB queue', '1 → 2 slots', 'lb', 12]);
    const top = { ...next, effect: effect('slots', 32, 32), locked: { code: 'cap' as const, node: null, text: 'Queue at 32/32' } };
    const max = buildOffers('rack', null, null, [null, top]).rows.find(r => r.key === 'lbQueue')!;
    expect([max.change, max.right]).toEqual(['32 slots', { kind: 'max' }]);
  });
});

describe('cache levels', () => {
  const cacheQuote = (kind: 'l1' | 'l2', before: number, after: number): Quote => ({ ...offer(effect('bits', before, after)),
    action: { type: 'upgradePart', part: { unit: { kind: 'system', id: systemId(0) }, slot: { kind, socket: 0 } } } } as Quote);
  it('one level reads "Cache"; with several, the row names the level its quote upgrades', () => {
    const tray = (q: Quote) => [offer(effect('slots', 1, 2)), q, offer(effect('Hz', 1, 2)), offer(effect('slots', 0, 1))];
    expect(buildOffers('chip', tray(cacheQuote('l1', 1, 2)), null).rows[1]).toMatchObject({ name: 'Cache', change: '1 → 2 b', slot: 'l1' });
    expect(buildOffers('chip', tray(cacheQuote('l2', 65_536, 131_072)), null, [], { cacheLevels: 2 }).rows[1])
      .toMatchObject({ name: 'L2 cache', change: '65.5 → 131 kb', slot: 'l2' });
  });
});

describe('rack Power control (D31.3)', () => {
  it('sells Power control as the rack\'s fifth infrastructure row from its own quote, never a start setting', () => {
    const add = { ...offer(effect('slots', 0, 1)), label: 'Lead-acid', action: { type: 'upgradePart', part: { unit: { kind: 'rack', id: rackId(0) }, slot: { kind: 'pdu' } } } } as Quote;
    const set = { ...add, action: { type: 'setStartConfig', unit: { kind: 'rack', id: rackId(0) }, startWith: 1, headWaitS: 2, busyPct: null, order: 'slot' } } as Quote;
    expect(extraOffer([set, add])).toBe(add);
    const rows = buildOffers('rack', null, null, [add, null]).rows;
    expect(rows.find(r => r.key === 'powerCtl')?.name).toMatch(/Power control$/);
    expect(extraRequest({ level: 'rack', id: 2 } as never, EXTRA_ROWS.rack![0]!)).toEqual({ kind: 'power', unit: { kind: 'rack', id: 2 } });
  });
});

describe('start controller rows (D31.2)', () => {
  it('an upgrade with no capacity effect reads its level step', () => {
    const up = { ...offer(effect('slots', 0, 1)), effect: null, label: 'Room start control · L3', action: { type: 'upgradePart', part: { unit: { kind: 'room', id: roomId(0) }, slot: { kind: 'roomStart' } } } } as unknown as Quote;
    expect(buildOffers('room', null, null, [null, up]).rows.find(r => r.key === 'roomStart')?.change).toBe('L2 → L3');
  });
});

describe('the featured buy answers the wall (QA-05)', () => {
  const at = (price: number, e = effect('slots', 1, 2)) => ({ ...offer(e), cost: String(price) as never });
  it('prefers what the head is blocked on, saving up for it, over a cheaper affordable buy', () => {
    const tray = [at(5), { ...at(500, effect('bits', 1, 2)), affordable: false }, at(8, effect('Hz', 1, 2)), at(9)];
    expect(buildOffers('chip', tray, null).next?.key).toBe('core');
    expect(buildOffers('chip', tray, null, [], { cacheLevels: 1, wall: ['cache'] }).next?.key).toBe('cache');
  });
  it('never points at Max: a maxed wall row falls back to the cheapest buy', () => {
    const maxed = { ...at(500, effect('bits', 2, 2)), locked: { code: 'ceiling' as const, node: null, text: 'Max' } };
    const tray = [at(5), maxed, at(8, effect('Hz', 1, 2)), at(9)];
    expect(buildOffers('chip', tray, null, [], { cacheLevels: 1, wall: ['cache'] }).next?.key).toBe('core');
    expect(actionable(buildOffers('chip', tray, null).rows[1]!)).toBe(false);
  });
});
