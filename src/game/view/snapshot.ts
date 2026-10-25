import { TICK_MS } from '../core/constants';
import { rackId, roomId, systemId, type LevelId, type NodeRef } from '../types/ids';
import type { LevelSnapshot, RenderSnapshot, SnapshotScope } from '../types/snapshot';
import type { GameState } from '../types/state';
import { chipSnapshot, chipStatic } from './chip';
import { feedSnapshot } from './feed';
import { globalSnapshot } from './global';
import { hudSnapshot, roundSnapshot } from './hud';
import { rackSnapshot } from './rack';
import { researchBadge } from './research';
import { roomSnapshot } from './room';
import { systemSnapshot, systemStatic } from './system';

export { slaPercent } from './hud';

/**
 * What a published snapshot was built from. Level snapshots are reused whole while their inputs
 * are referentially unchanged, and their static parts (slot layouts, cache levels) while build,
 * compiled and research are. Pure memoization: output never depends on whether a hit occurred.
 *
 * A source keeps the identities it compares, never the state: an owned advance (D9) consumes the
 * state and updates its hot buffers in place, so `hot` is compared together with the tick.
 */
interface Source {
  readonly build: GameState['build'];
  readonly compiled: GameState['compiled'];
  readonly unlocks: GameState['research']['unlocks'];
  readonly hot: GameState['hot'];
  readonly round: GameState['round'];
  readonly research: GameState['research'];
  readonly tick: number;
  readonly events: GameState['events'];
  readonly focusKey: string;
  readonly partnerKey: string | null;
}
const SOURCES = new WeakMap<RenderSnapshot, Source>();

const keyOf = (ref: NodeRef): string => `${ref.level}:${ref.id}`;

/** The player's first live system, and its containers once their levels are opened. */
export function homeRefs(state: GameState): Partial<Record<LevelId, NodeRef>> {
  const sys = state.build.systems.find((s) => s !== null) ?? null;
  const id = systemId(sys?.id ?? 0);
  const home: Partial<Record<LevelId, NodeRef>> = { chip: { level: 'chip', id }, system: { level: 'system', id } };
  if (!sys) return home;
  const rack = state.build.racks[sys.rack];
  if (rack?.opened) home.rack = { level: 'rack', id: rackId(rack.id) };
  const room = rack ? state.build.rooms[rack.room] : null;
  if (room?.opened) home.room = { level: 'room', id: roomId(room.id) };
  if (room && state.build.sites[room.site]?.opened) home.global = { level: 'global', id: 0 };
  return home;
}

/** A ref the build can serve: dead or unknown ids fall back to the home system's chip. */
function resolve(state: GameState, ref: NodeRef, home: Partial<Record<LevelId, NodeRef>>): NodeRef {
  const b = state.build;
  const ok = ref.level === 'global' ? b.sites.some((s) => s !== null)
    : ref.level === 'room' ? !!b.rooms[ref.id]
      : ref.level === 'rack' ? !!b.racks[ref.id]
        : !!b.systems[ref.id];
  return ok ? ref : (home[ref.level] ?? home.chip!);
}

/** The node one level up that contains the ref, or null when that level is not opened (zoom out). */
export function parentOf(state: GameState, ref: NodeRef): NodeRef | null {
  const b = state.build;
  switch (ref.level) {
    case 'chip': return state.research.unlocks.levels.system ? { level: 'system', id: ref.id } : null;
    case 'system': {
      const rack = b.racks[b.systems[ref.id]?.rack ?? -1];
      return rack?.opened ? { level: 'rack', id: rackId(rack.id) } : null;
    }
    case 'rack': {
      const room = b.rooms[b.racks[ref.id]?.room ?? -1];
      return room?.opened ? { level: 'room', id: roomId(room.id) } : null;
    }
    case 'room': return b.sites[b.rooms[ref.id]?.site ?? -1]?.opened ? { level: 'global', id: 0 } : null;
    case 'global': return null;
  }
}

const sameCold = (a: Source, b: GameState): boolean =>
  a.build === b.build && a.compiled === b.compiled && a.unlocks === b.research.unlocks;
const sameAll = (a: Source, b: GameState): boolean =>
  sameCold(a, b) && a.hot === b.hot && a.round === b.round && a.research === b.research && a.tick === b.clock.tick;

function buildLevel(state: GameState, ref: NodeRef, prev: LevelSnapshot | null, cold: boolean): LevelSnapshot {
  const parent = parentOf(state, ref);
  switch (ref.level) {
    case 'chip': {
      const p = cold && prev?.level === 'chip' && prev.systemId === ref.id ? prev : null;
      return chipSnapshot(state, ref.id, parent, p ? { slots: p.slots, levels: p.cache.levels } : chipStatic(state, ref.id));
    }
    case 'system': {
      const p = cold && prev?.level === 'system' && prev.systemId === ref.id ? prev : null;
      return systemSnapshot(state, ref.id, parent, p ? { slots: p.slots, chip: { slots: p.chip.slots, levels: p.chip.cache.levels } } : systemStatic(state, ref.id));
    }
    case 'rack': return rackSnapshot(state, ref.id, parent);
    case 'room': return roomSnapshot(state, ref.id, parent);
    case 'global': return globalSnapshot(state);
  }
}

function level(state: GameState, ref: NodeRef, previous: RenderSnapshot | undefined, src: Source | undefined): LevelSnapshot {
  const key = keyOf(ref);
  const prev = !previous || !src ? null
    : src.focusKey === key ? previous.focus
      : src.partnerKey === key ? previous.partner : null;
  if (prev && src && sameAll(src, state)) return prev;
  return buildLevel(state, ref, prev, !!src && sameCold(src, state));
}

/**
 * The render snapshot for the visible levels (architecture §3). Cost is proportional to what is on
 * screen. It never computes quotes.
 */
export function deriveRenderSnapshot(state: GameState, scope: SnapshotScope, previous?: RenderSnapshot): RenderSnapshot {
  const src = previous ? SOURCES.get(previous) : undefined;
  const prev = previous && src && previous.epoch === state.epoch ? previous : undefined;
  const home = homeRefs(state);
  const focusRef = resolve(state, scope.focus, home);
  const partnerRef = scope.partner ? resolve(state, scope.partner, home) : null;
  const entries = state.events.entries;
  const sameEvents = !!prev && !!src && src.events === state.events;
  const snap: RenderSnapshot = {
    epoch: state.epoch, tick: state.clock.tick, simTimeMs: state.clock.tick * TICK_MS + state.clock.carryMs,
    bootMs: state.research.unlocks.bootTicks * TICK_MS,
    hud: hudSnapshot(state, prev?.hud ?? null),
    feed: feedSnapshot(state, prev?.feed ?? null, sameEvents),
    round: roundSnapshot(state, prev?.round ?? null),
    research: researchBadge(state),
    unlocked: state.research.unlocks.levels,
    home,
    focus: level(state, focusRef, prev, prev ? src : undefined),
    partner: partnerRef ? level(state, partnerRef, prev, prev ? src : undefined) : null,
    events: entries, firstSeq: entries[0]?.seq ?? state.events.nextSeq, lastSeq: state.events.nextSeq - 1,
  };
  SOURCES.set(snap, {
    build: state.build, compiled: state.compiled, unlocks: state.research.unlocks, hot: state.hot, round: state.round,
    research: state.research, tick: state.clock.tick, events: state.events,
    focusKey: keyOf(focusRef), partnerKey: partnerRef ? keyOf(partnerRef) : null,
  });
  return snap;
}
