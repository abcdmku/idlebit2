// Room children (racks to drill into) and tap targets. Refs are built once per room or rack
// id and reused, so hit-testing every frame allocates nothing.
import { copyRect, resetHitTarget, saveIconRect } from '../../core';
import type { ChildView, HitTarget, NodeRef, Rect } from '../../core';
import type { PartRef, RackId, RoomId, RoomSnapshot, SwitchRef, UnitRef } from '../../../game';
import { roomId as toRoomId } from '../../../game';
import { nextZone, upsCabinets, cracCount } from './infra';
import { nextFreeSlot } from './world';
import { COLS, CRAC_HITS, DOOR_HIT, GATEWAY, LAMP_RECT, LB_RECT, NET_RECT, RACK, RACK_RECTS, SAVE_AT, THERMO, UPS_HITS, upsIndex } from './layout';

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

/** The rack row a rack's whole world maps onto (D17.2): the rack world is its room row, so Room ↔
 * Rack maps the row span, which lands the active rack on its own slot and neighbours on theirs. */
const ROW_SPANS: Rect[] = Array.from({ length: RACK_RECTS.length / COLS }, (_, r) => ({
  x: RACK_RECTS[r * COLS].x, y: RACK_RECTS[r * COLS].y, w: RACK_RECTS[r * COLS + COLS - 1].x + RACK.w - RACK_RECTS[r * COLS].x, h: RACK.h,
}));
/** Each rack taps on its own slot; its world (the whole row) lands on the row span (R38.1). */
export function roomChildren(s: RoomSnapshot, out: ChildView[]): number {
  let n = 0;
  const count = Math.min(s.racks.length, RACK_RECTS.length);
  for (let i = 0; i < count && n < out.length; i++) {
    const id = s.racks[i].rackId;
    if (id === null) continue;
    out[n].ref = rackRef(id); copyRect(RACK_RECTS[i], out[n].rect); out[n].world = ROW_SPANS[Math.floor(i / COLS)];
    n++;
  }
  return n;
}

const UPS_IDS = ['ups0', 'ups1'], CRAC_IDS = ['crac0', 'crac1', 'crac2', 'crac3'];
const save: Rect = saveIconRect(SAVE_AT.x, SAVE_AT.y, { x: 0, y: 0, w: 0, h: 0 });
const upsHit: Rect = { x: 0, y: 0, w: 0, h: 0 };
const ENTRY: Rect = { x: GATEWAY.x + (GATEWAY.w >> 1) - 1, y: 0, w: 3, h: GATEWAY.y + 4 };

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
    const a = UPS_HITS[upsIndex(i * per, cabinets)], b = UPS_HITS[upsIndex(Math.min(cabinets, (i + 1) * per) - 1, cabinets)];
    if (!a || !b) continue;
    upsHit.x = a.x; upsHit.y = a.y; upsHit.w = b.x + b.w - a.x; upsHit.h = a.h;
    const t = put(UPS_IDS[i], 'part', upsHit); if (t) t.part = refs.ups[i];
  }
  let t = put('thermo', 'part', THERMO); if (t) t.part = refs.cooler;
  for (let i = 0; i < cracCount(s.rows); i++) { t = put(CRAC_IDS[i], 'part', CRAC_HITS[i]); if (t) t.part = refs.cooler; }
  // The pipe's entry (L2 D17): the gateway fibre from the top. U anchors the pipe on 'entry'.
  t = put('entry', 'link', ENTRY); if (t) t.unit = refs.unit;
  t = put('netrack', 'part', NET_RECT); if (t) { t.part = refs.roomSwitch; t.sw = refs.sw; }
  t = put('roomlb', 'part', LB_RECT); if (t) t.part = refs.roomLb;
  if (s.saveable) { t = put('save', 'save', save); if (t) t.unit = refs.unit; }
  t = put('online', 'unit', LAMP_RECT); if (t) t.unit = refs.unit;
  const next = nextZone(s), other = next >= 0 ? s.zones[next] : null;
  if (other !== null) {
    const o = refsOf(toRoomId(other));
    t = put('door', 'unit', DOOR_HIT); if (t) { t.unit = o.unit; t.drill = o.node; }
  }
  const free = nextFreeSlot(s);
  // the "+" on the next rack slot: tapping it buys a rack there
  if (free >= 0) { t = put('add:rack', 'add', RACK_RECTS[free]); if (t) { t.slot = free; t.unit = refs.unit; } }
  return sink.n;
}
