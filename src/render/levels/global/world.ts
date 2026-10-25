// World drawing (mockup levels/global/look-c.js, cleaned): the cached map, the backbone cables
// in the ocean, a sign per region with its pip, each site's AZ halls (the Room level's own minis)
// joined by the data plane, landing stations and the scheduler hub. Lights are real state and
// steady: a link light is on while that link carries a transfer. Nothing moves on its own.
import { BG, P, R, createZoomLink, keyOf, lampState, mix, px, siteSink, silk, silkWidth, smooth, zoomLink } from '../../core';
import type { LevelRegistry, Rect, WorldFrame } from '../../core';
import { REGIONS, REGION_IDS } from '../../../game';
import type { GlobalSnapshot, LinkView, SiteView } from '../../../game';
import { drawLayer } from '../rack/art';
import { CELLS, CLIMATE, REGION_SIGNS, SIGN_H, SIZE, TILES, climateOf, hubRect, landing, mapPixel } from './layout';

type G = CanvasRenderingContext2D;
const SHEATH = '#16253a', PLATE = mix(P.void, P.ink, 0.25), DP = mix(P.net, P.ink, 0.45);
const hub: Rect = { x: 0, y: 0, w: 0, h: 0 };
const BASE_PRICE = REGIONS[0].energyPrice;
/** Climate sign per region: "70°F ×1.0" (outside air, energy price against the gateway region's). */
const CLIMATE_SIGNS = REGIONS.map(r => `${r.outsideF}°F ×${(r.energyPrice / BASE_PRICE).toFixed(1)}`);

function drawMap(g: G): void {
  for (let y = 0; y < SIZE.h; y++) {
    let x0 = 0, c = mapPixel(0, y);
    for (let x = 1; x <= SIZE.w; x++) {
      const n = x < SIZE.w ? mapPixel(x, y) : '';
      if (n !== c) { R(g, x0, y, x - x0, 1, c); x0 = x; c = n; }
    }
  }
}
/** Region index of a site id, or -1. */
export function regionOfSite(s: GlobalSnapshot, siteId: number): number {
  for (let i = 0; i < s.sites.length; i++) if (s.sites[i].siteId === siteId) return i;
  return -1;
}
export const gatewayIndex = (s: GlobalSnapshot): number => Math.max(0, REGION_IDS.indexOf(s.gateway));

/** A backbone cable from the hub to region r: out along the hub row, then across the ocean. */
export function linkRoute(s: GlobalSnapshot, r: number, out: number[]): number {
  hubRect(gatewayIndex(s), hub);
  const a = landing(r), hx = hub.x + (hub.w >> 1), hy = hub.y + hub.h;
  out[0] = hx; out[1] = hy; out[2] = hx; out[3] = a.y; out[4] = a.x; out[5] = a.y;
  return 3;
}
const route: number[] = [0, 0, 0, 0, 0, 0];
function cable(g: G, x0: number, y0: number, x1: number, y1: number, w: number, core: string): void {
  const x = Math.min(x0, x1), y = Math.min(y0, y1), dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
  R(g, x - 1, y - 1, dx + w + 2, dy + w + 2, P.ink); R(g, x, y, dx + w, dy + w, SHEATH);
  R(g, x, y, dx + 1, dy + 1, core);
}
function drawLink(g: G, s: GlobalSnapshot, L: LinkView, live: boolean): void {
  const r = regionOfSite(s, L.siteId);
  if (r < 0) return;
  linkRoute(s, r, route);
  const w = L.generation >= 3 ? 2 : 1, core = mix(P.net, P.ink, L.generation >= 2 ? 0.3 : 0.5);
  cable(g, route[0], route[1], route[2], route[3], w, core); cable(g, route[2], route[3], route[4], route[5], w, core);
  // the landing station, lit while this link carries a real transfer
  R(g, route[4] - 2, route[5] - 2, 5, 5, P.ink); R(g, route[4] - 1, route[5] - 1, 3, 3, live && L.active ? P.led : P.ledOff);
}
function pip(site: SiteView, paused: boolean): string {
  if (!site.open) return P.ink;
  if (site.siteId === null) return P.ledOff;
  switch (lampState(site.online)) {
    case 'online': return paused ? P.ledOff : P.led;
    case 'switching': return P.amber;
    case 'fault': return P.fault;
    default: return P.lampOff;
  }
}
function drawSign(g: G, i: number, site: SiteView, paused: boolean): void {
  const b = CELLS[i], name = REGION_SIGNS[REGION_IDS[i]], clim = CLIMATE_SIGNS[i], C = CLIMATE[climateOf(REGIONS[i].outsideF)];
  const built = site.siteId !== null, w = Math.max(silkWidth(name) + 6, silkWidth(clim)) + 5;
  R(g, b.x + 1, b.y + 1, w + 2, SIGN_H + 2, P.ink); R(g, b.x + 2, b.y + 2, w, SIGN_H, PLATE);
  // the region pip: the site's lamp (online, switching, fault), dim where it could be built, none if closed
  R(g, b.x + 3, b.y + 4, 3, 3, P.ink); px(g, b.x + 4, b.y + 5, pip(site, paused));
  silk(g, b.x + 9, b.y + 3, name, built ? P.paper : site.open ? P.mute : P.dim);
  silk(g, b.x + 4, b.y + 9, clim, site.open ? mix(C.mark, P.paper, 0.3) : P.dim);
}

