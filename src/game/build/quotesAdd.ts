import type { ConfigSource } from '../types/actions';
import { rackId, roomId, siteId, systemId, type ScopeRef, type UnitKind, type UnitRef } from '../types/ids';
import type { Quote } from '../types/quotes';
import type { GameState } from '../types/state';
import { TIER_COUNT } from './catalog';
import { toQuote } from './quotes';
import { newestGen } from './research/unlocks';
import { planAddUnit } from './units';

const CHILD: Partial<Record<ScopeRef['kind'], UnitKind>> = { rack: 'system', room: 'rack', site: 'room', global: 'site' };

/** Siblings a new unit may copy (spec §13.2): systems in this rack, racks in this zone, zones in this site, any site. */
function siblings(state: GameState, parent: ScopeRef): UnitRef[] {
  const b = state.build;
  switch (parent.kind) {
    case 'rack': return (b.racks[parent.id]?.servers ?? []).flatMap((s) => (s === null ? [] : [{ kind: 'system' as const, id: systemId(s) }]));
    case 'room': return (b.rooms[parent.id]?.racks ?? []).flatMap((r) => (r === null ? [] : [{ kind: 'rack' as const, id: rackId(r) }]));
    case 'site': return (b.sites[parent.id]?.zones ?? []).flatMap((z) => (z === null ? [] : [{ kind: 'room' as const, id: roomId(z) }]));
    case 'global': return b.sites.flatMap((s) => (s ? [{ kind: 'site' as const, id: siteId(s.id) }] : []));
    default: return [];
  }
}

/**
 * Configuration plate (spec §13.2, R13 order): barebones options (every CPU tier for a server,
 * locked tiers included, then the accelerator board and the storage node), then one copy per
 * sibling, then one per saved name. Each shows its full price and first lock.
 */
export function addQuotes(state: GameState, parent: ScopeRef, slot: number): Quote[] {
  const kind = CHILD[parent.kind];
  if (!kind) return [];
  const sources: ConfigSource[] = [];
  if (kind === 'system') {
    for (let tier = 0; tier < TIER_COUNT; tier += 1) sources.push({ kind: 'barebones', tier });
    const top = Math.max(0, newestGen(state.research.unlocks, 'cpu', TIER_COUNT));
    sources.push({ kind: 'barebones', tier: top, board: 'accelerator' }, { kind: 'barebones', tier: 0, storageNode: true });
  } else sources.push({ kind: 'barebones', tier: 0 });
  for (const from of siblings(state, parent)) sources.push({ kind: 'copy', from });
  for (const saved of state.configs[kind]) sources.push({ kind: 'saved', name: saved.name });
  return sources.map((source) => toQuote(state, { type: 'addUnit', parent, slot, source }, planAddUnit(state, parent, slot, source)));
}
