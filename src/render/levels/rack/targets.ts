// Rack children (servers to drill into) and tap targets, in row coordinates (the active rack
// stands at colX(col)). Refs are built once per id and reused: hit-testing allocates nothing.
import { copyRect, resetHitTarget, saveIconRect, setRect } from '../../core';
import type { ChildView, Completion, HitTarget, NodeRef, Rect } from '../../core';
import type { PartRef, RackId, RackSnapshot, SwitchRef, SystemId, UnitRef } from '../../../game';
import {
  CAB_RECT, LAMP, LB_RECT, PLINTH, POWER_CTL_RECT, ROOF_RECT, ROW_COLS, SAVE_AT, SERVER_SLOTS, STRIP_RECT, SWITCH_RECT, UPLINK_JACK,
  BAY_H, PORT_PITCH, READOUT, U0, childRect, colX, portX, serverRect,
} from './layout';
import { isNeighbour, rackCol, rowViews } from './row';
import { addRect, nextFreeServer } from './world';
import { serverLcd } from './sprites';

interface RackRefs {
  readonly node: NodeRef; readonly unit: UnitRef; readonly sw: SwitchRef;
  readonly cooler: PartRef; readonly pdu: PartRef; readonly lb: PartRef; readonly swPart: PartRef; readonly powerCtl: PartRef;
}
const rackRefs = new Map<number, RackRefs>();
function refsOf(id: RackId): RackRefs {
  let r = rackRefs.get(id);
  if (!r) {
    const unit: UnitRef = { kind: 'rack', id };
    r = {
      node: { level: 'rack', id }, unit, sw: { kind: 'rack', id },
      cooler: { unit, slot: { kind: 'rackCooler' } }, pdu: { unit, slot: { kind: 'pdu' } },
      lb: { unit, slot: { kind: 'lb' } }, swPart: { unit, slot: { kind: 'switch' } }, powerCtl: { unit, slot: { kind: 'powerCtl' } },
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

/** The widest payout pop block and its two lines (art px); where it centres from a full sled's x, and in a half cabinet. */
const POP_MAX = 36, POP_H = 16, POP_CX = 93;
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
  // D31: Power control, the last U above the PDU head. Installed, it opens its plate; empty, it is an add site
  // (the UI prints its name and price, or the research it needs, on it).
  t = put('powerCtl', 'part', POWER_CTL_RECT); if (t) { t.part = refs.powerCtl; t.unit = refs.unit; }
  t = put('pdu', 'part', STRIP_RECT); if (t) t.part = refs.pdu;
  t = put('plinth', 'part', PLINTH); if (t) t.part = refs.pdu;
  // the thermostat on the roof: in front of the roof, the same part (the plate holds the setpoint)
  t = put('thermostat', 'part', READOUT); if (t) t.part = refs.cooler;
  t = put('switch', 'part', SWITCH_RECT); if (t) { t.part = refs.swPart; t.sw = refs.sw; }
  // the Switch's west end is the load balancer: its own plate
  t = put('lb', 'part', LB_RECT); if (t) t.part = refs.lb;
  // D35: each switch port is a target (it upgrades on its own), in front of the switch as a whole.
  for (let i = 0; i < Math.min(SERVER_SLOTS, s.switch.ports.length); i++) {
    setRect(scratch, portX(i), SWITCH_RECT.y, PORT_PITCH, SWITCH_RECT.h);
    t = put(PORT_IDS[i]!, 'port', scratch); if (t) { t.sw = refs.sw; t.port = i; t.part = refs.swPart; }
  }
  if (s.switch.uplinks.length > 0) {
    setRect(scratch, UPLINK_JACK.x - 1, SWITCH_RECT.y, UPLINK_JACK.w + 2, SWITCH_RECT.h);
    t = put('uplink', 'port', scratch); if (t) { t.sw = refs.sw; t.port = -1; t.part = refs.swPart; }
  }
  t = put('online', 'unit', lamp); if (t) t.unit = refs.unit;
  if (s.saveable) { t = put('save', 'save', save); if (t) t.unit = refs.unit; }
  const free = nextFreeServer(s);
  // the "+" on the next free sled slot: tapping it buys a server there
  if (free >= 0) { t = put('add:server', 'add', addRect(s, free, scratch)); if (t) { t.slot = free; t.unit = refs.unit; } }
  return sink.n;
}

/** A payout pops on the active rack's sled that ran it; the key is the server slot. */
/** A finished non-final shard empties across its sled's LCD (D25.5); the key is the server slot. */
export function rackShardAnchor(s: RackSnapshot, d: { readonly system: number }, out: Rect): number {
  for (let i = 0; i < s.servers.length; i++) if (s.servers[i].systemId === d.system) {
    serverRect(i, out); serverLcd(out.x + colX(rackCol(s)), out.y, s.servers[i].cores, out); return i;
  }
  return -1;
}
export function rackPayoutAnchor(s: RackSnapshot, c: Completion, out: Rect): number {
  for (let i = 0; i < s.servers.length; i++) if (s.servers[i].systemId === c.system) {
    serverRect(i, out);
    // The sled's right end: its core LEDs, its ear and the PDU strip (a twin's left bay: the divider), where no word
    // stands. The widest pop starts where the display ends and stops at the cabinet's edge. A half row's two sleds
    // share the strip east of the row, clear of the right sled's display. The pop stays in this rect (popInside):
    // the sled's row and, where a row is 12 px, 4 px of the next one, or of the one above on the last row.
    out.x = colX(rackCol(s)) + out.x + POP_CX - POP_MAX / 2; out.w = POP_MAX;
    if (out.y + POP_H > U0 + BAY_H) out.y = U0 + BAY_H - POP_H;
    out.h = POP_H; return i;
  }
  return -1;
}
