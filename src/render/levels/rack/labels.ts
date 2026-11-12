// The rack's words (D2.1, D11): every figure a player reads is the core's crisp body text, never
// 3 × 5 silkscreen. On the art: each sled's state and busy share on its display, the rack's °F on the
// roof, the battery time and awake count on Power control, routes per second on the balancer, PDU
// load on the plinth, and "Add server" on the next free slot. The Switch's port speed, the Balancer's
// strategy and the PDU's watts are name tags: beside a tower, with a leader, where the rest keeps a
// gutter; on the blank panel beside a twin's infrastructure; on a half cabinet's own faceplates.
// Row neighbours carry their °F, PDU load and, when they are not running, their state.
import { ROUTE_NAMES, UNIT_MODES, formatHertz } from '../../../game';
import type { RackSlotView, RackSnapshot, ServerSlotView } from '../../../game';
import { labelTextWidth, payoutCount, typeForScale, typeName, typeOf, wattsText } from '../../core';
import type { LabelTone, LabelWriter, ViewPresentation, WorldFrame } from '../../core';
import { label } from './art';
import { switchSpeeds } from './infra';
import {
  CAB, LB_FACE, LB_LCD, LB_RECT, LCD_DY, NAME_PANEL, OPEN, PDU_LCD, PLINTH, POWER_CTL_RECT, READOUT, ROW_COLS, SERVER_SLOTS, SLED_H, SRV_LCD, SRV_Y, SWITCH_RECT, bayX, colX, plan,
  serverRect, sledDy,
} from './layout';
import { PWR_FACE, awakeCount, batteryText } from './powerCtl';
import { isNeighbour, rackCol, rowViews } from './row';
import { halfShareX, rackDark, serverLook } from './sprites';
import type { ServerLook } from './sprites';
import { addRect, nextFreeServer } from './world';

/** Set by the level's `focus()`: the rest keeps room left of the cabinet for name tags (always on desktop; a wide enough phone). */
export const gutter = { on: true };

const sp = { lo: 0, hi: 0 }, slot = { x: 0, y: 0, w: 0, h: 0 };
const ids = (p: string, n: number): string[] => Array.from({ length: n }, (_, i) => `${p}${i}`);
const SRV = ids('srv', SERVER_SLOTS), BUSY = ids('busy', SERVER_SLOTS), NT = ids('nt', ROW_COLS), NP = ids('np', ROW_COLS), NS = ids('ns', ROW_COLS);
/** The first text column at least 2 art px inside a window that starts at `x`: a multiple of 4, on the text grid at 2. */
const inX = (x: number): number => Math.floor((x + 5) / 4) * 4;
/** "100 kHz", or "100–200 kHz" (one unit when they share it). */
export function speedText(lo: number, hi: number): string {
  const a = formatHertz(lo), b = formatHertz(hi);
  if (a === b) return a;
  const ua = a.slice(a.lastIndexOf(' ')), ub = b.slice(b.lastIndexOf(' '));
  return ua === ub ? `${a.slice(0, a.lastIndexOf(' '))}–${b}` : `${a}–${b}`;
}
export const tempTone = (f: number): LabelTone => (f >= 100 ? 'fault' : f > 80 ? 'warn' : f < 68 ? 'cyan' : 'ok');
const ceil = (v: number | null | undefined): number => Math.max(0, Math.ceil(v ?? 0));

const TIMES = new Map<string, string>();
/** "Parallel ×", built once per name. */
function timesOf(name: string): string {
  let t = TIMES.get(name);
  if (t === undefined) { t = `${name} ×`; TIMES.set(name, t); }
  return t;
}
const watts = { delivered: -1, capacity: -1, text: '', short: '' };
/** The PDU tag's watts, rebuilt only when a whole watt changes. */
function wattsOf(delivered: number, capacity: number): typeof watts {
  const d = Math.round(delivered), c = Math.round(capacity);
  if (d !== watts.delivered || c !== watts.capacity) { watts.delivered = d; watts.capacity = c; watts.short = wattsText(d); watts.text = `${watts.short} of ${wattsText(c)}`; }
  return watts;
}
const line = { text: '', short: '', tone: 'dim' as LabelTone, bold: false };
/** A sled's display line: what it is doing, or why it is not working. `short` is its form for a half sled's display. */
export function serverLine(v: ServerSlotView, look: ServerLook): typeof line {
  line.bold = false; line.short = '';
  switch (look) {
    case 'crash': line.text = 'Crashed'; line.tone = 'fault'; line.bold = true; return line;
    case 'noport': line.text = 'No port'; line.tone = 'warn'; return line;
    case 'offline': line.text = v.state === 'goingOffline' ? label('Stopping ', ceil(v.timerS), ' s') : 'Offline'; if (v.state === 'goingOffline') line.short = label('Stop ', ceil(v.timerS), ' s'); line.tone = v.state === 'goingOffline' ? 'warn' : 'dim'; return line;
    case 'boot': line.text = label('Boot ', ceil(v.timerS), ' s'); line.tone = 'warn'; return line;
    case 'asleep': line.text = 'Asleep'; line.tone = 'dim'; return line;
    case 'waking': line.text = label('Waking ', Math.max(1, ceil((v.wakeMs ?? 0) / 1000)), ' s'); line.short = label('Wake ', Math.max(1, ceil((v.wakeMs ?? 0) / 1000)), ' s'); line.tone = 'warn'; return line;
    case 'paused': line.text = 'Ready'; line.tone = 'dim'; return line;
    case 'out': line.text = 'Off market'; line.short = 'Off'; line.tone = 'dim'; return line;
    default: break;
  }
  if (v.running > 0) { line.text = v.family !== null ? typeName(typeOf(v.family)) : 'Running'; line.short = 'Running'; line.tone = 'name'; }
  else if (v.port?.active) { line.text = 'Receiving'; line.short = 'Loading'; line.tone = 'net'; }
  else { line.text = v.kind === 'storageNode' ? 'Storage' : 'Idle'; line.tone = 'dim'; }
  return line;
}

