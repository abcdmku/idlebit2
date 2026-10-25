import { G } from '../core/buffers';
import { MAX_UPS, MAX_ZONES_PER_SITE, RACKS_PER_ROOM, REGIONS, TICK_MS } from '../core/constants';
import { REGION_IDS } from '../types/catalog';
import { roomId, siteId, type SiteId } from '../types/ids';
import type { GlobalSnapshot } from '../types/snapshot';
import type { GameState } from '../types/state';
import type { LinkView, SiteView, ZoneView } from '../types/views';
import { containerMode, lbView, ladderHz, probeTimerS, roomProbe, siteProbe, supplyView } from './common';
import { roomDark } from './room';

const linkActive = (state: GameState, link: number): boolean => link >= 0 && (state.hot.link.head[link] ?? -1) >= 0;

/**
 * One zone of a site. Load is the mean PDU usage of its racks and hottest is the hottest rack:
 * O(racks), from hot fields phys keeps (architecture §3.2).
 */
function zoneView(state: GameState, room: number, zone: number): ZoneView & { hottestF: number } {
  const c = state.compiled.room, h = state.hot.room;
  if (room < 0 || c.alive[room] !== 1) return { roomId: null, zone, state: 'empty', tempF: 0, load: 0, upsUsage: 0, hottestF: 0 };
  let load = 0, n = 0, hottest = h.tempF[room] ?? 70;
  for (let i = 0; i < RACKS_PER_ROOM; i += 1) {
    const r = c.racks[room * RACKS_PER_ROOM + i] ?? -1;
    if (r < 0 || state.compiled.rack.alive[r] !== 1) continue;
    load += state.hot.rack.pduUsage[r] ?? 0;
    hottest = Math.max(hottest, state.hot.rack.tempF[r] ?? 70);
    n += 1;
  }
  let ups = 0;
  for (let u = 0; u < MAX_UPS; u += 1) ups = Math.max(ups, h.upsUsage[room * MAX_UPS + u] ?? 0);
  return {
    roomId: roomId(room), zone,
    state: containerMode(state, c.alive[room], c.intent[room], roomDark(state, room), (h.crashed[room] ?? 0) === 1, roomProbe(state, room)),
    tempF: h.tempF[room] ?? 70, load: n > 0 ? load / n : 0, upsUsage: ups, hottestF: hottest,
  };
}

function siteView(state: GameState, regionIndex: number, site: number): SiteView {
  const region = REGIONS[regionIndex]!;
  if (site < 0) {
    return { siteId: null, region: region.id, open: false, online: 'empty', zones: [], grid: null, dataPlane: null,
      energyPrice: region.energyPrice, outsideF: region.outsideF, hottestF: region.outsideF, timerS: null };
  }
  const b = state.build.sites[site]!;
  const c = state.compiled.site, h = state.hot.site;
  const zones: ZoneView[] = [];
  let hottest = region.outsideF, dpActive = false;
  for (let z = 0; z < MAX_ZONES_PER_SITE; z += 1) {
    const room = c.zones[site * MAX_ZONES_PER_SITE + z] ?? -1;
    if (room < 0) continue;
    const { hottestF, ...zv } = zoneView(state, room, z);
    zones.push(zv);
    hottest = Math.max(hottest, hottestF);
    dpActive ||= linkActive(state, c.dpLink[site * MAX_ZONES_PER_SITE + z] ?? -1);
  }
  const failed = (h.gridFailed[site] ?? 0) === 1;
  const probe = siteProbe(state, site);
  return {
    siteId: siteId(site), region: region.id, open: c.opened[site] === 1,
    online: containerMode(state, c.alive[site], c.intent[site], failed, false, probe), zones, timerS: probeTimerS(state, probe),
    grid: supplyView('grid', b.grid, {
      capacityW: c.gridCapW[site] ?? 0, usage: h.gridUsage[site] ?? 0, overTicks: h.gridOverTicks[site] ?? 0, failed,
      rebootTicks: h.gridRebootTicks[site] ?? 0, loss: c.gridLoss[site] ?? 0, capSwitch: b.grid.capped, capFactor: 1,
    }, region.energyPrice),
    dataPlane: {
      generation: b.dataPlane.gen, bitsPerSec: c.dpSpeed[site] || ladderHz(b.dataPlane.k),
      latencyMs: (c.dpLatencyTicks[site] ?? 0) * TICK_MS, active: dpActive,
    },
    energyPrice: region.energyPrice, outsideF: region.outsideF, hottestF: hottest,
  };
}

/** Site index per region (REGION_IDS order), -1 where none is built. */
export function sitesByRegion(state: GameState): Int32Array {
  const out = new Int32Array(REGION_IDS.length).fill(-1);
  const c = state.compiled.site;
  for (let s = 0; s < c.len; s += 1) if (c.alive[s] === 1) out[c.region[s] ?? 0] = s;
  return out;
}

export function globalSnapshot(state: GameState): GlobalSnapshot {
  const bySite = sitesByRegion(state);
  const sites: SiteView[] = [];
  const links: LinkView[] = [];
  let regionsOpen = 0;
  for (let r = 0; r < REGION_IDS.length; r += 1) {
    const s = bySite[r]!;
    const v = siteView(state, r, s);
    sites.push(v);
    if (v.open) regionsOpen += 1;
    const b = s >= 0 ? state.build.sites[s]?.backbone : null;
    if (s < 0 || !b) continue;
    const link = state.compiled.site.backboneLink[s] ?? -1;
    const has = link >= 0 && link < state.compiled.link.len;
    links.push({
      siteId: siteId(s) as SiteId, speedHz: (has ? state.compiled.link.speed[link] : 0) || ladderHz(b.k),
      latencyMs: has ? (state.compiled.link.latencyTicks[link] ?? 0) * TICK_MS : 0, active: linkActive(state, link), generation: b.gen,
    });
  }
  const sched = state.build.global.scheduler;
  const g = state.compiled.global;
  return {
    level: 'global', sites, backbone: { links },
    scheduler: sched ? lbView(sched, {
      strategy: g.lbStrategy[0] ?? 0, filters: g.lbFilters[0] ?? 0, placements: g.lbPlacements[0] ?? 0,
      reserve: g.reserveOnRoute[0] ?? 0, routed: state.hot.g[G.globalRouted] ?? 0, last: state.hot.g[G.globalLast] ?? -1,
    }) : null,
    regionsOpen, gateway: REGION_IDS[0],
  };
}
