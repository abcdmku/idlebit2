import { RACK_SLOTS_PER_ROW, REGIONS, SERVERS_PER_RACK } from '../core/constants';
import type { ConfigSource } from '../types/actions';
import type { BuildState, RackConfig, RoomBuild, RoomConfig, SiteConfig, SystemConfig } from '../types/build';
import { REGION_IDS, type RegionId } from '../types/catalog';
import { rackId, roomId, siteId, systemId, type RackId, type RoomId, type ScopeRef, type SiteId, type SystemId, type UnitKind, type UnitRef } from '../types/ids';
import type { LockReason } from '../types/quotes';
import type { GameState, Unlocks } from '../types/state';
import { ladderInstall, LADDERS, tierName } from './catalog';
import {
  barebonesRackConfig, barebonesRoomConfig, barebonesSiteConfig, barebonesSystemSpec, rackConfig, rackLock, roomConfig, roomLock,
  siteConfig, siteLock, systemConfig, systemLock,
} from './configModel';
import { ceilingLock, genLock } from './locks';
import { fail, locked, planned, type Plan } from './plan';
import { nextRowPrice, rackConfigPrice, roomConfigPrice, siteConfigPrice, systemSpecPrice } from './pricing';
import { researchDef } from './research/tree';

type AnyConfig = SystemConfig | RackConfig | RoomConfig | SiteConfig;
const CHILD: Record<ScopeRef['kind'], UnitKind | null> = { system: null, rack: 'system', room: 'rack', site: 'room', global: 'site' };

/** Saved names compare case-insensitively (spec §13.5). */
export const findSaved = (state: GameState, kind: UnitKind, name: string) =>
  (state.configs[kind] as readonly { name: string; config: AnyConfig }[]).find((c) => c.name.toLowerCase() === name.trim().toLowerCase());

const viewLock = (level: 'rack' | 'room' | 'global'): LockReason => {
  const node = researchDef(level === 'global' ? 'dataCenter' : level);
  return { code: 'research', node: node?.id ?? null, text: `Needs ${node?.name ?? level}` };
};
/** Open regions: home, then 4 with `regions`, all 8 with `intercontinental` (spec §3.3). */
export const regionOpen = (u: Unlocks, region: RegionId): boolean => {
  const opens = REGIONS[REGION_IDS.indexOf(region)]!.opensWith;
  return opens === 'start' || (opens === 'regions' && u.ceilings.sites >= 4) || (opens === 'intercontinental' && u.ceilings.sites >= 8);
};

/** Resolves a ConfigSource to the child configuration for `parent`, or a failure. */
function resolve(state: GameState, parent: ScopeRef, source: ConfigSource): { cfg: AnyConfig; label: string } | Plan {
  const kind = CHILD[parent.kind];
  const u = state.research.unlocks;
  const b = state.build;
  if (!kind) return fail('invalid', 'Nothing can be added here');
  if (source.kind === 'saved') {
    const saved = findSaved(state, kind, source.name);
    if (!saved) return fail('invalid', 'No such saved configuration', source.name);
    return { cfg: saved.config, label: saved.name };
  }
  if (source.kind === 'copy') {
    const from = source.from;
    if (from.kind !== kind) return fail('invalid', 'Copy a unit of the same kind');
    const pid = parent.kind === 'global' ? -1 : parent.id;
    const sameParent = kind === 'system' ? b.systems[from.id]?.rack === pid : kind === 'rack' ? b.racks[from.id]?.room === pid
      : kind === 'room' ? b.rooms[from.id]?.site === pid : true;
    const cfg = kind === 'system' ? systemConfig(b, from.id) : kind === 'rack' ? rackConfig(b, from.id) : kind === 'room' ? roomConfig(b, from.id) : siteConfig(b, from.id);
    if (!cfg || !sameParent) return fail('invalid', 'Copy a sibling');
    const label = kind === 'system' ? `Server ${(b.systems[from.id]?.slot ?? 0) + 1}` : `${kind[0]!.toUpperCase()}${kind.slice(1)} ${from.id}`;
    return { cfg, label };
  }
  if (kind === 'system') {
    const board = source.board ?? 'general';
    const label = source.storageNode ? 'Storage node' : board === 'accelerator' ? `${tierName(source.tier)} accelerator` : tierName(source.tier);
    return { cfg: { online: true, spec: barebonesSystemSpec(source.tier, u, board, source.storageNode ?? false) }, label };
  }
  if (kind === 'rack') return { cfg: barebonesRackConfig(), label: 'Barebones rack' };
  if (kind === 'room') return { cfg: barebonesRoomConfig(), label: 'Barebones zone' };
  return { cfg: barebonesSiteConfig(), label: 'Barebones site' };
}

