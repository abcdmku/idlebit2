// The room's words (A20, D2.1): crisp body text, never 3 × 5 silkscreen, for every value.
// On the art: the zone's °F on the thermostat; under each rack, on its cold-aisle tile, its °F
// (quiet in the band, amber above 80, red at 100) or, when it is not running, why (Halt, Dark, Off,
// Boot), so a rack in trouble is found from across the hall; "Add rack" with its price in the next
// free slot's site (where the UI prints none on it), "Add row" under the front wall once the floor is full.
// Fixture tags with a 1·N leader: desktop names the network rack and the cooling in the left gutter;
// the phone has no gutters, so the network rack's speed sits on the back wall. The UPS bank is
// tagged above the back wall's east end on both. Values are snapshot fields, formatted.
import { ROUTE_NAMES, formatHertz } from '../../../game';
import type { RackSlotView, RoomSnapshot } from '../../../game';
import { labelTextWidth, payoutCount, typeForScale, whole } from '../../core';
import type { LabelTone, LabelWriter, ViewPresentation, WorldFrame } from '../../core';
import { degrees, label } from '../rack/art';
import { BOH, COLS, G, RACK_PITCH, RACK_W, ROWS_MAX, rowY } from './layout';
import { ZONE_SIGNS, upsCabinets, upsFoot } from './infra';
import { roomPowered } from './state';
import { addRackRect, canAddRow, nextFreeSlot } from './world';

const site = { x: 0, y: 0, w: 0, h: 0 };
const RACK_IDS = Array.from({ length: COLS * ROWS_MAX }, (_, i) => `rack${i}`);
/** Art px between a gutter tag and the hall. */
const GAP = 8;
const ceil = (v: number | null | undefined): number => Math.max(0, Math.ceil(v ?? 0));
const tempTone = (f: number): LabelTone => (f >= 100 ? 'fault' : f > 80 ? 'warn' : 'dim');

export function roomLabels(s: RoomSnapshot, view: ViewPresentation, frame: WorldFrame, out: LabelWriter): void {
  const powered = roomPowered(s), SIGN = G.sign;
  if (powered) {
    const t = G.thermo;
    out.label('temp', t.x + (t.w >> 1), t.y + 1, 'center').text(degrees(s.tempF, '°F'), s.crashed || s.tempF >= 100 ? 'fault' : s.tempF > 80 ? 'warn' : 'ok', true);
  }
  out.label('zone', SIGN.x + (SIGN.w >> 1), SIGN.y + 1, 'center').text(ZONE_SIGNS[s.zone] ?? ZONE_SIGNS[0]!, 'name', true);
  rackLines(s, powered, (frame.scale ?? 2) >= 3, out);
  addLines(s, view, out);
  if (frame.form !== 'phone') gutterTags(s, out);
  else netTag(s, out);
  upsTag(s, frame, out);
}

/** One word under a rack that is not running, else its °F. */
function rackWord(k: RackSlotView): string | null {
  switch (k.state) {
    case 'crashed': return 'Halt';
    case 'dark': return 'Dark';
    case 'offline': case 'goingOffline': case 'standby': return 'Off';
    case 'boot': case 'cold': return 'Boot';
    default: return k.powered === false ? ((k.wakeMs ?? 0) > 0 ? 'Boot' : 'Off') : null;
  }
}
/**
 * Every rack's °F on its tile. At 3 a rack's 45 px pitch holds the degree sign; at 2 (30 px, under the text grid's
 * 8 px snap) it holds the bare figure, which the thermostat's °F above names.
 */
