import { LINK_KIND, LOC, type HotBuffers } from '../core/buffers';
import { MAX_RACK_PORTS, MAX_ROOM_PORTS, MAX_SITES, MAX_UPLINKS, MAX_ZONES_PER_SITE, RACKS_PER_ROOM } from '../core/constants';
import type { World } from '../core/world';
import { memberPayload, shapeOf } from '../exec/shape';
import { FIRST, nextLink } from '../net/paths';
import { familyId, rackId, roomId, systemId, type NodeRef } from '../types/ids';
import type { GameState } from '../types/state';
import type { TransferView } from '../types/views';

/*
 * D25 shard transfers for the level snapshots. One TransferView per record on a link, read from the
 * link FIFOs (net/fifo: owner = link, target = system, `finish` = bits left on this link, `threads`
 * 1 once sending, `start` ≥ 0 once sent and waiting out latency). Observation only.
 *
 * `to` is the node the link enters: server → its system, rack → its rack, zone → its room,
 * backbone → the room the shard is bound for. `from` is null on the first link of the shard's path
 * (the market), else the router above: rack, room, or global.
 *
 * Bounds: a level's own top link (the rack uplink, the room's zone link, each backbone link) shows
 * the first 4 × channels records of its FIFO, so the shards waiting at its mouth appear with
 * bitsSent 0. Child links (ports, rack links, zone links below the backbone) show their first
 * `channels` records. Every level is capped at FLOWS_MAX, top links first.
 */

export const FLOWS_MAX = 128;
const TOP_DEPTH = 4;

/** Stable per shard transfer, across ticks and links: a task has at most 256 shards. */
export const shardKey = (taskId: number, shard: number): number => taskId * 256 + shard;

/** Shard index and the task's shard count (placed plus shares still in router queues). */
export function shardOf(hot: HotBuffers, r: number): { shard: number; shards: number } {
  const p = hot.rec.parent[r] ?? -1;
  if (p < 0) return { shard: 0, shards: 1 };
  return { shard: hot.rec.shard[r] ?? 0, shards: Math.max(1, (hot.parent.placed[p] ?? 0) + (hot.parent.pending[p] ?? 0)) };
}

/** net/paths reads compiled and hot only. */
const ctx = (state: GameState): World => state as unknown as World;

const GLOBAL: NodeRef = { level: 'global', id: 0 };
const LINK_NAME: Readonly<Record<number, TransferView['link']>> = {
  [LINK_KIND.server]: 'server', [LINK_KIND.rack]: 'rack', [LINK_KIND.zone]: 'zone', [LINK_KIND.backbone]: 'backbone',
};
/** A link's name by its kind (the rack level renames its top link 'uplink'). */
export const linkName = (kind: number): TransferView['link'] => LINK_NAME[kind] ?? 'server';

/** The node link l enters for a shard bound for system `target`. */
function toOf(state: GameState, l: number, target: number): NodeRef {
  const c = state.compiled, owner = c.link.owner[l] ?? 0;
  switch (c.link.kind[l]) {
    case LINK_KIND.rack: return { level: 'rack', id: rackId(owner) };
    case LINK_KIND.zone: return { level: 'room', id: roomId(owner) };
    case LINK_KIND.backbone: return { level: 'room', id: roomId(c.sys.room[target] ?? 0) };
    default: return { level: 'system', id: systemId(target) };
  }
}

/** The router link l leaves, or null when l is the first link of the shard's path. */
function fromOf(state: GameState, l: number, target: number): NodeRef | null {
  if (nextLink(ctx(state), target, FIRST) === l) return null;
  const c = state.compiled, kind = c.link.kind[l];
  if (kind === LINK_KIND.server) return { level: 'rack', id: rackId(c.link.owner[l] ?? 0) };
  if (kind === LINK_KIND.rack) return { level: 'room', id: roomId(c.sys.room[target] ?? 0) };
  return GLOBAL;
}

/** Record r on link l, named `name`. */
export function linkTransfer(state: GameState, r: number, l: number, name: TransferView['link']): TransferView {
  const c = state.compiled, rec = state.hot.rec;
  const target = rec.target[r]!, taskId = rec.taskId[r]!, units = rec.units[r]!;
  const bits = rec.count[r]! * memberPayload(shapeOf(rec.family[r]!), units);
  const { shard, shards } = shardOf(state.hot, r);
  return {
    taskId, family: familyId(rec.family[r]!), systemId: systemId(target), link: name,
    bitsSent: Math.max(0, bits - Math.max(0, rec.finish[r]!)), bits, speed: c.link.speed[l] ?? 0,
    shard, shards, units, from: fromOf(state, l, target), to: toOf(state, l, target), key: shardKey(taskId, shard),
  };
}

/** Appends link l's first `depth × channels` FIFO records to `out`, up to FLOWS_MAX. */
function pushLink(state: GameState, l: number, depth: number, name: TransferView['link'], out: TransferView[]): void {
  if (l < 0 || l >= state.compiled.link.len) return;
  const hot = state.hot, rec = hot.rec;
  const n = depth * Math.max(1, state.compiled.link.channels[l] ?? 1);
  let k = 0;
  for (let r = hot.link.head[l] ?? -1; r >= 0 && k < n && out.length < FLOWS_MAX; r = rec.next[r] ?? -1) {
    if (rec.loc[r] !== LOC.link) continue;
    out.push(linkTransfer(state, r, l, name));
    k += 1;
  }
}