/* ---------- Instantiation: new ids at the end of each list; sub-objects shared with the config ---------- */

function addSystem(b: BuildState, rack: RackId, slot: number, cfg: SystemConfig, added: number[]): BuildState {
  const id: SystemId = systemId(b.systems.length);
  added.push(id);
  return {
    ...b, systems: [...b.systems, { id, rack, slot, online: cfg.online, spec: cfg.spec }],
    racks: b.racks.map((x, i) => (i === rack && x ? { ...x, servers: x.servers.map((s, j) => (j === slot ? id : s)) } : x)),
  };
}
function addRack(b: BuildState, room: RoomId, slot: number, cfg: RackConfig, added: number[]): BuildState {
  const id: RackId = rackId(b.racks.length);
  const { servers, ...rest } = cfg;
  let next: BuildState = { ...b, racks: [...b.racks, { ...rest, id, room, slot, opened: true, servers: Array(SERVERS_PER_RACK).fill(null) }] };
  next = { ...next, rooms: next.rooms.map((x, i) => (i === room && x ? { ...x, racks: x.racks.map((r, j) => (j === slot ? id : r)) } : x)) };
  servers.forEach((s, j) => { if (s) next = addSystem(next, id, j, s, added); });
  return next;
}
function addRoom(b: BuildState, site: SiteId, zone: number, cfg: RoomConfig, added: number[]): BuildState {
  const id: RoomId = roomId(b.rooms.length);
  const { racks, ...rest } = cfg;
  const slots = Array<RackId | null>(cfg.rows * RACK_SLOTS_PER_ROW).fill(null);
  let next: BuildState = { ...b, rooms: [...b.rooms, { ...rest, id, site, zone, opened: true, racks: slots } satisfies RoomBuild] };
  next = { ...next, sites: next.sites.map((x, i) => (i === site && x ? { ...x, zones: x.zones.map((z, j) => (j === zone ? id : z)) } : x)) };
  racks.forEach((r, j) => { if (r && j < slots.length) next = addRack(next, id, j, r, added); });
  return next;
}
function addSite(b: BuildState, region: RegionId, cfg: SiteConfig, added: number[]): BuildState {
  const id: SiteId = siteId(b.sites.length);
  const { zones, ...rest } = cfg;
  let next: BuildState = {
    ...b, sites: [...b.sites, { ...rest, id, region, opened: true, zones: [null, null, null], backbone: { gen: 0, k: LADDERS.backbone.baseK[0]! } }],
  };
  zones.forEach((z, j) => { if (z) next = addRoom(next, id, j, z, added); });
  return next;
}