function rackLines(s: RoomSnapshot, powered: boolean, all: boolean, out: LabelWriter): void {
  const RACK_RECTS = G.racks, n = Math.min(s.racks.length, s.rows * COLS, RACK_RECTS.length);
  for (let i = 0; i < n; i++) {
    const k = s.racks[i]!;
    if (k.rackId === null) continue;
    const r = RACK_RECTS[i]!, x = r.x + (r.w >> 1), y = rowY(Math.floor(i / COLS)) + 2, word = rackWord(k);
    if (word) out.label(RACK_IDS[i]!, x, y, 'center').text(word, word === 'Halt' || word === 'Dark' ? 'fault' : word === 'Boot' ? 'warn' : 'dim', word !== 'Off');
    else if (k.pduUsage > 1) out.label(RACK_IDS[i]!, x, y, 'center').text('PDU', 'fault', true);
    else if (powered) out.label(RACK_IDS[i]!, x, y, 'center').text(degrees(k.tempF, all ? '°' : ''), tempTone(k.tempF), k.tempF > 80);
  }
}
/** The next free slot and, with the floor full, the next row: what they are, and the price when one build is on offer. */
function addLines(s: RoomSnapshot, view: ViewPresentation, out: LabelWriter): void {
  const free = nextFreeSlot(s);
  if (free >= 0) {
    if (view.sourceActions?.includes('add:rack')) return;
    // in the site, east of its "+" (world.ts), the name over the price: it covers no rack and no rack's figure.
    // A site under three slots wide (the row's end) keeps the "+" alone.
    const a = addRackRect(s, free, site);
    if (a.w < 3 * RACK_PITCH) return;
    out.label('add', a.x + RACK_W, a.y + 8).text('Add rack', 'silk', true);
    const q = view.quotes?.quotes;
    let one = -1, n = 0;
    if (q) for (let i = 0; i < q.length; i++) if (q[i]!.action.type === 'addUnit' && !q[i]!.locked) { one = i; n++; }
    if (n === 1 && q![one]!.currency === 'credits') out.br().icon('credits').text(payoutCount(Number(q![one]!.cost)), q![one]!.affordable ? 'gold' : 'dim');
  } else if (canAddRow(s)) {
    if (view.sourceActions?.includes('row')) return;
    const r = G.rowSite;
    out.label('row', r.x + (r.w >> 1), r.y + 1, 'center').text('Add row', 'silk', true);
  }
}
function gutterTags(s: RoomSnapshot, out: LabelWriter): void {
  const left = G.x - GAP;
  // QA-25: the room switch's port speed, the value the deck's Net rack row upgrades (the slowest port).
  // The uplink is the pipe's own tag at this level (Fiber), as the rack's is (Uplink).
  const net = G.netRect, speed = portSpeed(s);
  // a short hall's network rack stands at the focus's top, beside the pipe's tags: its tag hangs lower, at the rack's foot
  out.label('net', left, G.id === 'short' ? G.net.y + 6 : net.y + 2, 'right', true).text('Network rack', 'name', true).text(formatHertz(speed), 'net')
    .br().text(ROUTE_NAMES[s.network.lb.strategy]?.name ?? '', 'value').leader(net.x, G.id === 'short' ? G.net.y + 6 : net.y + 6);
  // (and its cooling tag then takes the second west CRAC, clear of that tag)
  const crac = G.cracHits[G.id === 'short' && G.cracHits.length > 2 ? 2 : 0]!;
  out.label('cooling', left, crac.y + 8, 'right', true).text('Cooling', 'name', true)
    .text(label('', Math.round(Math.max(0, Math.min(1, s.cooler.duty)) * 100), '%'), 'cyan');
  if (s.crashed) out.br().text('Halted', 'fault', true);
  else if (s.crashS > 0) out.br().text(label('Hot ', ceil(s.crashS), ' s'), 'fault', true);
  out.leader(crac.x, crac.y + 12);
}
/** Phone: the network rack's port speed on the back wall beside it (a narrow hall: on the sign strip, beside the gateway). */
function netTag(s: RoomSnapshot, out: LabelWriter): void {
  const speed = portSpeed(s), t = G.netTag;
  if (speed > 0) out.label('net', t.x, t.y, 'left', true).text(formatHertz(speed), 'net').leader(t.lx, t.ly);
}
/** The room switch's slowest port speed (0 with no ports). */
export function portSpeed(s: RoomSnapshot): number {
  let hz = 0;
  for (const p of s.network.switch.ports) if (p.speedHz > 0 && (hz === 0 || p.speedHz < hz)) hz = p.speedHz;
  return hz;
}
function upsTag(s: RoomSnapshot, frame: WorldFrame, out: LabelWriter): void {
  let usage = 0, failed = s.ups.length > 0, over = 0;
  for (const u of s.ups) { usage = Math.max(usage, u.usage); failed = failed && u.failed; over = Math.max(over, u.failed ? 0 : u.overloadS); }
  const n = upsCabinets(s.ups);
  if (!n) return;
  const first = upsFoot(0, n).x, end = upsFoot(n - 1, n).x + G.upsW, top = G.upsY - BOH.z;
  const x = Math.round((first + end) / 2), st = s.power?.start ?? null, phone = frame.form === 'phone';
  const value = failed ? 'No power' : over > 0 ? label('Overload ', ceil(over), ' s') : `${whole(Math.round(usage * 100))}%`;
  const tone: LabelTone = failed || (over > 0 && usage > 1) ? 'fault' : over > 0 || usage > 0.9 ? 'warn' : 'value';
  // D31: the room start controller on the UPS: racks powered now of those it controls
  if (G.id !== 'wide') {
    // no sky above the bank: one line on the wall over it, from the hall's east end ("12/20 on", as the rack's Power control says it)
    out.label('ups', G.ix + G.iw - 2, G.iy - 24, 'right', true).text('UPS', 'name', true).text(value, tone, failed || over > 0);
    if (st) out.text(phone ? `${whole(st.awake)}/${whole(st.total)} on` : `· ${whole(st.awake)}/${whole(st.total)} racks on`, 'value');
    return;
  }
  const racks = st ? `${whole(st.awake)}/${whole(st.total)} racks on` : '', focus = G.focus;
  // A panned hall can cut the bank's tag at the view's edge: it then hangs from that edge, right-aligned, its leader
  // on the bank's first visible cabinet. No bank in view, no tag.
  const scale = frame.scale ?? 2, type = typeForScale(scale), vis = frame.visible, edge = vis ? Math.floor((vis.x + vis.w) / 4) * 4 - 2 : Infinity;
  const wide = (labelTextWidth(`UPS ${value}`, type, true) + (st && !phone ? labelTextWidth(` · ${racks}`, type) : 0)) / scale;
  const cut = x + wide / 2 > edge, lx = cut ? Math.min(x, first + 5) : x;
  if (cut && lx > edge) return;
  // A hall panned down from its top has no sky above the wall: the tag takes the sign strip's east end, one line.
  const low = !!vis && focus.y - 12 < vis.y;
  out.label('ups', cut ? edge : x, low ? G.sign.y + 1 : focus.y - 12, cut ? 'right' : 'center', true).text('UPS', 'name', true);
  out.text(value, tone, failed || over > 0);
  if (st && !(low && phone)) (phone ? out.br() : out.text('·', 'mute')).text(racks, 'value');
  out.leader(lx, top);
}
