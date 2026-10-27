// The "On market" toggle (setOnline) from the Rack up: which units take tasks. During a round it
// takes a unit off (or drains it first, with Graceful drain); between rounds it picks which units go
// on the market next round, to keep the load down. Before Rack the lone system has no toggle.
import type { GameState, LevelId, UnitRef } from '../../game';
import type { HitTarget } from '../../render/core';

export interface MarketState {
  readonly unit: UnitRef;
  /** The unit's own switch. */
  readonly on: boolean;
  /** Systems under it whose own switch and every parent's are on, and all its systems. */
  readonly live: number;
  readonly total: number;
  /** Graceful drain: a unit taken off mid-round finishes its tasks first. */
  readonly drains: boolean;
  readonly running: boolean;
  /** On, but a parent is off ("Off with its rack"). */
  readonly parentOff: 'rack' | 'room' | 'site' | null;
}

const LEVEL_OF: Readonly<Record<UnitRef['kind'], LevelId>> = { system: 'rack', rack: 'rack', room: 'room', site: 'global' };
const PARENT: Readonly<Record<UnitRef['kind'], MarketState['parentOff']>> = { system: 'rack', rack: 'room', room: 'site', site: null };

/** The unit a tapped target stands for: its own unit, or the system, rack or room it opens. */
export function targetUnit(t: Pick<HitTarget, 'unit' | 'drill' | 'kind'>): UnitRef | null {
  if (t.kind !== 'unit' && t.kind !== 'child') return null;
  if (t.unit) return t.unit;
  const d = t.drill;
  if (d?.level === 'system') return { kind: 'system', id: d.id } as UnitRef;
  if (d?.level === 'rack') return { kind: 'rack', id: d.id } as UnitRef;
  if (d?.level === 'room') return { kind: 'room', id: d.id } as UnitRef;
  return null;
}

/** The unit's market state, or null before its level (a system's: Rack) is opened. */
export function marketOf(state: GameState, unit: UnitRef): MarketState | null {
  const b = state.build;
  if (!state.research.unlocks.levels[LEVEL_OF[unit.kind]]) return null;
  const own = unit.kind === 'system' ? b.systems[unit.id] : unit.kind === 'rack' ? b.racks[unit.id] : unit.kind === 'room' ? b.rooms[unit.id] : b.sites[unit.id];
  if (!own) return null;
  const rackOf = (s: number) => b.systems[s]!.rack, roomOf = (s: number) => b.racks[rackOf(s)]?.room, siteOf = (s: number) => { const r = roomOf(s); return r === undefined ? undefined : b.rooms[r]?.site; };
  const under = (s: number) => unit.kind === 'system' ? s === unit.id : unit.kind === 'rack' ? rackOf(s) === unit.id
    : unit.kind === 'room' ? roomOf(s) === unit.id : siteOf(s) === unit.id;
  let live = 0, total = 0;
  b.systems.forEach((sys, s) => { if (sys && under(s)) { total++; if (state.compiled.sys.intent[s] === 1) live++; } });
  const parentIntent = unit.kind === 'system' ? state.compiled.rack.intent[b.systems[unit.id]!.rack]
    : unit.kind === 'rack' ? state.compiled.room.intent[b.racks[unit.id]!.room] : unit.kind === 'room' ? state.compiled.site.intent[b.rooms[unit.id]!.site] : 1;
  return { unit, on: own.online, live, total, drains: state.research.unlocks.rules.includes('gracefulDrain'), running: state.round.phase === 'running',
    parentOff: own.online && parentIntent !== 1 ? PARENT[unit.kind] : null };
}

/** The toggle key's label: the unit's own switch. */
export const marketKey = (m: MarketState) => (m.on ? 'On market' : 'Off market');

/** The line beside or above the key: what the switch means now. */
export function marketLine(m: MarketState): string {
  if (m.parentOff) return `Off with its ${m.parentOff}`;
  const count = m.unit.kind === 'system' ? '' : `${m.live} / ${m.total} on market`;
  if (count) return count;
  if (!m.running) return m.on ? 'On next round' : 'Sits out next round';
  return '';
}