export function rackLabels(s: RackSnapshot, view: ViewPresentation, frame: WorldFrame, out: LabelWriter): void {
  const ax = colX(rackCol(s)), dark = rackDark(s), type = typeForScale(frame.scale ?? 2), scale = frame.scale ?? 2;
  // roof: the rack's °F, and under it why it is in trouble (crashed, heating toward a crash, throttled)
  if (!dark) {
    const two = s.crashed || s.crashS > 0 || s.eff < 0.995, r = READOUT;
    out.label('temp', ax + r.x + (r.w >> 1), two ? 8 : 12, 'center').text(label('', Math.round(s.tempF), '°F'), tempTone(s.tempF), true);
    if (s.crashed) out.br().text('Halted', 'fault');
    else if (s.crashS > 0) out.br().text(label('Hot ', ceil(s.crashS), ' s'), 'fault');
    else if (two) out.br().text(label('Eff ', Math.round(s.eff * 100), '%'), 'warn');
  }
  const pc = s.powerCtl ?? null, py = POWER_CTL_RECT.y + LCD_DY;
  if (pc && !dark) {
    const b = pc.battery;
    out.label('bat', inX(ax + POWER_CTL_RECT.x + PWR_FACE.lcd.dx), py).text(batteryText(b.secondsLeft, b.chargeJ), b.chargeJ <= 0 ? 'warn' : b.discharging && !frame.paused ? 'ok' : 'dim');
    out.label('awake', inX(ax + POWER_CTL_RECT.x + PWR_FACE.awake.dx), py).text(awakeCount(pc.start.awake, pc.start.total), 'value');
  }
  if (!dark && !frame.paused) {
    const n = Math.round(s.lb.routedPerSec);
    out.label('routes', inX(ax + LB_RECT.x + LB_LCD.dx), LB_FACE.y + LCD_DY).text(n < 1000 ? label('', n, '/s') : `${payoutCount(n)}/s`, n > 0 ? 'cyan' : 'dim');
  }
  pduLine(s, ax, out);
  const half = plan.id === 'half';
  for (let i = 0; i < s.servers.length && i < SERVER_SLOTS; i++) {
    const v = s.servers[i]!;
    if (v.systemId === null) continue;
    const look = serverLook(s, v, frame.paused);
    if (look === 'dark') continue;
    const r = serverRect(i, slot), lx = ax + r.x + SRV_LCD.dx, y = r.y + sledDy() + LCD_DY, l = serverLine(v, look);
    const share = look === 'live' && v.cores > 0 ? label('', Math.round(Math.max(0, Math.min(1, v.load)) * 100), '%') : '';
    if (half) {
      // a half sled: its type's mini (sprites.ts) and the busy share while it runs, else its state, short where the long form is too wide
      const x0 = Math.ceil((lx + 1) / 4) * 4, room = (lx + SRV_LCD.w - 1 - x0) * scale;
      if (look === 'live' && v.running > 0 && v.family !== null) out.label(SRV[i]!, halfShareX(lx), y).text(share, 'value');
      else out.label(SRV[i]!, x0, y).text(l.short && labelTextWidth(l.text, type, l.bold) > room ? l.short : l.text, l.tone, l.bold);
      continue;
    }
    // a full sled: what it runs (and how many, where that fits) on the left of the display, its busy share on the right
    const x0 = inX(lx), x1 = Math.floor((lx + SRV_LCD.w - 1) / 4) * 4, room = (x1 - x0) * scale - 8;
    const busy = v.load > 0.004 || v.running > 0 ? share : '', bw = busy ? labelTextWidth(busy, type) : 0;
    let text = l.text;
    if (look === 'live' && v.running > 1) {
      const many = label(timesOf(text), v.running);
      if (labelTextWidth(many, type) + bw <= room) text = many;
    }
    out.label(SRV[i]!, x0, y).text(text, l.tone, l.bold);
    if (busy && labelTextWidth(text, type, l.bold) + bw <= room) out.label(BUSY[i]!, x1, y, 'right').text(busy, 'value');
  }
  addLine(s, view, ax, out);
  const phone = frame.form === 'phone', vis = frame.visible;
  if (plan.id === 'twin') panelTags(s, ax, dark, out);
  else if (half) faceTags(s, ax, dark, out);
  // a tower's name tags only where the view really shows the gutter left of the cabinet (a scrolled row can cover it)
  // (the widest tag with its leader is about 200 CSS px at 2, the PDU's watts, and 180 at 3)
  else if (gutter.on && (!vis || ax + CAB.x - (phone ? 44 : scale >= 3 ? 60 : 100) >= vis.x)) tags(s, ax, phone, isNeighbour(s, rackCol(s) - 1), out);
  neighbours(s, frame.paused, out);
}

