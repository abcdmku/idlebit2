// World level: the map of the eight regions, sized to the free world it is given (layout.ts). Each
// region shows its name, outside air and power price; a built site adds its AZ halls (rooms) as
// Room minis on the site data plane and its state; an open region is a build pad. The backbone
// runs from the scheduler hub, where the pipe enters. Tap a hall to drill into its room.
import { P, R, copyRect, resetHitTarget, setRect } from '../../core';
import type { ChildView, HitTarget, LevelRegistry, LevelRenderer, NodeRef, Rect } from '../../core';
import { siteId as toSiteId } from '../../../game';
import type { GlobalSnapshot, PartRef, RoomId, SiteId, UnitRef } from '../../../game';
import { SIGN_H, plan, planFor, tilesOf, usePlan } from './layout';
import { drawGlobal, emptyRun, regionOfSite, zoneAddRect } from './world';
import { globalLabels, popWidth, signOf } from './labels';
import { SEA } from './map';
import { setView, worldCentre } from './pan';
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
const REGION_COUNT = 8, CELLS = Array.from({ length: REGION_COUNT });
const SITE_IDS = CELLS.map((_, i) => `site${i}`), REGION_IDS_T = CELLS.map((_, i) => `region${i}`), LINK_IDS = CELLS.map((_, i) => `link${i}`);
const ZONE_IDS = CELLS.map((_, i) => [0, 1, 2].map(z => `zone${i}-${z}`));
const snap = { x: 0, y: 0 };
const scratch: Rect = { x: 0, y: 0, w: 0, h: 0 };

export function globalChildren(s: GlobalSnapshot, out: ChildView[]): number {
  let n = 0;
  const p = plan();
  for (let i = 0; i < s.sites.length && i < CELLS.length; i++) {
    const site = s.sites[i];
    if (!site.open || site.siteId === null) continue;
    const tiles = tilesOf(p, i, site);
    for (let z = 0; z < Math.min(3, site.zones.length) && n < out.length; z++) {
      const room = site.zones[z].roomId;
      if (room === null) continue;
      out[n].ref = roomRef(room); copyRect(tiles[z]!, out[n].rect); n++;
    }
  }
  return n;
}

export function globalTargets(s: GlobalSnapshot, out: HitTarget[], from: number): number {
  let n = from;
  const p = plan();
  const put = (id: string, kind: HitTarget['kind'], r: Rect): HitTarget | null => {
    if (n >= out.length) return null;
    const t = resetHitTarget(out[n++], id, kind, OWNER); copyRect(r, t.rect); return t;
  };
  let locked = false;
  for (let i = 0; i < s.sites.length && i < CELLS.length; i++) {
    const site = s.sites[i], b = p.cells[i]!;
    setRect(scratch, b.x, b.y, b.w, SIGN_H);
    if (site.siteId !== null) {
      const refs = siteRefsOf(site.siteId), t = put(SITE_IDS[i], 'unit', scratch);
      if (t) t.unit = refs.unit;
      // the empty zones in a row are one add: one target over the run, at its first zone (world.ts emptyRun)
      const zn = Math.min(site.zones.length, 3);
      for (let z = 0; z < zn; z++) {
        const end = emptyRun(site, z, zn);
        if (end < 0) continue;
        const empty = put(ZONE_IDS[i][z], 'slot', zoneAddRect(p, i, site, z, end, scratch));
        if (empty) { empty.unit = refs.unit; empty.slot = site.zones[z].zone; }
      }
    }
    // the list's closed regions are one target, their plate: the UI prints the research that opens them on its head line
    else if (p.lock && !site.open) {
      const t = locked ? null : put('locked', 'slot', p.lock);
      if (t) { t.slot = i; locked = true; }
    }
    // a region without a site: its build pad (the UI prints the price on an open one; a closed one opens its research)
    else {
      const t = put(REGION_IDS_T[i], 'slot', p.pads[i]!); if (t) t.slot = i;
      // the grid's closed regions share one legend, where the UI prints the research that opens them
      if (!site.open && p.legend && !locked) { const l = put('locked', 'slot', p.legend); if (l) { l.slot = i; locked = true; } }
    }
  }
  for (let i = 0; i < s.backbone.links.length; i++) {
    const L = s.backbone.links[i], r = regionOfSite(s, L.siteId);
    if (r < 0) continue;
    const route = p.routes[r]!, a = route[route.length - 1]!; setRect(scratch, a[0] - 2, a[1] - 2, 5, 5);
    const t = put(LINK_IDS[r], 'link', scratch); if (t) t.part = siteRefsOf(toSiteId(L.siteId)).backbone;
  }
  let t = put('hub', 'part', p.hub); if (t) t.part = SCHED;
  // The pipe's entry (Control deck D17): the top of the backbone hub. U anchors the pipe on 'entry'.
  setRect(scratch, p.hub.x + (p.hub.w >> 1) - 1, 0, 3, p.hub.y);
  t = put('entry', 'link', scratch); if (t) t.part = SCHED;
  return n;
}

