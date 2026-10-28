// World level (the Control deck World tile): the player's sites, one per region, each with its AZ halls
// (rooms) as Room minis, joined by the site data plane; the backbone from the scheduler hub
// beside the gateway; a pip per region. A full Global redesign may come later; this is the
// mockup's look C, cleaned of decorative motion. Tap a hall to drill into its room.
import { P, R, copyRect, resetHitTarget, setRect } from '../../core';
import type { ChildView, HitTarget, LevelRegistry, LevelRenderer, NodeRef, Rect } from '../../core';
import { siteId as toSiteId } from '../../../game';
import type { GlobalSnapshot, PartRef, RoomId, SiteId, UnitRef } from '../../../game';
import { CELLS, SIGN_H, SIZE, TILES, hubRect, landing } from './layout';
import { drawGlobal, gatewayIndex, regionOfSite } from './world';
import { globalStartTag } from './power';
import { WORLD_SNAP, worldCentre, worldFocus } from './pan';
export { worldPan } from './pan';

const OWNER: NodeRef = { level: 'global', id: 0 };
const roomRefs = new Map<number, NodeRef>();
function roomRef(id: RoomId): NodeRef {
  let r = roomRefs.get(id);
  if (!r) { r = { level: 'room', id }; roomRefs.set(id, r); }
  return r;
}
interface SiteRefs { readonly unit: UnitRef; readonly backbone: PartRef; readonly dataPlane: PartRef; readonly grid: PartRef }
const siteRefs = new Map<number, SiteRefs>();
function siteRefsOf(id: SiteId): SiteRefs {
  let r = siteRefs.get(id);
  if (!r) {
    const unit: UnitRef = { kind: 'site', id };
    r = { unit, backbone: { unit, slot: { kind: 'backbone' } }, dataPlane: { unit, slot: { kind: 'dataPlane' } }, grid: { unit, slot: { kind: 'grid' } } };
    siteRefs.set(id, r);
  }
  return r;
}
const SCHED: PartRef = { unit: { kind: 'global' }, slot: { kind: 'globalScheduler' } };
const SITE_IDS = CELLS.map((_, i) => `site${i}`), REGION_IDS_T = CELLS.map((_, i) => `region${i}`), LINK_IDS = CELLS.map((_, i) => `link${i}`);
const ZONE_IDS = CELLS.map((_, i) => [0, 1, 2].map(z => `zone${i}-${z}`));
const scratch: Rect = { x: 0, y: 0, w: 0, h: 0 };

export function globalChildren(s: GlobalSnapshot, out: ChildView[]): number {
  let n = 0;
  for (let i = 0; i < s.sites.length && i < CELLS.length; i++) {
    const site = s.sites[i];
    if (!site.open || site.siteId === null) continue;
    for (let z = 0; z < Math.min(3, site.zones.length) && n < out.length; z++) {
      const room = site.zones[z].roomId;
      if (room === null) continue;
      out[n].ref = roomRef(room); copyRect(TILES[i][z], out[n].rect); n++;
    }
  }
  return n;
}