/** The PDU head: load, or the overload seconds, or the reboot countdown after it tripped. */
function pduLine(s: RackSnapshot, ax: number, out: LabelWriter): void {
  const p = s.pdu, x = inX(ax + PLINTH.x + PDU_LCD.dx), y = PLINTH.y + 1;
  if (p.failed) out.label('pduv', x, y).text(label('Reboot ', ceil((p.rebootMs ?? 0) / 1000), ' s'), 'fault', true);
  else if (s.online === 'dark' || s.online === 'standby') out.label('pduv', x, y).text(s.online === 'standby' ? 'Standby' : 'No power', 'dim');
  else if (p.overloadS > 0) out.label('pduv', x, y).text(label('Overload ', ceil(p.overloadS), ' s'), p.usage > 1 ? 'fault' : 'warn', true);
  else {
    out.label('pduv', x, y).text(label('', Math.round(p.usage * 100), '%'), p.usage > 0.9 ? 'warn' : 'ok');
    // a half cabinet has no gutter for the PDU's tag: its watts follow the load on the head's display
    if (plan.id === 'half') out.text(wattsOf(p.deliveredW, p.capacityW).short, 'power');
  }
}
/** The next free slot says what it is; with one build on offer, its price. A DOM buy control on the slot replaces it. */
function addLine(s: RackSnapshot, view: ViewPresentation, ax: number, out: LabelWriter): void {
  const free = nextFreeServer(s);
  if (free < 0 || view.sourceActions?.includes('add:server')) return;
  // east of the site's "+" (world.ts): the name, then the price, on a second line where the site is two units tall,
  // else beside it (a half site: 'Add' and its price)
  const r = addRect(s, free, slot), two = r.h > SLED_H, narrow = r.w < OPEN.w;
  out.label('add', inX(ax + r.x + 14), r.y + sledDy() + LCD_DY).text(narrow ? 'Add' : 'Add server', 'silk', true);
  const q = view.quotes?.quotes;
  let one = -1, n = 0;
  if (q) for (let i = 0; i < q.length; i++) if (q[i]!.action.type === 'addUnit' && !q[i]!.locked) { one = i; n++; }
  if (n === 1 && q![one]!.currency === 'credits') (two ? out.br() : out).icon('credits').text(payoutCount(Number(q![one]!.cost)), q![one]!.affordable ? 'gold' : 'dim');
}
/** Name tags left of the cabinet, each with a leader to its unit. The phone stacks name over value. */
function tags(s: RackSnapshot, ax: number, phone: boolean, beside: boolean, out: LabelWriter): void {
  const x = ax + CAB.x - (phone ? 9 : 5), lx = ax + OPEN.x;
  if (s.powerCtl && !phone && !beside) out.label('power', x, POWER_CTL_RECT.y + LCD_DY, 'right', true).text('Power control', 'name', true).leader(lx, POWER_CTL_RECT.y + 6);
  switchSpeeds(s, sp);
  if (sp.hi > 0) {
    out.label('switch', x, SWITCH_RECT.y + (phone ? -2 : LCD_DY), 'right', true).text('Switch', 'name', true);
    (phone ? out.br() : out).text(speedText(sp.lo, sp.hi), 'net').leader(lx, SWITCH_RECT.y + 6);
  }
  out.label('lb', x, LB_RECT.y + (phone ? 6 : LCD_DY), 'right', true).text('Balancer', 'name', true);
  if (!phone) out.text(ROUTE_NAMES[s.lb.strategy]?.name ?? '', 'value');
  out.leader(lx, LB_RECT.y + 6);
  // a neighbour on that side keeps its own PDU head readable: the watts tag would cover it
  if (beside) return;
  out.label('pdu', x, PLINTH.y + (phone ? -7 : 1), 'right', true).text('PDU', 'name', true);
  const w = wattsOf(s.pdu.deliveredW, s.pdu.capacityW);
  (phone ? out.br() : out).text(phone ? w.short : w.text, 'power').leader(ax + PLINTH.x, PLINTH.y + 5);
}

