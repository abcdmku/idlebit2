// Rack children (servers to drill into) and tap targets, in row coordinates (the active rack
// stands at colX(col)). Refs are built once per id and reused: hit-testing allocates nothing.
import { copyRect, resetHitTarget, saveIconRect, setRect } from '../../core';
import type { ChildView, HitTarget, NodeRef, Rect } from '../../core';
import type { PartRef, RackId, RackSnapshot, SwitchRef, SystemId, UnitRef } from '../../../game';
import {
  CAB_RECT, HEADER_Y, LAMP, LB_RECT, PLINTH, ROOF_RECT, ROW_COLS, SAVE_AT, SERVER_SLOTS, STRIP_RECT, SWITCH_RECT, UPLINK_JACK, UP_X,
  childRect, colX, portX, serverRect,
} from './layout';
import { isNeighbour, rackCol, rowViews } from './row';
import { nextFreeServer } from './world';

interface RackRefs {
  readonly node: NodeRef; readonly unit: UnitRef; readonly sw: SwitchRef;
  readonly cooler: PartRef; readonly pdu: PartRef; readonly lb: PartRef; readonly swPart: PartRef;
}
const rackRefs = new Map<number, RackRefs>();
function refsOf(id: RackId): RackRefs {
  let r = rackRefs.get(id);
  if (!r) {
    const unit: UnitRef = { kind: 'rack', id };
    r = {
      node: { level: 'rack', id }, unit, sw: { kind: 'rack', id },
      cooler: { unit, slot: { kind: 'rackCooler' } }, pdu: { unit, slot: { kind: 'pdu' } },
      lb: { unit, slot: { kind: 'lb' } }, swPart: { unit, slot: { kind: 'switch' } },
    };
    rackRefs.set(id, r);
  }
  return r;
}
const systemRefs = new Map<number, NodeRef>();
function systemRef(id: SystemId): NodeRef {
  let r = systemRefs.get(id);
  if (!r) { r = { level: 'system', id }; systemRefs.set(id, r); }
  return r;
}

/** One preallocated world rect per server slot: the core resets `world` to null before each call. */
const WORLDS: Rect[] = Array.from({ length: SERVER_SLOTS }, () => ({ x: 0, y: 0, w: 0, h: 0 }));
/** Each server is a child. Tap rect: its row. World rect: the board on its pulled-out sled, where the
 * sled slide-out (sledOut) puts the System world. */
export function rackChildren(s: RackSnapshot, out: ChildView[]): number {
  const ax = colX(rackCol(s));
  let n = 0;
  for (let i = 0; i < s.servers.length && n < out.length; i++) {
    const id = s.servers[i].systemId;
    if (id === null) continue;
    out[n].ref = systemRef(id);
    serverRect(i, out[n].rect); out[n].rect.x += ax;
    const w = childRect(i, WORLDS[i]); w.x += ax; out[n].world = w;
    n++;
  }
  return n;
}

const PORT_IDS = Array.from({ length: SERVER_SLOTS }, (_, i) => `port${i}`), NEIGHBOUR_IDS = Array.from({ length: ROW_COLS }, (_, c) => `rack${c}`);
const save: Rect = saveIconRect(SAVE_AT.x, SAVE_AT.y, { x: 0, y: 0, w: 0, h: 0 });
const lamp: Rect = { x: LAMP.x - 1, y: LAMP.y - 2, w: LAMP.w + 2, h: 6 }, scratch: Rect = { x: 0, y: 0, w: 0, h: 0 };
const sink: { out: HitTarget[]; n: number; owner: NodeRef; ax: number } = { out: [], n: 0, owner: { level: 'global', id: 0 }, ax: 0 };
function put(id: string, kind: HitTarget['kind'], rect: Rect): HitTarget | null {
  if (sink.n >= sink.out.length) return null;
  const t = resetHitTarget(sink.out[sink.n++], id, kind, sink.owner);
  copyRect(rect, t.rect); t.rect.x += sink.ax;
  return t;
}
/** Back to front: neighbours, then the active rack's parts, ports, lamp, save icon and the next free slot. */
export function rackTargets(s: RackSnapshot, out: HitTarget[], from: number): number {
  const refs = refsOf(s.rackId), row = rowViews(s);
  sink.out = out; sink.n = from; sink.owner = refs.node; sink.ax = 0;
  // A neighbour tap makes that rack the active one (the UI sets the focus to `drill`).
  if (row) for (let c = 0; c < ROW_COLS; c++) {
    if (!isNeighbour(s, c)) continue;
    const id = row[c].rackId!, o = refsOf(id);
    copyRect(CAB_RECT, scratch); scratch.x += colX(c);
    const t = put(NEIGHBOUR_IDS[c], 'unit', scratch);
    if (t) { t.unit = o.unit; t.drill = o.node; }
  }
  sink.ax = colX(rackCol(s));
  let t = put('cooler', 'part', ROOF_RECT); if (t) t.part = refs.cooler;
  t = put('pdu', 'part', STRIP_RECT); if (t) t.part = refs.pdu;
  t = put('plinth', 'part', PLINTH); if (t) t.part = refs.pdu;
  t = put('lb', 'part', LB_RECT); if (t) t.part = refs.lb;
  t = put('switch', 'part', SWITCH_RECT); if (t) { t.part = refs.swPart; t.sw = refs.sw; }
  // Port cells span the switch row at the jack pitch, so they win over the switch body.
  for (let i = 0; i < Math.min(SERVER_SLOTS, s.switch.ports.length); i++) {
    setRect(scratch, portX(i) - 1, SWITCH_RECT.y, 6, SWITCH_RECT.h);
    t = put(PORT_IDS[i], 'port', scratch); if (t) { t.sw = refs.sw; t.port = i; t.part = refs.swPart; }
  }
  if (s.switch.uplinks.length > 0) {
    setRect(scratch, UPLINK_JACK.x - 1, SWITCH_RECT.y, UPLINK_JACK.w + 2, SWITCH_RECT.h);
    t = put('uplink', 'port', scratch); if (t) { t.sw = refs.sw; t.port = -1; t.part = refs.swPart; }
  }
  // The pipe's entry (L2 D17): the ceiling uplink above the switch. U anchors the pipe on 'entry'.
  setRect(scratch, UP_X - 1, 0, 3, HEADER_Y);
  t = put('entry', 'port', scratch); if (t) { t.sw = refs.sw; t.port = -1; t.part = refs.swPart; }
  t = put('online', 'unit', lamp); if (t) t.unit = refs.unit;
  if (s.saveable) { t = put('save', 'save', save); if (t) t.unit = refs.unit; }
  const free = nextFreeServer(s);
  if (free >= 0) { t = put('slot', 'slot', serverRect(free, scratch)); if (t) { t.slot = free; t.unit = refs.unit; } }
  return sink.n;
}

/** The active rack's server rect for system `id`, for payout coins. */
export function rackUnitAnchor(s: RackSnapshot, id: SystemId, out: Rect): boolean {
  for (let i = 0; i < s.servers.length; i++) if (s.servers[i].systemId === id) {
    serverRect(i, out); out.x += colX(rackCol(s)); return true;
  }
  return false;
}
