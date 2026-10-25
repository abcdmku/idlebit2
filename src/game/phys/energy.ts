import { G, LINK_KIND, type CompiledBuffers, type HotBuffers } from '../core/buffers';
import { DT_S, REGIONS } from '../core/constants';
import type { TouchLog } from '../core/touch';
import type { World } from '../core/world';

/**
 * Energy (spec §9.6, §9.8): each site bills its top-level input at its region's price. The ledger
 * multiplies `hot.bill[region]` (W) by dt and the price, through the sub-Credit meter (D2).
 */

/** Router watts: routers have no routing capacity (D12.5), so they draw their idle while powered. */
export const routerW = (idleW: number): number => idleW;

/** Link watts by the supply that feeds them (owner semantics per R16/R25). */
export interface LinkWatts {
  /** Rack switch ports, by rack (PDU). */
  readonly rack: Float64Array;
  /** Room switch ports and rack uplinks, by room (UPS). */
  readonly room: Float64Array;
  /** Data plane links, by site (grid). */
  readonly site: Float64Array;
  /** Backbone links (utility, gateway price). */
  utility: number;
}

/**
 * Incremental link watts (architecture §1.5). A link's watts follow its busy seconds alone, so
 * only links whose busyS moved are re-priced, and only their feeders are re-added, over the
 * feeder's links in ascending link order: the sums are bit-identical to a full pass. Keyed by
 * the hot buffers; compiled buffers are compared by identity (a cold layer, never edited).
 */
interface LinkCache extends LinkWatts {
  readonly compiled: CompiledBuffers;
  readonly busy: Float64Array;
  readonly watts: Float64Array;
  /** Feeder of each link: racks, then rooms, then sites, then the utility; -1 for none. */
  readonly feeder: Int32Array;
  readonly feederAt: Int32Array;
  readonly feederLinks: Int32Array;
  readonly dirty: Uint8Array;
  /** The touch log and tick of the last call: the next tick of the same log may read only the links phase's list. */
  log: TouchLog | null;
  tick: number;
}
const linkCaches = new WeakMap<HotBuffers, LinkCache>();

function linkCache(c: CompiledBuffers): LinkCache {
  const nr = c.rack.len, nm = c.room.len, ns = c.site.len, n = c.link.len, feeders = nr + nm + ns + 1;
  const feeder = new Int32Array(n).fill(-1);
  for (let l = 0; l < n; l += 1) {
    const owner = c.link.owner[l]!;
    switch (c.link.kind[l]) {
      case LINK_KIND.server: if (owner >= 0 && owner < nr) feeder[l] = owner; break;
      case LINK_KIND.rack: { const room = owner >= 0 && owner < nr ? c.rack.room[owner]! : -1; if (room >= 0 && room < nm) feeder[l] = nr + room; break; }
      case LINK_KIND.zone: { const site = owner >= 0 && owner < nm ? c.room.site[owner]! : -1; if (site >= 0 && site < ns) feeder[l] = nr + nm + site; break; }
      default: feeder[l] = feeders - 1;
    }
  }
  const feederAt = new Int32Array(feeders + 1), feederLinks = new Int32Array(n);
  for (let l = 0; l < n; l += 1) if (feeder[l]! >= 0) feederAt[feeder[l]! + 1] += 1;
  for (let f = 0; f < feeders; f += 1) feederAt[f + 1] += feederAt[f]!;
  const fill = feederAt.slice(0, feeders);
  for (let l = 0; l < n; l += 1) { const f = feeder[l]!; if (f >= 0) { feederLinks[fill[f]!] = l; fill[f] += 1; } }
  return {
    compiled: c, busy: new Float64Array(n).fill(NaN), watts: new Float64Array(n), feeder, feederAt, feederLinks,
    dirty: new Uint8Array(feeders).fill(1), log: null, tick: -2,
    rack: new Float64Array(nr), room: new Float64Array(nm), site: new Float64Array(ns), utility: 0,
  };
}

/** Sums every link's watts into its feeder: idle plus load × sending time / dt per channel. */
export function linkWatts(w: World): LinkWatts {
  const c = w.compiled;
  let k = linkCaches.get(w.hot);
  if (!k || k.compiled !== c) { k = linkCache(c); linkCaches.set(w.hot, k); }
  const link = c.link, busy = w.hot.link.busyS;
  const channelsOf = link.channels, idleW = link.idleW, loadW = link.loadW;
  const seen = k.busy, watts = k.watts, feeder = k.feeder, dirty = k.dirty;
  // Within one advance call only the links phase moves busyS, and only on the links it listed.
  const log = w.touch ?? null;
  const listed = log !== null && k.log === log && k.tick === w.tick - 1 && log.linkTick === w.tick;
  const n = listed ? log.linkN : link.len;
  for (let i = 0; i < n; i += 1) {
    const l = listed ? log.linkList[i]! : i;
    const b = busy[l]!;
    if (b === seen[l]) continue;
    seen[l] = b;
    const channels = Math.max(1, channelsOf[l]!);
    const next = idleW[l]! + loadW[l]! * Math.min(1, b / (DT_S * channels));
    if (next === watts[l] && !Number.isNaN(next)) continue;
    watts[l] = next;
    if (feeder[l]! >= 0) dirty[feeder[l]!] = 1;
  }
  k.log = log; k.tick = w.tick;
  const nr = c.rack.len, nm = c.room.len, ns = c.site.len;
  for (let f = 0; f < dirty.length; f += 1) {
    if (dirty[f] !== 1) continue;
    dirty[f] = 0;
    let sum = 0;
    for (let i = k.feederAt[f]!; i < k.feederAt[f + 1]!; i += 1) {
      const v = watts[k.feederLinks[i]!]!;
      if (v !== 0) sum = sum + v;
    }
    if (f < nr) k.rack[f] = sum;
    else if (f < nr + nm) k.room[f - nr] = sum;
    else if (f < nr + nm + ns) k.site[f - nr - nm] = sum;
    else k.utility = sum;
  }
  return k;
}

/** Adds a site's top-level input to its region's bill. */
export function billSite(w: World, site: number, inputW: number): void {
  if (inputW === 0) return;
  const r = w.compiled.site.region[site]!;
  w.hot.bill[r] = w.hot.bill[r]! + inputW;
}

/**
 * Utility-fed parts (global scheduler, backbone links) bill at the gateway's price. They draw
 * while anything in the world does. Returns the watts, also kept in `G.utilityW`.
 */
export function billUtility(w: World, backboneW: number, anyPowered: boolean): number {
  let watts = 0;
  if (anyPowered) {
    const g = w.compiled.global;
    if (g.exists[0] === 1) watts += routerW(g.lbIdleW[0]!);
    watts += backboneW;
  }
  const gateway = w.compiled.site.len > 0 ? w.compiled.site.region[0]! : 0;
  if (watts !== 0) w.hot.bill[gateway] = w.hot.bill[gateway]! + watts;
  w.hot.g[G.utilityW] = watts;
  return watts;
}

/** Credits per joule at a site (spec §3.3). */
export const sitePrice = (w: World, site: number): number => REGIONS[w.compiled.site.region[site]!]!.energyPrice;