/** The rack's top link: its uplinks, or its room port when it has none (one link row, compileLinks). */
function rackTopLink(state: GameState, rack: number): number {
  const c = state.compiled;
  for (let u = 0; u < MAX_UPLINKS; u += 1) {
    const l = c.rack.uplinkLink[rack * MAX_UPLINKS + u] ?? -1;
    if (l >= 0) return l;
  }
  const room = c.rack.room[rack] ?? -1, slot = c.rack.slot[rack] ?? MAX_ROOM_PORTS;
  return room >= 0 && slot < MAX_ROOM_PORTS ? (c.room.portLink[room * MAX_ROOM_PORTS + slot] ?? -1) : -1;
}

/** The room's zone link: its uplinks, or the site's data plane for its zone. */
function zoneLink(state: GameState, room: number): number {
  const c = state.compiled;
  for (let u = 0; u < MAX_UPLINKS; u += 1) {
    const l = c.room.uplinkLink[room * MAX_UPLINKS + u] ?? -1;
    if (l >= 0) return l;
  }
  const site = c.room.site[room] ?? -1, zone = c.room.zone[room] ?? MAX_ZONES_PER_SITE;
  return site >= 0 && zone < MAX_ZONES_PER_SITE ? (c.site.dpLink[site * MAX_ZONES_PER_SITE + zone] ?? -1) : -1;
}

/** Rack level: the rack uplink ('uplink', its waiting shards included), then each switch port. */
export function rackFlows(state: GameState, rack: number): TransferView[] {
  const out: TransferView[] = [];
  if (state.compiled.rack.opened[rack] !== 1) return out;
  pushLink(state, rackTopLink(state, rack), TOP_DEPTH, 'uplink', out);
  for (let p = 0; p < MAX_RACK_PORTS; p += 1) pushLink(state, state.compiled.rack.portLink[rack * MAX_RACK_PORTS + p] ?? -1, 1, 'server', out);
  return out;
}

/** Room level: the zone link (waiting shards included), then each rack's uplink ('rack'). */
export function roomFlows(state: GameState, room: number): TransferView[] {
  const out: TransferView[] = [];
  const c = state.compiled;
  if (c.room.opened[room] !== 1) return out;
  pushLink(state, zoneLink(state, room), TOP_DEPTH, 'zone', out);
  for (let i = 0; i < RACKS_PER_ROOM; i += 1) {
    const rack = c.room.racks[room * RACKS_PER_ROOM + i] ?? -1;
    if (rack >= 0 && c.rack.opened[rack] === 1) pushLink(state, rackTopLink(state, rack), 1, 'rack', out);
  }
  return out;
}

/**
 * World level: every backbone link (waiting shards included), then every site's data plane per
 * zone ('zone'). The gateway site's zone links are first links from the market, so they also show
 * their waiting shards.
 */
export function globalFlows(state: GameState): TransferView[] {
  const out: TransferView[] = [];
  const c = state.compiled.site, n = Math.min(c.len, MAX_SITES);
  for (let s = 0; s < n; s += 1) if (c.opened[s] === 1) pushLink(state, c.backboneLink[s] ?? -1, TOP_DEPTH, 'backbone', out);
  for (let s = 0; s < n; s += 1) {
    if (c.opened[s] !== 1) continue;
    const depth = (c.backboneLink[s] ?? -1) >= 0 ? 1 : TOP_DEPTH;
    for (let z = 0; z < MAX_ZONES_PER_SITE; z += 1) pushLink(state, c.dpLink[s * MAX_ZONES_PER_SITE + z] ?? -1, depth, 'zone', out);
  }
  return out;
}

/** The lone system's pipe transfer (before Rack), or null. */
export function pipeTransfer(state: GameState, s: number): TransferView | null {
  const h = state.hot.sys, rec = state.hot.rec;
  const r = h.pipeRec[s] ?? -1;
  if (r < 0) return null;
  const bits = rec.count[r]! * memberPayload(shapeOf(rec.family[r]!), rec.units[r]!);
  const { shard, shards } = shardOf(state.hot, r);
  return {
    taskId: rec.taskId[r]!, family: familyId(rec.family[r]!), systemId: systemId(s), link: 'pipe',
    bitsSent: Math.max(0, bits - (h.pipeLeft[s] ?? 0)), bits, speed: state.compiled.sys.pipeSpeed[s] ?? 0,
    shard, shards, units: rec.units[r]!, from: null, to: { level: 'system', id: systemId(s) }, key: shardKey(rec.taskId[r]!, shard),
  };
}

/**
 * The shard arriving on system s's top link: the pipe before Rack, else the front of its switch
 * port's FIFO (the port carries only s's shards). Null when nothing is on it.
 */
export function inboundTransfer(state: GameState, s: number): TransferView | null {
  const pipe = pipeTransfer(state, s);
  if (pipe) return pipe;
  const c = state.compiled, rack = c.sys.rack[s] ?? -1, port = c.sys.port[s] ?? -1;
  if (rack < 0 || port < 0 || port >= MAX_RACK_PORTS || c.rack.opened[rack] !== 1) return null;
  const l = c.rack.portLink[rack * MAX_RACK_PORTS + port] ?? -1;
  if (l < 0 || l >= c.link.len) return null;
  const rec = state.hot.rec;
  for (let r = state.hot.link.head[l] ?? -1; r >= 0; r = rec.next[r] ?? -1) {
    if (rec.loc[r] === LOC.link && rec.target[r] === s) return linkTransfer(state, r, l, 'server');
  }
  return null;
}
