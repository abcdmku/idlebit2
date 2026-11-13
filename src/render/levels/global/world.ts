// World drawing: the cached map, the backbone cables from the scheduler hub down each column's
// channel to the sites' landing stations, and a cell per region: a header plate with the site's
// lamp, its AZ halls (the Room level's own minis) on the data plane, and a footer plate for its
// state. Lights are real state and steady: a link light is on while that link carries a transfer.
// Nothing moves on its own. The text is the level's labels (labels.ts).
import { BG, P, R, createZoomLink, dotted, keyOf, lampState, mix, px, siteSink, smooth, zoomLink } from '../../core';
import type { LevelRegistry, Rect, ViewPresentation, WorldFrame } from '../../core';
import { REGION_IDS } from '../../../game';
import type { GlobalSnapshot, LinkView, SiteView } from '../../../game';
import { drawLayer } from '../rack/art';
import { drawWells } from '../rack/flowkit';
import { drawGlobalFlows, drawGlobalForks } from './flows';
import { drawGeneration } from './power';
import { SIGN_H, plan, tilesOf } from './layout';
import type { Path, Plan } from './layout';
import { drawMap } from './map';

type G = CanvasRenderingContext2D;
const SHEATH = '#16253a', PLATE = mix(P.void, P.ink, 0.25), PLATE_HI = mix(PLATE, P.mute, 0.25), DP = mix(P.net, P.ink, 0.45);
const PAD = mix(P.gold, P.ink, 0.35);
/** An open region's card: quieter than a built site's plates. */
const CARD_ALPHA = 0.8, CARD_EDGE = mix(P.dim, P.ink, 0.25);

/** Region index of a site id, or -1. */
export function regionOfSite(s: GlobalSnapshot, siteId: number): number {
  for (let i = 0; i < s.sites.length; i++) if (s.sites[i].siteId === siteId) return i;
  return -1;
}
export const gatewayIndex = (s: GlobalSnapshot): number => Math.max(0, REGION_IDS.indexOf(s.gateway));