/** A twin: the names on the blank panel beside each unit, and the PDU's watts on the plinth's second display. */
function panelTags(s: RackSnapshot, ax: number, dark: boolean, out: LabelWriter): void {
  const x = inX(ax + NAME_PANEL.x + 2);
  if (s.powerCtl) out.label('power', x, POWER_CTL_RECT.y + LCD_DY).text('Power control', 'name', true);
  switchSpeeds(s, sp);
  out.label('switch', x, SWITCH_RECT.y + LCD_DY).text('Switch', 'name', true);
  if (sp.hi > 0) out.text(speedText(sp.lo, sp.hi), 'net');
  out.label('lb', x, LB_RECT.y + LCD_DY).text('Balancer', 'name', true).text(ROUTE_NAMES[s.lb.strategy]?.name ?? '', 'value');
  out.label('pdu', inX(ax + bayX(1) + 2), PLINTH.y + 1).text('PDU', 'name', true);
  if (!dark) out.text(wattsOf(s.pdu.deliveredW, s.pdu.capacityW).text, 'power');
}
/** A half cabinet: the Switch and the Balancer carry their name and value on their own faceplate's name line. */
function faceTags(s: RackSnapshot, ax: number, dark: boolean, out: LabelWriter): void {
  const x = inX(ax + OPEN.x + 2);
  switchSpeeds(s, sp);
  out.label('switch', x, SWITCH_RECT.y + LCD_DY).text('Switch', 'name', true);
  if (sp.hi > 0 && !dark) out.text(speedText(sp.lo, sp.hi), 'net');
  out.label('lb', x, LB_RECT.y + LCD_DY).text('Balancer', 'name', true);
  if (!dark) out.text(ROUTE_NAMES[s.lb.strategy]?.name ?? '', 'value');
}

const MODE = UNIT_MODES;
/** A neighbour that is not simply running says so across its first sleds, loud enough to find from the active rack. */
function neighbourState(v: RackSlotView): { text: string; tone: LabelTone } | null {
  if (v.state === 'crashed') return CRASHED;
  if (v.state === 'dark') return NO_POWER;
  if (v.state === 'standby' || v.powered === false) return (v.wakeMs ?? 0) > 0 ? WAKING : STANDBY;
  if (v.state === 'offline' || v.state === 'goingOffline') return OFFLINE;
  if (v.state === 'boot' || v.state === 'cold') return BOOT;
  let crashed = 0;
  for (let i = 0; i < SERVER_SLOTS; i++) if (MODE[v.servers[i] ?? 0] === 'crashed') crashed++;
  if (!crashed) return null;
  SOME.text = label('', crashed, ' crashed');
  return SOME;
}
const SOME: { text: string; tone: LabelTone } = { text: '', tone: 'fault' };
const CRASHED = { text: 'Crashed', tone: 'fault' } as const, NO_POWER = { text: 'No power', tone: 'fault' } as const, STANDBY = { text: 'Standby', tone: 'dim' } as const;
const WAKING = { text: 'Powering on', tone: 'warn' } as const, OFFLINE = { text: 'Offline', tone: 'dim' } as const, BOOT = { text: 'Starting', tone: 'warn' } as const;
function neighbours(s: RackSnapshot, paused: boolean, out: LabelWriter): void {
  const row = rowViews(s);
  if (!row) return;
  for (let c = 0; c < ROW_COLS; c++) {
    if (!isNeighbour(s, c)) continue;
    const v = row[c]!, x = colX(c), lit = v.state !== 'dark' && v.state !== 'standby' && v.powered !== false;
    if (lit) {
      out.label(NT[c]!, x + READOUT.x + (READOUT.w >> 1), 12, 'center').text(label('', Math.round(v.tempF), '°F'), v.tempF > 80 ? tempTone(v.tempF) : 'dim');
      if (!paused) out.label(NP[c]!, inX(x + PLINTH.x + PDU_LCD.dx), PLINTH.y + 1).text(label('', Math.round(v.pduUsage * 100), '%'), v.pduUsage > 1 ? 'fault' : v.pduUsage > 0.9 ? 'warn' : 'dim');
    }
    const st = neighbourState(v);
    if (st) out.label(NS[c]!, x + OPEN.x + (OPEN.w >> 1), SRV_Y + SLED_H + sledDy() + LCD_DY, 'center', true).text(st.text, st.tone, true);
  }
}