/** Plans `addUnit` (spec §13.2–13.3): resolve the source, check level, slot, fit and locks, price it. */
export function planAddUnit(state: GameState, parent: ScopeRef, slot: number, source: ConfigSource): Plan {
  const resolved = resolve(state, parent, source);
  if ('ok' in resolved) return resolved;
  const { cfg, label } = resolved;
  const b = state.build;
  const u = state.research.unlocks;
  const added: number[] = [];
  const done = (price: bigint, lock: LockReason | null, build: () => BuildState): Plan =>
    (lock ? locked(lock, label, price) : planned({ build: build(), price, added }, label));
  switch (parent.kind) {
    case 'rack': {
      const rack = b.racks[parent.id];
      if (!rack) return fail('invalid', 'No such rack');
      if (slot < 0 || slot >= SERVERS_PER_RACK) return fail('invalid', 'No such slot');
      if (rack.servers[slot] !== null) return fail('occupied', 'Slot is taken', label);
      const sys = cfg as SystemConfig;
      const lock = rack.opened ? (source.kind === 'barebones' ? genLock(u, 'cpu', source.tier) : null) ?? systemLock(u, sys.spec) : viewLock('rack');
      return done(systemSpecPrice(sys.spec), lock, () => addSystem(b, rack.id, slot, sys, added));
    }
    case 'room': {
      const room = b.rooms[parent.id];
      if (!room) return fail('invalid', 'No such zone');
      if (slot < 0 || slot >= room.racks.length) return fail('invalid', 'No such slot');
      if (room.racks[slot] !== null) return fail('occupied', 'Slot is taken', label);
      const rc = cfg as RackConfig;
      return done(rackConfigPrice(rc), room.opened ? rackLock(u, rc) : viewLock('room'), () => addRack(b, room.id, slot, rc, added));
    }
    case 'site': {
      const site = b.sites[parent.id];
      if (!site) return fail('invalid', 'No such site');
      if (slot < 0 || slot >= site.zones.length) return fail('invalid', 'No such zone slot');
      if (site.zones[slot] !== null) return fail('occupied', 'Zone is taken', label);
      const zc = cfg as RoomConfig;
      const paid = site.zones.filter((z) => z !== null && z !== 0).length;
      const lock = !site.opened ? viewLock('global') : genLock(u, 'zone', 0) ?? ceilingLock(u, 'siteZones', slot + 1) ?? roomLock(u, zc);
      return done(roomConfigPrice(zc, paid), lock, () => addRoom(b, site.id, slot, zc, added));
    }
    case 'global': {
      const region = REGION_IDS[slot];
      if (!region) return fail('invalid', 'No such region');
      if (b.sites.some((s) => s?.region === region)) return fail('occupied', 'Region has a site', label);
      const sc = cfg as SiteConfig;
      const paid = b.sites.filter((s) => s !== null && s.id !== 0).length;
      const price = siteConfigPrice(sc, paid) + ladderInstall(LADDERS.backbone, 0);
      const lock = genLock(u, 'site', 0) ?? (regionOpen(u, region) ? null : ceilingLock(u, 'sites', 8)) ?? siteLock(u, sc);
      return done(price, lock, () => addSite(b, region, sc, added));
    }
    default: return fail('invalid', 'Nothing can be added here');
  }
}

/** Scrap a system, storage node or rack (spec §4.5). Free containers and the boot system stay. */
export function planRemoveUnit(state: GameState, unit: UnitRef): Plan {
  const b = state.build;
  if (unit.kind === 'system') {
    const sys = b.systems[unit.id];
    if (!sys || unit.id === 0) return fail('invalid', 'This system cannot be scrapped');
    const build: BuildState = {
      ...b, systems: b.systems.map((s, i) => (i === unit.id ? null : s)),
      racks: b.racks.map((r) => (r && r.id === sys.rack ? { ...r, servers: r.servers.map((s) => (s === unit.id ? null : s)) } : r)),
    };
    return planned({ build, price: 0n, removed: [unit.id] }, 'Scrap');
  }
  if (unit.kind === 'rack') {
    const rack = b.racks[unit.id];
    if (!rack || unit.id === 0) return fail('invalid', 'This rack cannot be scrapped');
    const removed = rack.servers.filter((s): s is SystemId => s !== null);
    const build: BuildState = {
      ...b, systems: b.systems.map((s, i) => (removed.includes(i as SystemId) ? null : s)),
      racks: b.racks.map((r, i) => (i === unit.id ? null : r)),
      rooms: b.rooms.map((z) => (z && z.id === rack.room ? { ...z, racks: z.racks.map((r) => (r === unit.id ? null : r)) } : z)),
    };
    return planned({ build, price: 0n, removed }, 'Scrap');
  }
  return fail('invalid', 'Only systems and racks can be scrapped');
}

/** Hot: one more row of 8 rack slots, up to the roomRows ceiling (spec §12.3 rows). */
export function planAddRow(state: GameState, room: RoomId): Plan {
  const z = state.build.rooms[room];
  if (!z) return fail('invalid', 'No such zone');
  const price = nextRowPrice(z.rows);
  const label = `Row ${z.rows + 1}`;
  const lock = !z.opened ? viewLock('room') : ceilingLock(state.research.unlocks, 'roomRows', z.rows + 1);
  if (lock) return locked(lock, label, price);
  const build: BuildState = {
    ...state.build,
    rooms: state.build.rooms.map((x, i) => (i === room && x ? { ...x, rows: x.rows + 1, racks: [...x.racks, ...Array<RackId | null>(RACK_SLOTS_PER_ROW).fill(null)] } : x)),
  };
  return planned({ build, price }, label);
}

