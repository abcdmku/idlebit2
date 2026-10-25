import { LINK_KIND } from '../core/buffers';
import { DT_S, MAX_RACK_PORTS, MAX_ROOM_PORTS, MAX_UPLINKS, MAX_ZONES_PER_SITE } from '../core/constants';
import type { World } from '../core/world';

/**
 * Transfer paths (spec §7.2, §7.4). A path is the ordered list of links from the market to a
 * system: backbone (non-gateway site, D4.6), zone link (room opened), rack link and server link
 * (rack opened). Only links that exist at the player's stage appear; a missing link is integrated
 * and costs nothing. Path order is LINK_KIND descending, so a transfer finds its next hop from the
 * kind of the link it is on. With several uplinks a transfer takes the one with the shortest FIFO.
 */

/** The uplink (one of up to MAX_UPLINKS link ids at `base`) with the shortest FIFO, ties lowest index. */
function shortest(w: World, links: Int32Array, base: number): number {
  let best = -1;
  for (let u = 0; u < MAX_UPLINKS; u += 1) {
    const l = links[base + u]!;
    if (l < 0) continue;
    if (best < 0 || w.hot.link.qlen[l]! < w.hot.link.qlen[best]!) best = l;
  }
  return best;
}

/** The link of `kind` on system s's path, or -1 when that hop does not exist. */
export function linkOf(w: World, s: number, kind: number): number {
  const c = w.compiled;
  const rack = c.sys.rack[s]!, room = c.rack.room[rack]!, site = c.room.site[room]!;
  switch (kind) {
    case LINK_KIND.server: {
      if (c.rack.opened[rack] !== 1) return -1;
      const port = c.sys.port[s]!;
      return port >= 0 && port < MAX_RACK_PORTS ? c.rack.portLink[rack * MAX_RACK_PORTS + port]! : -1;
    }
    case LINK_KIND.rack: {
      if (c.rack.opened[rack] !== 1) return -1;
      const up = shortest(w, c.rack.uplinkLink, rack * MAX_UPLINKS);
      if (up >= 0 || c.room.opened[room] !== 1) return up;
      const slot = c.rack.slot[rack]!;
      return slot < MAX_ROOM_PORTS ? c.room.portLink[room * MAX_ROOM_PORTS + slot]! : -1;
    }
    case LINK_KIND.zone: {
      if (c.room.opened[room] !== 1) return -1;
      const up = shortest(w, c.room.uplinkLink, room * MAX_UPLINKS);
      return up >= 0 ? up : c.site.dpLink[site * MAX_ZONES_PER_SITE + c.room.zone[room]!]!;
    }
    case LINK_KIND.backbone:
      return site !== 0 ? c.site.backboneLink[site]! : -1;
  }
  return -1;
}

/** The first link after a link of kind `afterKind` on s's path (afterKind 4 = start), or -1 = arrived. */
export function nextLink(w: World, s: number, afterKind: number): number {
  for (let k = afterKind - 1; k >= 0; k -= 1) {
    const l = linkOf(w, s, k);
    if (l >= 0) return l;
  }
  return -1;
}

export const FIRST = 4;

/** Seconds a transfer of `bits` needs over the links from kind `afterKind` down (leastWork, latency). */
export function pathSeconds(w: World, s: number, bits: number, afterKind = FIRST): number {
  let secs = 0;
  for (let k = afterKind - 1; k >= 0; k -= 1) {
    const l = linkOf(w, s, k);
    if (l < 0) continue;
    const speed = w.compiled.link.speed[l]!;
    secs += (speed > 0 ? bits / speed : Infinity) + w.compiled.link.latencyTicks[l]! * DT_S;
  }
  return secs;
}
