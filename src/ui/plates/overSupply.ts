// A buy that would push a supply past its cap (sim `Quote.overSupply`, view watts): the warning words and
// the quote for the supply that answers it. Pure, so the keys, the toast and tests read one rule.
import { rackId, roomId, systemId, type OverSupply, type QuoteRequest, type RenderSnapshot } from '../../game';
import { watts } from './format';
import type { PointKind } from '../input/pointAt';

export const SUPPLY_NAME: Readonly<Record<OverSupply['part'], string>> = { psu: 'power supply', pdu: 'rack PDU', ups: 'room UPS' };

/** "Over the power supply · 64 W → 80 W". */
export const overSupplyText = (os: OverSupply): string => `Over the ${SUPPLY_NAME[os.part]} · ${watts(os.capW)} → ${watts(os.afterW)}`;

/** The plate that shows the supply. */
export const SUPPLY_POINT: Readonly<Record<OverSupply['part'], PointKind>> = { psu: 'psu', pdu: 'pdu', ups: 'ups' };

/**
 * The quote request for the supply over its cap, in the world the player is looking at: the focused system's
 * power supply, its rack's PDU, its room's UPS (the rack and room power slot). Falls back to the home unit.
 */
export function supplyRequest(os: OverSupply, s: Pick<RenderSnapshot, 'focus' | 'home'>): QuoteRequest | null {
  const f = s.focus;
  if (os.part === 'psu') {
    const id = f.level === 'chip' || f.level === 'system' ? f.systemId : s.home.system?.id;
    return id === undefined ? null : { kind: 'part', part: { unit: { kind: 'system', id: systemId(id) }, slot: { kind: 'psu' } } };
  }
  if (os.part === 'pdu') {
    const id = f.level === 'rack' ? f.rackId : f.level === 'system' && f.parent?.level === 'rack' ? f.parent.id : s.home.rack?.id;
    return id === undefined ? null : { kind: 'infra', unit: { kind: 'rack', id: rackId(id) }, slot: 'power' };
  }
  const id = f.level === 'room' ? f.roomId : f.level === 'rack' && f.parent?.level === 'room' ? f.parent.id : s.home.room?.id;
  return id === undefined ? null : { kind: 'infra', unit: { kind: 'room', id: roomId(id) }, slot: 'power' };
}
