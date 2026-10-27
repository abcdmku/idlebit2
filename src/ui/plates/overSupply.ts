// A buy that would push a supply past its cap (sim `Quote.overSupply`, view watts): the warning words and
// the quote for the supply that answers it. Pure, so the keys, the toast and tests read one rule.
import { rackId, roomId, systemId, type OverSupply, type Quote, type QuoteRequest, type RenderSnapshot } from '../../game';
import { watts } from './format';
import { POWER_SCALE } from '../../game/core/constants';
import type { PointKind } from '../input/pointAt';

export const SUPPLY_NAME: Readonly<Record<OverSupply['part'], string>> = { psu: 'power supply', pdu: 'PDU', ups: 'UPS' };

/** Never answer overload with a cheaper supply that shrinks capacity or introduces another overload. */
export function supplyRecovery(quotes: readonly Quote[], os: OverSupply): Quote | null {
  const options = quotes.filter(q => q.action.type === 'upgradePart' || q.action.type === 'upgradePartTo' || q.action.type === 'replacePart');
  const safe = options.filter(q => !q.locked && !q.overSupply && q.effect && q.effect.capacityAfter > q.effect.capacityBefore
    && q.effect.capacityAfter > os.capW && q.effect.capacityAfter >= os.afterW);
  return safe.sort((a, b) => BigInt(a.cost) < BigInt(b.cost) ? -1 : BigInt(a.cost) > BigInt(b.cost) ? 1 : 0)[0]
    ?? options.find(q => q.locked?.code === 'research' && q.locked.node) ?? null;
}

/**
 * "Full load 80 W over the 64 W power supply: it trips if held". The sim's physics: a supply over its cap counts
 * overload time and fails (phys/supplies overloadFailed), taking what it feeds offline; a short peak does not.
 */
export const overSupplyText = (os: OverSupply): string => `${watts(os.afterW)} at full load, over the ${watts(os.capW)} ${SUPPLY_NAME[os.part]}`;

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
    return id === undefined ? null : { kind: 'part', part: { unit: { kind: 'system', id: systemId(id) }, slot: { kind: 'psu' } }, minimumCapacity: os.afterW / POWER_SCALE };
  }
  if (os.part === 'pdu') {
    const id = f.level === 'rack' ? f.rackId : f.level === 'system' && f.parent?.level === 'rack' ? f.parent.id : s.home.rack?.id;
    return id === undefined ? null : { kind: 'part', part: { unit: { kind: 'rack', id: rackId(id) }, slot: { kind: 'pdu' } }, minimumCapacity: os.afterW / POWER_SCALE };
  }
  const id = f.level === 'room' ? f.roomId : f.level === 'rack' && f.parent?.level === 'room' ? f.parent.id : s.home.room?.id;
  return id === undefined ? null : { kind: 'part', part: { unit: { kind: 'room', id: roomId(id) }, slot: { kind: 'ups', index: 0 } }, minimumCapacity: os.afterW / POWER_SCALE };
}
