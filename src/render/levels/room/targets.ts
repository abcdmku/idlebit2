// Room children (racks to drill into) and tap targets. Refs are built once per room or rack
// id and reused, so hit-testing every frame allocates nothing.
import { copyRect, resetHitTarget, saveIconRect } from '../../core';
import type { ChildView, HitTarget, NodeRef, Rect } from '../../core';
import type { PartRef, RackId, RoomId, RoomSnapshot, SwitchRef, UnitRef } from '../../../game';
import { roomId as toRoomId } from '../../../game';
import { nextZone, upsCabinets, upsFoot } from './infra';
import { addRackRect, canAddRow, nextFreeSlot } from './world';
import { BOH, COLS, G } from './layout';

interface RoomRefs {
  readonly node: NodeRef; readonly unit: UnitRef; readonly sw: SwitchRef;
  readonly roomSwitch: PartRef; readonly roomLb: PartRef; readonly cooler: PartRef; readonly ups: readonly PartRef[];
}
const roomRefs = new Map<number, RoomRefs>();
export function refsOf(id: RoomId): RoomRefs {
  let r = roomRefs.get(id);
  if (!r) {
    const unit: UnitRef = { kind: 'room', id };
    r = {
      node: { level: 'room', id }, unit, sw: { kind: 'room', id },
      roomSwitch: { unit, slot: { kind: 'roomSwitch' } }, roomLb: { unit, slot: { kind: 'roomLb' } }, cooler: { unit, slot: { kind: 'roomCooler' } },
      ups: [0, 1].map(index => ({ unit, slot: { kind: 'ups' as const, index } })),
    };
    roomRefs.set(id, r);
  }
  return r;
}
const rackRefs = new Map<number, NodeRef>();
function rackRef(id: RackId): NodeRef {
  let r = rackRefs.get(id);
  if (!r) { r = { level: 'rack', id }; rackRefs.set(id, r); }
  return r;
}

/**
 * Each rack taps on its own slot; its world lands on its row's span (R38.1, D17.2): the rack world is its room row,
 * so Room ↔ Rack maps the row span, which lands the active rack on its own slot and neighbours on theirs.
 */
export function roomChildren(s: RoomSnapshot, out: ChildView[]): number {
  let n = 0;
  const RACK_RECTS = G.racks, count = Math.min(s.racks.length, RACK_RECTS.length);
  for (let i = 0; i < count && n < out.length; i++) {
    const id = s.racks[i].rackId;
    if (id === null) continue;
    out[n].ref = rackRef(id); copyRect(RACK_RECTS[i]!, out[n].rect); out[n].world = G.spans[Math.floor(i / COLS)]!;
    n++;
  }
  return n;
}

const UPS_IDS = ['ups0', 'ups1'], CRAC_IDS = ['crac0', 'crac1', 'crac2', 'crac3'];
const save: Rect = { x: 0, y: 0, w: 0, h: 0 }, entry: Rect = { x: 0, y: 0, w: 3, h: 0 };
const upsHit: Rect = { x: 0, y: 0, w: 0, h: 0 }, rowSite: Rect = { x: 0, y: 0, w: 0, h: 0 };

const sink: { out: HitTarget[]; n: number; owner: NodeRef } = { out: [], n: 0, owner: { level: 'global', id: 0 } };
function put(id: string, kind: HitTarget['kind'], rect: Rect): HitTarget | null {
  if (sink.n >= sink.out.length) return null;
  const t = resetHitTarget(sink.out[sink.n++], id, kind, sink.owner); copyRect(rect, t.rect); return t;
}
/** Back to front. Racks are children (drill on tap); the next free slot is the only rack build site. */
export function roomTargets(s: RoomSnapshot, out: HitTarget[], from: number): number {
  const refs = refsOf(s.roomId);
  sink.out = out; sink.n = from; sink.owner = refs.node;
  const cabinets = upsCabinets(s.ups), feeds = Math.max(1, s.ups.length), per = Math.max(1, Math.floor(cabinets / feeds));
  for (let i = 0; i < Math.min(feeds, s.ups.length, 2); i++) {
    const last = Math.min(cabinets, (i + 1) * per) - 1;
    if (last < i * per) continue;
    const a = upsFoot(i * per, cabinets);
    upsHit.x = a.x; upsHit.y = a.y - BOH.z; upsHit.h = a.h + BOH.z; upsHit.w = upsFoot(last, cabinets).x + G.upsW - upsHit.x;
    const t = put(UPS_IDS[i], 'part', upsHit); if (t) t.part = refs.ups[i];
  }
  let t = put('thermo', 'part', G.thermo); if (t) t.part = refs.cooler;
  for (let i = 0; i < G.cracHits.length; i++) { t = put(CRAC_IDS[i]!, 'part', G.cracHits[i]!); if (t) t.part = refs.cooler; }
  // The pipe's entry (Control deck D17): the gateway fibre from the top. U anchors the pipe on 'entry'.
  entry.x = G.gwx - 1; entry.h = G.gateway.y + 4;
  t = put('entry', 'link', entry); if (t) t.unit = refs.unit;
  t = put('netrack', 'part', G.netRect); if (t) { t.part = refs.roomSwitch; t.sw = refs.sw; }
  t = put('roomlb', 'part', G.lb); if (t) t.part = refs.roomLb;
  if (s.saveable) { t = put('save', 'save', saveIconRect(G.save.x, G.save.y, save)); if (t) t.unit = refs.unit; }
  t = put('online', 'unit', G.lampRect); if (t) t.unit = refs.unit;
  const next = nextZone(s), other = next >= 0 ? s.zones[next] : null;
  if (other !== null) {
    const o = refsOf(toRoomId(other));
    t = put('door', 'unit', G.doorHit); if (t) { t.unit = o.unit; t.drill = o.node; }
  }
  const free = nextFreeSlot(s);
  // the "+" on the next rack slot: tapping it buys a rack there
  if (free >= 0) { t = put('add:rack', 'add', addRackRect(s, free, rowSite)); if (t) { t.slot = free; t.unit = refs.unit; } }
  // a full floor that can still grow: the next row's site opens the room's plate, which sells the row
  else if (canAddRow(s)) { t = put('row', 'unit', G.rowSite); if (t) t.unit = refs.unit; }
  return sink.n;
}
