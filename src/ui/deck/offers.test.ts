import { describe, expect, it } from 'vitest';
import { createInitialState, quote, rackId, roomId, systemId, type EffectPreview, type NodeRef, type Quote } from '../../game';
import { buildOffers, changeText, linkRequest } from './offers';

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
      offer(effect('ops/s', 1000, 2000)), offer(effect('slots', 2, 4))];
    tray[0] = { ...tray[0]!, locked: { code: 'research', node: null, text: 'Needs Dual core' } };
    const rows = buildOffers('chip', tray, null).rows;
    expect(rows.slice(0, 4).map(r => r.change)).toEqual(['3 → 4 slots', '8 → 16 bits', '1 → 2 kHz', '2 → 4 slots']);
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
      expect(rows[i]!.change).toBe(changeText(q.effect!, i === 2));
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