export interface GlobalContext { readonly registry: LevelRegistry }
/** Room id inside a 'room:<id>' path key, or -1. No allocation. */
export function roomKeyId(key: string): number {
  if (key.length < 6 || key.charCodeAt(4) !== 58 || !key.startsWith('room')) return -1;
  let id = 0;
  for (let i = 5; i < key.length; i++) { const d = key.charCodeAt(i) - 48; if (d < 0 || d > 9) return -1; id = id * 10 + d; }
  return id;
}
/** World ↔ Room (siteSink): the region whose zone is being entered, and how far it has sunk (0 on the map, 1 inside). */
const dive = { region: -1, p: 0 }, link = createZoomLink();
function diveOf(s: GlobalSnapshot, frame: WorldFrame): typeof dive {
  dive.region = -1; dive.p = 0;
  const l = zoomLink(frame.zoom, keyOf(s), link);
  if (!l || !l.child) return dive;
  const id = roomKeyId(l.child);
  if (id >= 0) for (let i = 0; i < s.sites.length; i++) { const zs = s.sites[i].zones; for (let z = 0; z < zs.length; z++) if (zs[z].roomId === id) dive.region = i; }
  dive.p = siteSink(l, frame.reducedMotion);
  return dive;
}

function drawSite(g: G, i: number, site: SiteView, frame: WorldFrame, ctx: GlobalContext, live: boolean): void {
  const tiles = TILES[i], n = Math.min(3, site.zones.length);
  if (n > 1) {
    const y = tiles[0].y + tiles[0].h + 1, x0 = tiles[0].x + 2, x1 = tiles[n - 1].x + 2;
    R(g, x0 - 1, y - 1, x1 - x0 + 3, 3, P.ink); R(g, x0, y, x1 - x0 + 1, 1, DP);
    if (live && site.dataPlane?.active) { R(g, ((x0 + x1) >> 1) - 1, y - 1, 3, 3, P.ink); px(g, (x0 + x1) >> 1, y, P.led); }
  }
  const room = ctx.registry.has('room') ? ctx.registry.level('room') : null;
  for (let z = 0; z < n; z++) {
    const t = tiles[z], zv = site.zones[z];
    if (room) room.drawMini(g, zv, t, frame);
    else { R(g, t.x, t.y, t.w, t.h, P.ink); R(g, t.x + 1, t.y + 1, t.w - 2, t.h - 2, P.steelLo); }
  }
}

export function drawGlobal(g: G, s: GlobalSnapshot, frame: WorldFrame, ctx: GlobalContext): void {
  drawLayer(g, 'global3:map', SIZE.w, SIZE.h, drawMap);
  const live = !frame.paused, gw = gatewayIndex(s);
  for (let i = 0; i < s.backbone.links.length; i++) drawLink(g, s, s.backbone.links[i], live);
  for (let i = 0; i < CELLS.length && i < s.sites.length; i++) {
    const site = s.sites[i], b = CELLS[i];
    if (!site.open) { const a = g.globalAlpha; g.globalAlpha = a * 0.5; R(g, b.x, b.y, b.w, b.h, P.ink); g.globalAlpha = a; }
    drawSign(g, i, site, frame.paused);
    if (site.siteId !== null) drawSite(g, i, site, frame, ctx, live);
  }
  // the scheduler hub beside the gateway: one LED per backbone link, lit while it carries a transfer
  hubRect(gw, hub);
  R(g, hub.x - 1, hub.y - 1, hub.w + 2, hub.h + 2, P.ink); R(g, hub.x, hub.y, hub.w, hub.h, mix(P.steelLo, P.wafer, 0.3));
  R(g, hub.x, hub.y, hub.w, 1, P.steel); R(g, hub.x + 1, hub.y + 2, hub.w - 2, 1, P.ink);
  for (let i = 0; i < Math.min(4, s.backbone.links.length); i++) px(g, hub.x + 2 + i * 2, hub.y + 5, live && s.backbone.links[i].active ? P.led : P.ledOff);
  if (s.scheduler && live && s.scheduler.lastTarget !== null) px(g, hub.x + hub.w - 2, hub.y + 8, P.amber);
  // World → Room: everything but the entered site sinks into the room's floor colour
  const d = diveOf(s, frame);
  if (d.region >= 0) {
    const a = g.globalAlpha; g.globalAlpha = a * 0.9 * smooth(0, 0.4, d.p); R(g, 0, 0, SIZE.w, SIZE.h, BG.room); g.globalAlpha = a;
    drawSite(g, d.region, s.sites[d.region], frame, ctx, live);
  }
}
