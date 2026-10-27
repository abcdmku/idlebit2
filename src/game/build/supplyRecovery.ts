import { POWER_SCALE } from '../core/constants';
import { quote } from './quotes';
import type { GameState } from '../types/state';
import type { Quote, QuoteRequest } from '../types/quotes';
import { rackId, roomId, systemId, type PartRef, type ResearchId } from '../types/ids';

/** Locate each upstream supply, including the PDU blocking a PSU upgrade. */
function request(state: GameState, q: Quote): QuoteRequest | null {
  const os = q.overSupply, a = q.action;
  if (!os) return null;
  const unit = a.type === 'replaceCpu' || a.type === 'installGpu' || a.type === 'addPart' ? { kind: 'system' as const, id: a.system }
    : a.type === 'upgradePart' || a.type === 'upgradePartTo' || a.type === 'replacePart' ? a.part.unit
      : a.type === 'addUnit' ? a.parent : null;
  if (!unit) return null;
  const system = unit.kind === 'system' ? unit.id : null;
  const rack = unit.kind === 'rack' ? unit.id : system !== null ? state.build.systems[system]?.rack : undefined;
  const room = unit.kind === 'room' ? unit.id : rack !== undefined ? state.build.racks[rack]?.room : undefined;
  const part: PartRef | null = os.part === 'psu' && system !== null ? { unit: { kind: 'system', id: systemId(system) }, slot: { kind: 'psu' } }
    : os.part === 'pdu' && rack !== undefined ? { unit: { kind: 'rack', id: rackId(rack) }, slot: { kind: 'pdu' } }
    : os.part === 'ups' && room !== undefined ? { unit: { kind: 'room', id: roomId(room) }, slot: { kind: 'ups', index: 0 } } : null;
  return part ? { kind: 'part', part, minimumCapacity: os.afterW / POWER_SCALE } : null;
}

const costOrder = (a: Quote, b: Quote) => BigInt(a.cost) < BigInt(b.cost) ? -1 : BigInt(a.cost) > BigInt(b.cost) ? 1 : 0;

/** First affordable dependency in a finite PSU → PDU → UPS chain. */
export function supplyPreparation(state: GameState, purchase: Quote, affordableOnly = true, depth = 0): Quote | null {
  if (depth > 2) return null;
  const r = request(state, purchase);
  if (!r) return null;
  const options = quote(state, r).quotes.filter(q => !q.locked && (!affordableOnly || q.affordable) && q.effect
    && q.effect.capacityAfter > q.effect.capacityBefore && q.effect.capacityAfter >= purchase.overSupply!.afterW).sort(costOrder);
  for (const q of options) {
    if (!q.overSupply) return q;
    const parent = supplyPreparation(state, q, affordableOnly, depth + 1);
    if (parent) return parent;
  }
  return null;
}

/** An unavailable sized replacement points to its existing research prerequisite. */
export function supplyResearch(state: GameState, purchase: Quote): ResearchId | null {
  const r = request(state, purchase);
  if (!r) return null;
  const options = quote(state, r).quotes;
  if (options.some(q => !q.locked)) return null;
  return options.filter(q => q.locked?.code === 'research' && q.locked.node).sort(costOrder)[0]?.locked?.node ?? null;
}
