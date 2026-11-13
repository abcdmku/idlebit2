// Board presentation model: which site of the original board each part of a SystemSnapshot sits
// in, and which empty sites are open or still locked. Built once per published snapshot.
import type { BuildSlotView, PartRef, PartView, SystemId, SystemSnapshot } from '../../../game';
import type { Rect } from '../../core';
import { boardOf, siteRect } from './layout';
import type { BoardLayout, SiteType } from './layout';

export type SiteState = 'part' | 'open' | 'locked';
export interface Site {
  readonly type: SiteType;
  readonly index: number;
  /** Ground footprint. */
  readonly f: Rect;
  readonly part: PartView | null;
  readonly state: SiteState;
}
export interface BoardModel {
  readonly b: BoardLayout;
  /** Every site, back to front (by footprint bottom, then x). */
  readonly sites: readonly Site[];
  /** Installed parts by type, in slot order. */
  readonly installed: Readonly<Record<SiteType, readonly Site[]>>;
}

function typeOf(kind: BuildSlotView['kind'] | PartView['kind']): SiteType | null {
  if (kind === 'npu') return 'gpu';
  return kind === 'ram' || kind === 'gpu' || kind === 'drive' || kind === 'cpu' ? kind : null;
}
const models = new WeakMap<SystemSnapshot, BoardModel>();
export function boardModel(s: SystemSnapshot): BoardModel {
  // the board's floorplan follows the free world (layout.ts boardOf): a model is for one plan
  let m = models.get(s);
  if (!m || m.b !== boardOf(s.board)) { m = build(s); models.set(s, m); }
  return m;
}
function build(s: SystemSnapshot): BoardModel {
  const b = boardOf(s.board);
  const parts: Record<SiteType, (PartView | null)[]> = { cpu: [], ram: [], gpu: [], drive: [] };
  for (let i = 0; i < Math.min(s.cpuCount, b.sites.cpu.length); i++) parts.cpu[i] = s.cpu;
  for (const list of [s.ram, s.gpu, s.storage]) for (const p of list) {
    const type = typeOf(p.kind);
    if (type && p.slot < b.sites[type].length) parts[type][p.slot] = p;
  }
  const open = new Set<string>();
  for (const v of s.slots) { const type = typeOf(v.kind); if (type && !v.locked) open.add(`${type}${v.index}`); }
  const sites: Site[] = [];
  const installed: Record<SiteType, Site[]> = { cpu: [], ram: [], gpu: [], drive: [] };
  for (const type of ['cpu', 'ram', 'gpu', 'drive'] as const) {
    b.sites[type].forEach((f, index) => {
      const part = parts[type][index] ?? null;
      const site: Site = { type, index, f, part, state: part ? 'part' : open.has(`${type}${index}`) ? 'open' : 'locked' };
      sites.push(site);
      if (part) installed[type].push(site);
    });
  }
  sites.sort((a, c) => a.f.y + a.f.h - (c.f.y + c.f.h) || a.f.x - c.f.x);
  return { b, sites, installed };
}
export interface AddGroup { readonly site: Site; readonly rect: Rect; readonly members: ReadonlySet<Site> }
const groups = new WeakMap<BoardModel, { ram: AddGroup | null; drive: AddGroup | null }>();
const touches = (a: Rect, c: Rect): boolean => a.x < c.x + c.w && c.x < a.x + a.w && a.y < c.y + c.h && c.y < a.y + a.h;
/**
 * The open RAM or drive sites as one add: every empty slot of a type buys the same next module, so they
 * share one tile, large enough for the UI's name and price. The tile is the box of open sites that covers no
 * other part of the board and holds that text best (the widest, counting a box as no wider than two of its
 * heights; then the largest), cut back to start under an installed part whose footprint it would stand on.
 * Its target is the first open slot. Null when none is open.
 */
export function openGroup(m: BoardModel, type: 'ram' | 'drive'): AddGroup | null {
  let g = groups.get(m);
  if (!g) { g = { ram: group(m, 'ram'), drive: group(m, 'drive') }; groups.set(m, g); }
  return g[type];
}
const union = (a: Rect, c: Rect): Rect => {
  const x = Math.min(a.x, c.x), y = Math.min(a.y, c.y);
  return { x, y, w: Math.max(a.x + a.w, c.x + c.w) - x, h: Math.max(a.y + a.h, c.y + c.h) - y };
};
function group(m: BoardModel, type: 'ram' | 'drive'): AddGroup | null {
  const open = m.sites.filter(s => s.type === type && s.state === 'open').sort((p, q) => p.index - q.index);
  if (!open.length) return null;
  let best: Rect | null = null, bestMembers = new Set<Site>();
  const room = (r: Rect): number => Math.min(r.w, 2 * r.h);
  for (const seed of open) {
    // Grow from each open site, in slot order, while the group's ground stays clear of every other site's.
    const members = new Set<Site>([seed]);
    let ground: Rect = seed.f;
    for (const next of open) {
      if (members.has(next)) continue;
      const grown = union(ground, next.f);
      if (m.sites.some(o => o !== next && !members.has(o) && touches(grown, o.f))) continue;
      members.add(next); ground = grown;
    }
    let box: Rect | null = null;
    for (const s of members) { const r = siteRect(m.b, s.type, s.index); box = box ? union(box, r) : { ...r }; }
    if (!box) continue;
    // (a slot's rect reaches up over what would stand in it: the part in the slot behind keeps its footprint)
    for (const o of m.sites) if (o.state === 'part' && touches(box, o.f) && o.f.y < box.y + box.h / 2) {
      const top = o.f.y + o.f.h + 1;
      if (top > box.y) { box.h -= top - box.y; box.y = top; }
    }
    if (!best || room(box) > room(best) || (room(box) === room(best) && box.w * box.h > best.w * best.h)) { best = box; bestMembers = members; }
  }
  return { site: open[0]!, rect: best!, members: bestMembers };
}
/** The BuildSlotView for an empty site, if the snapshot offers one. */
export function slotOf(s: SystemSnapshot, site: Site): BuildSlotView | null {
  for (const v of s.slots) if (typeOf(v.kind) === site.type && v.index === site.index) return v;
  return null;
}

// Stable PartRefs per system and slot, so hit targets never allocate per frame.
const refs = new Map<string, PartRef>();
export function boardPartRef(system: SystemId, kind: 'cpu' | 'ram' | 'gpu' | 'drive', index = 0): PartRef {
  const key = `${system}:${kind}:${index}`;
  let ref = refs.get(key);
  if (!ref) {
    const slot: PartRef['slot'] = kind === 'cpu' ? { kind: 'cpu', socket: index } : { kind, index };
    ref = { unit: { kind: 'system', id: system }, slot }; refs.set(key, ref);
  }
  return ref;
}
/** Tray item ids the UI may hold in `ViewPresentation.picked`, by board site type. */
export function pickedType(picked: string | null): SiteType | null {
  if (picked === 'npu') return 'gpu';
  if (picked === 'cpu' || picked === 'ram' || picked === 'gpu' || picked === 'drive') return picked;
  if (picked === 'storage' || picked === 'stor') return 'drive';
  return null;
}
