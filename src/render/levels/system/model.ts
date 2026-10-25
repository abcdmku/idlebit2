// Board presentation model: which site of the original board each part of a SystemSnapshot sits
// in, and which empty sites are open or still locked. Built once per published snapshot.
import type { BuildSlotView, PartRef, PartView, SystemId, SystemSnapshot } from '../../../game';
import type { Rect } from '../../core';
import { boardOf } from './layout';
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
  let m = models.get(s);
  if (!m) { m = build(s); models.set(s, m); }
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
/** The BuildSlotView for an empty site, if the snapshot offers one. */
export function slotOf(s: SystemSnapshot, site: Site): BuildSlotView | null {
  for (const v of s.slots) if (typeOf(v.kind) === site.type && v.index === site.index) return v;
  return null;
}

// Stable PartRefs per system and slot, so hit targets never allocate per frame.
const refs = new Map<string, PartRef>();
export function boardPartRef(system: SystemId, kind: 'cpu' | 'psu' | 'ram' | 'gpu' | 'drive', index = 0): PartRef {
  const key = `${system}:${kind}:${index}`;
  let ref = refs.get(key);
  if (!ref) {
    const slot: PartRef['slot'] = kind === 'cpu' ? { kind: 'cpu', socket: index } : kind === 'psu' ? { kind: 'psu' } : { kind, index };
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