function cable(g: G, path: Path, w: number, core: string): void {
  for (let k = 1; k < path.length; k++) {
    const a = path[k - 1]!, b = path[k]!, x = Math.min(a[0], b[0]), y = Math.min(a[1], b[1]), dx = Math.abs(b[0] - a[0]), dy = Math.abs(b[1] - a[1]);
    R(g, x - 1, y - 1, dx + w + 2, dy + w + 2, P.ink);
  }
  for (let k = 1; k < path.length; k++) {
    const a = path[k - 1]!, b = path[k]!, x = Math.min(a[0], b[0]), y = Math.min(a[1], b[1]), dx = Math.abs(b[0] - a[0]), dy = Math.abs(b[1] - a[1]);
    R(g, x, y, dx + w, dy + w, SHEATH); R(g, x, y, dx + 1, dy + 1, core);
  }
}
/** A site's cable and its landing station, lit while the link carries a real transfer. The gateway's feed has no link of its own. */
function drawCable(g: G, p: Plan, r: number, L: LinkView | null, lit: boolean): void {
  const gen = L?.generation ?? 1, path = p.routes[r]!, end = path[path.length - 1]!;
  cable(g, path, gen >= 3 ? 2 : 1, mix(P.net, P.ink, gen >= 2 ? 0.3 : 0.5));
  R(g, end[0] - 2, end[1] - 2, 5, 5, P.ink); R(g, end[0] - 1, end[1] - 1, 3, 3, lit ? P.led : P.ledOff);
}
const PIP_READY = mix(P.led, P.ink, 0.5);
function pip(site: SiteView, paused: boolean): string {
  if (!site.open) return P.ink;
  if (site.siteId === null) return P.ledOff;
  // D31: a site powering on (the global start controller woke it) is amber until it is up
  if (site.wakeMs != null && site.wakeMs > 0) return P.amber;
  switch (lampState(site.online)) {
    // between rounds: dim green when the site runs next round; an off-market site reads 'offline' (lampOff)
    case 'online': return paused ? PIP_READY : P.led;
    case 'switching': return P.amber;
    default: return P.lampOff;
  }
}
function plate(g: G, x: number, y: number, w: number, h: number): void {
  R(g, x - 1, y - 1, w + 2, h + 2, P.ink); R(g, x, y, w, h, PLATE); R(g, x, y, w, 1, PLATE_HI);
}
/** A built site's header plate, with its lamp (online, switching, off). */
function drawSign(g: G, b: Rect, site: SiteView, paused: boolean): void {
  plate(g, b.x, b.y, b.w, SIGN_H);
  R(g, b.x + 2, b.y + 4, 5, 5, P.ink); R(g, b.x + 3, b.y + 5, 3, 3, pip(site, paused));
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
function cross(g: G, cx: number, cy: number, c: string): void {
  R(g, cx - 3, cy - 1, 7, 3, P.ink); R(g, cx - 1, cy - 3, 3, 7, P.ink); R(g, cx - 2, cy, 5, 1, c); R(g, cx, cy - 2, 1, 5, c);
}

/**
 * A site's empty zones in a row are one add (the next zone), like a board's open RAM slots: the run that
 * starts at zone `z`, as its last zone; -1 when `z` is built or inside a run.
 */
export function emptyRun(site: SiteView, z: number, n: number): number {
  const zs = site.zones;
  if (zs[z]!.roomId !== null || (z > 0 && zs[z - 1]!.roomId === null)) return -1;
  let end = z;
  while (end + 1 < n && zs[end + 1]!.roomId === null) end++;
  return end;
}
/**
 * The add plate over the run of empty zones z..end in cell i: from the first empty hall down to the footer,
 * and out to the cell's east edge when the run ends the row, so the UI's name and price fit on it.
 */
export function zoneAddRect(p: Plan, i: number, site: SiteView, z: number, end: number, out: Rect): Rect {
  const tiles = tilesOf(p, i, site), a = tiles[z]!, b = tiles[end]!, cell = p.cells[i]!, before = z > 0 ? tiles[z - 1]! : null;
  // (it starts 1 px after the hall before it)
  out.x = before ? Math.min(a.x, before.x + before.w + 1) : a.x; out.y = a.y;
  out.w = Math.min(p.padMax, (end === tiles.length - 1 ? cell.x + cell.w - 1 : b.x + b.w) - out.x); out.h = cell.y + p.footY - 3 - a.y;
  return out;
}
const add: Rect = { x: 0, y: 0, w: 0, h: 0 };
/** The site's halls on its data plane, which runs from the landing station under every built hall. */
function drawSite(g: G, p: Plan, i: number, site: SiteView, frame: WorldFrame, ctx: GlobalContext, live: boolean, view: ViewPresentation | null = null): void {
  const tiles = tilesOf(p, i, site), n = Math.min(3, site.zones.length), b = p.cells[i]!, y = p.planeY[i]!;
  let halls = 0;
  for (let z = 0; z < n; z++) if (site.zones[z].roomId !== null) halls = z + 1;
  if (halls > 0) {
    const x1 = tiles[halls - 1]!.x + 2;
    R(g, b.x, y - 1, x1 - b.x + 2, 3, P.ink); R(g, b.x, y, x1 - b.x + 1, 1, DP);
    for (let z = 0; z < halls; z++) { const t = tiles[z]!; R(g, t.x + 1, t.y + t.h, 3, 2, P.ink); px(g, t.x + 2, t.y + t.h, DP); px(g, t.x + 2, y, live && site.dataPlane?.active ? P.led : DP); }
  }
  const room = ctx.registry.has('room') ? ctx.registry.level('room') : null;
  for (let z = 0; z < n; z++) {
    const t = tiles[z]!, zv = site.zones[z];
    if (zv.roomId !== null && room) { room.drawMini(g, zv, t, frame); continue; }
    if (zv.roomId !== null) { R(g, t.x, t.y, t.w, t.h, P.ink); R(g, t.x + 1, t.y + 1, t.w - 2, t.h - 2, P.steelLo); continue; }
    // the empty zones: one add plate over the run, like a build pad; its "+" unless the UI prints the add on it
    const end = emptyRun(site, z, n);
    if (end < 0) continue;
    zoneAddRect(p, i, site, z, end, add);
    plate(g, add.x + 1, add.y + 1, add.w - 2, add.h - 2); dotted(g, add.x, add.y, add.w, add.h, PAD);
    if (!view?.sourceActions?.includes(`zone${i}-${z}`)) cross(g, add.x + (add.w >> 1), add.y + (add.h >> 1), P.gold);
  }
}
function veil(g: G, b: Rect, alpha: number): void {
  const a = g.globalAlpha; g.globalAlpha = a * alpha; R(g, b.x - 1, b.y - 1, b.w + 2, b.h + 2, P.ink); g.globalAlpha = a;
}

export function drawGlobal(g: G, s: GlobalSnapshot, frame: WorldFrame, ctx: GlobalContext, view: ViewPresentation | null = null): void {
  const p = plan(), live = !frame.paused, gw = gatewayIndex(s);
  drawLayer(g, `global5:${p.key}`, p.size.w, p.size.h, c => drawMap(c, p), p.size.x, p.size.y);
  // the gateway's feed, then each backbone link
  const gate = s.sites[gw];
  if (gate && gate.siteId !== null) drawCable(g, p, gw, null, live && !!gate.dataPlane?.active);
  for (const L of s.backbone.links) { const r = regionOfSite(s, L.siteId); if (r >= 0 && r !== gw) drawCable(g, p, r, L, live && L.active); }
  let shut = false;
  for (let i = 0; i < p.cells.length && i < s.sites.length; i++) {
    const site = s.sites[i], b = p.cells[i]!, built = site.siteId !== null;
    if (built) {
      drawSign(g, b, site, frame.paused);
      drawSite(g, p, i, site, frame, ctx, live, view);
      plate(g, b.x, b.y + p.footY - 1, b.w, 8 * p.lines + 2);
    } else if (p.lock && !site.open) {
      // (a closed region on the list is a line of the plate drawn below)
    } else {
      // a region without a site is one quiet card, its ground showing through: the name and climate over the build
      // pad, which is clear for the UI's name and then its price, or the research that opens the region. An open
      // region's pad carries a "+" where the UI prints nothing on it; a closed one is dimmer and has no lamp.
      const pad = p.pads[i]!, a = g.globalAlpha;
      g.globalAlpha = a * CARD_ALPHA; R(g, b.x, b.y, b.w, b.h, PLATE); g.globalAlpha = a;
      dotted(g, b.x, b.y, b.w, b.h, CARD_EDGE);
      if (site.open || !p.legend) { R(g, b.x + 2, b.y + 4, 5, 5, P.ink); R(g, b.x + 3, b.y + 5, 3, 3, pip(site, frame.paused)); }
      // a closed region on the grid keeps its name and climate under a lock; the legend says what opens it, once
      if (!site.open) { veil(g, b, 0.3); if (p.legend) { shut = true; smallLock(g, b.x + 1, b.y + 3); } }
      else if (!view?.sourceActions?.includes(`region${i}`)) cross(g, pad.x + (pad.w >> 1), pad.y + (pad.h >> 1), PAD);
    }
    // Between rounds an off-market site (it sits out the next round) is clearly darker, and so is a
    // site the global start controller holds in standby (D31: 0 W) at any time.
    const standby = built && (site.online === 'standby' || site.powered === false);
    if (standby || (frame.paused && built && site.online === 'offline')) veil(g, b, 0.45);
    if (built) drawGeneration(g, b, site.generation, standby);
  }
  if (p.lock) drawLock(g, p.lock);
  else if (shut && p.legend) drawLock(g, p.legend);
  if (live) drawGlobalForks(g, s);
  drawHub(g, p, s, live);
  // D25 shard flows over the cables (none before the sim sends them)
  if (live) drawGlobalFlows(g, s, frame);
  // World → Room: everything but the entered site sinks into the room's floor colour
  const d = diveOf(s, frame);
  if (d.region >= 0) {
    const a = g.globalAlpha; g.globalAlpha = a * 0.9 * smooth(0, 0.4, d.p); R(g, p.size.x, p.size.y, p.size.w, p.size.h, BG.room); g.globalAlpha = a;
    drawSite(g, p, d.region, s.sites[d.region], frame, ctx, live);
  }
}
/**
 * The closed regions' plate (list) or legend (grid): one quiet, dim card with a lock at the east end of its head line,
 * where the UI prints the research that opens them. On the list the regions' names and climates are its lines (labels.ts).
 */
function drawLock(g: G, b: Rect): void {
  const a = g.globalAlpha, x = b.x + b.w - 10, y = b.y + 2;
  g.globalAlpha = a * CARD_ALPHA; R(g, b.x, b.y, b.w, b.h, PLATE); g.globalAlpha = a;
  dotted(g, b.x, b.y, b.w, b.h, CARD_EDGE);
  veil(g, b, 0.3);
  R(g, x, y + 3, 7, 6, P.ink); R(g, x + 1, y + 4, 5, 4, P.mute); px(g, x + 3, y + 5, P.ink); px(g, x + 3, y + 6, P.ink);
  R(g, x + 1, y, 5, 3, P.ink); R(g, x + 2, y + 1, 1, 2, P.mute); R(g, x + 4, y + 1, 1, 2, P.mute); R(g, x + 2, y + 1, 3, 1, P.mute);
}
/** A closed cell's lock, 5 × 7, where an open region has its lamp. */
function smallLock(g: G, x: number, y: number): void {
  R(g, x + 1, y, 3, 1, P.mute); R(g, x + 1, y + 1, 1, 2, P.mute); R(g, x + 3, y + 1, 1, 2, P.mute);
  R(g, x, y + 3, 5, 4, P.mute); R(g, x + 2, y + 4, 1, 2, P.ink);
}
/** The scheduler hub: its router queue's wells, and one LED per backbone link, lit while it carries a transfer. */
function drawHub(g: G, p: Plan, s: GlobalSnapshot, live: boolean): void {
  const h = p.hub;
  R(g, h.x - 1, h.y - 1, h.w + 2, h.h + 2, P.ink); R(g, h.x, h.y, h.w, h.h, mix(P.steelLo, P.wafer, 0.3)); R(g, h.x, h.y, h.w, 1, P.steel);
  R(g, h.x + 1, h.y + 2, h.w - 2, 4, P.ink);
  drawWells(g, s.scheduler?.queue ?? null, h.x + 1, h.y + 2, h.w - 2, 4, live);
  for (let i = 0; i < Math.min(5, s.backbone.links.length); i++) px(g, h.x + 2 + i * 2, h.y + 7, live && s.backbone.links[i].active ? P.led : P.ledOff);
  if (s.scheduler && live && s.scheduler.lastTarget !== null) px(g, h.x + h.w - 2, h.y + 7, P.amber);
  R(g, h.x + (h.w >> 1) - 1, h.y + h.h, 3, 1, P.ink);
}