export function globalTargets(s: GlobalSnapshot, out: HitTarget[], from: number): number {
  let n = from;
  const put = (id: string, kind: HitTarget['kind'], r: Rect): HitTarget | null => {
    if (n >= out.length) return null;
    const t = resetHitTarget(out[n++], id, kind, OWNER); copyRect(r, t.rect); return t;
  };
  for (let i = 0; i < s.sites.length && i < CELLS.length; i++) {
    const site = s.sites[i], b = CELLS[i];
    setRect(scratch, b.x + 2, b.y + 2, b.w - 4, SIGN_H);
    if (site.siteId !== null) {
      const refs = siteRefsOf(site.siteId), t = put(SITE_IDS[i], 'unit', scratch);
      if (t) t.unit = refs.unit;
      for (const zone of site.zones) if (zone.roomId === null && zone.zone < TILES[i].length) {
        const empty = put(ZONE_IDS[i][zone.zone], 'slot', TILES[i][zone.zone]);
        if (empty) { empty.unit = refs.unit; empty.slot = zone.zone; }
      }
    }
    else if (site.open) { const t = put(REGION_IDS_T[i], 'slot', b); if (t) t.slot = i; }
  }
  for (let i = 0; i < s.backbone.links.length; i++) {
    const L = s.backbone.links[i], r = regionOfSite(s, L.siteId);
    if (r < 0) continue;
    const a = landing(r); setRect(scratch, a.x - 2, a.y - 2, 5, 5);
    const t = put(LINK_IDS[r], 'link', scratch); if (t) t.part = siteRefsOf(toSiteId(L.siteId)).backbone;
  }
  hubRect(gatewayIndex(s), scratch);
  let t = put('hub', 'part', scratch); if (t) t.part = SCHED;
  // The pipe's entry (Control deck D17): the top of the backbone hub. U anchors the pipe on 'entry'.
  setRect(scratch, scratch.x + 4, 0, 3, scratch.y);
  t = put('entry', 'link', scratch); if (t) t.part = SCHED;
  return n;
}

export function createGlobalRenderer(registry: LevelRegistry): LevelRenderer<'global'> {
  const ctx = { registry };
  return {
    id: 'global', name: 'World',
    size: (_s, out) => copyRect(SIZE, out),
    /** The owned sites plus a region of context; the core pans it when it doesn't fit at 2 (A09, pan.ts). */
    focus: (s, _vp, out) => worldFocus(s, out),
    restCentre: (s, out) => worldCentre(s, out),
    panSnap: () => WORLD_SNAP,
    /** The pipe enters at the top of the backbone hub beside the gateway (Control deck D17). */
    entry(s, out) { hubRect(gatewayIndex(s), scratch); out.x = scratch.x + 5; out.y = scratch.y - 1; return out; },
    draw: (g, s, _view, f) => drawGlobal(g, s, f, ctx),
    /** D31: the global start controller's tag (sites on of those it controls). */
    labels: (s, _view, _frame, out) => globalStartTag(s, gatewayIndex(s), out),
    drawMini(g, s: GlobalSnapshot, r) {
      R(g, r.x, r.y, r.w, r.h, P.seaDeep);
      for (let i = 0; i < s.sites.length && i < CELLS.length; i++) if (s.sites[i].siteId !== null) {
        const b = CELLS[i];
        R(g, r.x + Math.round(b.x * r.w / SIZE.w), r.y + Math.round(b.y * r.h / SIZE.h), Math.max(1, Math.round(b.w * r.w / SIZE.w)), Math.max(1, Math.round(b.h * r.h / SIZE.h)), P.land);
      }
    },
    children: globalChildren,
    /** A payout pops on the site that ran it, over its hall tiles; the key is the region cell. */
    payoutAnchor(s, c, out) {
      if (c.site === null || c.site === undefined) return -1;
      for (let i = 0; i < s.sites.length && i < CELLS.length; i++) if (s.sites[i].siteId === c.site) {
        const t = TILES[i], a = t[0], b = t[t.length - 1];
        setRect(out, a.x, a.y, b.x + b.w - a.x, a.h); return i;
      }
      return -1;
    },
    targets: (s, _view, out, from) => globalTargets(s, out, from),
    faults(s, out: Rect[]) {
      let n = 0;
      for (let i = 0; i < s.sites.length && i < CELLS.length && n < out.length; i++) {
        const site = s.sites[i];
        if (site.siteId === null || (site.online !== 'dark' && site.online !== 'crashed')) continue;
        copyRect(TILES[i][0], out[n++]);
      }
      return n;
    },
    icon(g) { R(g, 2, 2, 12, 12, P.ink); R(g, 3, 3, 10, 10, P.sea); R(g, 4, 4, 3, 5, P.land); R(g, 8, 4, 4, 3, P.land); R(g, 9, 9, 3, 3, P.land); },
  };
}