export function createGlobalRenderer(registry: LevelRegistry): LevelRenderer<'global'> {
  const ctx = { registry };
  let planned = false;
  return {
    id: 'global', name: 'World', plansAtRest: true,
    // The map takes the callout dock's width too (desktop); a pan shows its place; pops stay on the halls' band.
    spansDock: true, panCue: true, popInside: true,
    size: (_s, out) => copyRect(plan().size, out),
    /** The whole map, planned for the free world; the core pans it by rows where they don't all fit at 2 (pan.ts). */
    focus(s, _vp, out, form, area) {
      // (a call without the area, off the rest path, keeps the last plan)
      if (area || !planned) { setView(area); usePlan(planFor(area, form, s)); planned = true; }
      return copyRect(plan().focus, out);
    },
    restCentre: (s, out) => worldCentre(s, out),
    panSnap() { const p = plan(); snap.x = p.pitchX; snap.y = p.pitchY; return snap; },
    /** The pipe enters at the top of the scheduler hub (Control deck D17). */
    entry(_s, out) { const h = plan().hub; out.x = h.x + (h.w >> 1); out.y = h.y; return out; },
    draw: (g, s, view, f) => drawGlobal(g, s, f, ctx, view),
    labels: (s, _view, frame, out) => globalLabels(s, frame, out),
    drawMini(g, s: GlobalSnapshot, r) {
      const p = plan(), F = p.focus;
      R(g, r.x, r.y, r.w, r.h, SEA);
      for (let i = 0; i < s.sites.length && i < p.cells.length; i++) if (s.sites[i].siteId !== null) {
        const b = p.cells[i]!;
        R(g, r.x + Math.round(b.x * r.w / F.w), r.y + Math.round(b.y * r.h / F.h), Math.max(1, Math.round(b.w * r.w / F.w)), Math.max(1, Math.round(b.h * r.h / F.h)), P.land);
      }
    },
    children: globalChildren,
    /**
     * A payout pops on the site that ran it, in a lane that holds nothing else (popInside: it stays in the
     * lane): the header's free east end, between the climate line and the generation box; else, under a
     * three-line footer, east of the link lines. A cell with neither lane wide enough (labels.ts) pops in
     * the band of its halls. The key is the region cell.
     */
    payoutAnchor(s, c, out) {
      if (c.site === null || c.site === undefined) return -1;
      const p = plan();
      for (let i = 0; i < s.sites.length && i < CELLS.length; i++) if (s.sites[i].siteId === c.site) {
        const site = s.sites[i], cell = p.cells[i]!, sign = signOf(p, i, site);
        if (sign.laneX >= 0) { setRect(out, cell.x + sign.laneX, cell.y, sign.laneW, SIGN_H); return i; }
        const need = sign.type ? popWidth(sign.type, sign.n) : 36;
        if (sign.footX >= 0 && sign.footW >= need) { setRect(out, cell.x + sign.footX, cell.y + p.footY + 8, sign.footW, 16); return i; }
        // no lane wide enough: the band of the site's halls
        const t = tilesOf(p, i, site), top = cell.y + SIGN_H + 1;
        let last = 0;
        for (let z = 0; z < Math.min(3, site.zones.length); z++) if (site.zones[z].roomId !== null) last = z;
        const east = t[last]!.x + t[last]!.w, west = Math.min(t[0]!.x, east - need);
        setRect(out, west, top, east - west, cell.y + p.footY - 2 - top); return i;
      }
      return -1;
    },
    targets: (s, _view, out, from) => globalTargets(s, out, from),
    icon(g) { R(g, 2, 2, 12, 12, P.ink); R(g, 3, 3, 10, 10, P.sea); R(g, 4, 4, 3, 5, P.land); R(g, 8, 4, 4, 3, P.land); R(g, 9, 9, 3, 3, P.land); },
  };
}
