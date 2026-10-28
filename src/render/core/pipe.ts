// The inbound pipe (D10.4, D17): the link that carries tasks from the queue strip into the level.
// It drops from under the head slot (RestFraming.pipe), runs under the strip, and drops into the
// level's entry (LevelRenderer.entry). Drawn by the core in art px at N, so every level meets it the
// same way. A transfer rides it at its real progress; one too short to see is a landing flash (D12.4).
import { formatHertz } from '../../game';
import type { LevelSnapshot, RenderSnapshot, TransferView } from '../../game';
import type { Camera, PixelRatio, RestFraming } from './camera';
import { secondsText } from './format';
import type { Point, Rect } from './geom';
import { LabelBuffer, drawLabels } from './labels';
import type { Typography } from './labels';
import { P } from './palette';
import { bandColor } from './familyIcons';
import { R, packet, pathAt } from './px';

/** Shorter transfers flash at the entry instead of travelling (D12.4). */
export const MIN_VISIBLE_TRANSFER_S = 0.25;
export interface Inbound { name: string; speed: number; transfer: TransferView | null }
const LINK: Readonly<Record<LevelSnapshot['level'], { name: string; kind: TransferView['link'] }>> = {
  chip: { name: 'Pipe', kind: 'pipe' }, system: { name: 'Pipe', kind: 'pipe' }, rack: { name: 'Uplink', kind: 'rack' },
  room: { name: 'Zone link', kind: 'zone' }, global: { name: 'Backbone', kind: 'backbone' },
};
function firstOf(s: RenderSnapshot, kind: TransferView['link']): TransferView | null {
  for (const t of s.feed.transfers) if (t.link === kind) return t;
  return null;
}
/** The active rack's inbound transfer: on its uplink first, else on one of its servers' ports. */
function rackTransfer(s: RenderSnapshot, rack: Extract<LevelSnapshot, { level: 'rack' }>): TransferView | null {
  let port: TransferView | null = null;
  for (const t of s.feed.transfers) {
    if (t.link !== 'rack' && t.link !== 'server') continue;
    let mine = false;
    for (const v of rack.servers) if (v.systemId === t.systemId) { mine = true; break; }
    if (!mine) continue;
    if (t.link === 'rack') return t;
    port ??= t;
  }
  return port;
}
/** D25: the level's own flows on its top link, the travelling shard first (FIFO by shard index). */
function topFlow(f: LevelSnapshot, links: readonly string[]): TransferView | null {
  let best: TransferView | null = null, bestShard = Infinity;
  for (const t of (f as { readonly flows?: readonly (TransferView & { readonly shard?: number })[] }).flows ?? []) {
    if (!links.includes(t.link)) continue;
    if (t.bitsSent > 0) return t;
    if ((t.shard ?? 0) < bestShard) { best = t; bestShard = t.shard ?? 0; }
  }
  return best;
}
const TOP: Readonly<Record<'rack' | 'room' | 'global', readonly string[]>> = { rack: ['uplink', 'rack'], room: ['zone'], global: ['backbone', 'zone'] };
/** The focus level's inbound link: its name, speed and the transfer on it now. Snapshot fields only. */
export function inbound(s: RenderSnapshot, out: Inbound): Inbound {
  const f = s.focus, link = LINK[f.level];
  out.name = link.name; out.transfer = null; out.speed = 0;
  switch (f.level) {
    case 'chip': out.speed = f.pipe?.speed ?? 0; out.transfer = f.pipe?.transfer ?? null; break;
    case 'system': out.speed = f.chip.pipe?.speed ?? 0; out.transfer = (f as { readonly inbound?: TransferView | null }).inbound ?? f.chip.pipe?.transfer ?? null; break;
    case 'rack': out.speed = f.switch.uplinks[0]?.speedHz ?? 0; out.transfer = topFlow(f, TOP.rack) ?? rackTransfer(s, f); break;
    case 'room': out.speed = f.network.switch.uplinks[0]?.speedHz ?? 0; out.transfer = topFlow(f, TOP.room) ?? firstOf(s, link.kind); break;
    case 'global': {
      out.transfer = topFlow(f, TOP.global) ?? firstOf(s, link.kind);
      const bb = f.backbone.links[0];
      if (bb) { out.speed = bb.speedHz; break; }
      // One site, no backbone yet: tasks enter over the gateway site's data plane (its zone links).
      out.name = 'Data plane';
      for (const site of f.sites) if (site.region === f.gateway && site.dataPlane) { out.speed = site.dataPlane.bitsPerSec; break; }
      if (!out.speed && out.transfer) out.speed = out.transfer.speed;
      break;
    }
  }
  return out;
}
/** Fraction of the transfer delivered at presentation time `timeMs`. */
export function transferProgress(t: TransferView, simTimeMs: number, timeMs: number): number {
  if (t.bits <= 0) return 1;
  return Math.max(0, Math.min(1, (t.bitsSent + t.speed * Math.max(0, timeMs - simTimeMs) / 1000) / t.bits));
}

const route: [number, number][] = [[0, 0], [0, 0], [0, 0], [0, 0]];
const at: Point = { x: 0, y: 0 }, link: Inbound = { name: '', speed: 0, transfer: null };
const tags = new LabelBuffer(), screen: Camera = { cx: 0, cy: 0, s: 1 };
const lattice = (v: number, lat: number) => Math.round(v / lat) * lat;
/**
 * Draw the pipe in CSS space. `entry` is the level's entry in CSS px, or null (first drop only). `rest`:
 * the entry snaps to the lattice and the link tags show; a zoom passes false, so the pipe follows the
 * moving entry without tags. Reads only the snapshot and the presentation time.
 */
export function drawPipe(g: CanvasRenderingContext2D, s: RenderSnapshot, timeMs: number, paused: boolean, f: RestFraming,
  vp: Rect, ratio: PixelRatio, entry: Point | null, type: Typography, rest = true, art: Rect | null = null, tagAlpha = 1): void {
  if((s.focus.level==='chip'&&!s.focus.pipe)||(s.focus.level==='system'&&!s.focus.chip.pipe))return;
  const p = f.pipe;
  if (!p) return;
  const n = f.scale, x0 = p.x / n, y0 = p.y / n, ry = p.runY / n;
  let count = 2;
  route[0][0] = x0; route[0][1] = y0; route[1][0] = x0; route[1][1] = ry;
  if (entry) {
    const ex = rest ? lattice(entry.x, f.lattice) / n : Math.round(entry.x / n), ey = rest ? entry.y / n : Math.round(entry.y / n);
    route[2][0] = ex; route[2][1] = ry; count = 3;
    if (ey > ry) { route[3][0] = ex; route[3][1] = ey; count = 4; }
  }
  const pts = route.slice(0, count) as readonly (readonly [number, number])[];
  inbound(s, link);
  const t = link.transfer, live = !paused && !!t;
  g.save(); g.setTransform(ratio.x * n, 0, 0, ratio.y * n, 0, 0);
  g.beginPath(); g.rect(vp.x / n, vp.y / n, vp.w / n, vp.h / n); g.clip();
  for (let i = 1; i < count; i++) seg(g, pts[i - 1], pts[i], P.ink, 2);
  for (let i = 1; i < count; i++) seg(g, pts[i - 1], pts[i], live ? '#9cf0ac' : P.net, 1);
  for (let i = 1; i < count; i++) seg(g, pts[i - 1], pts[i], '#3f8f54', 0);
  const seconds = t && t.speed > 0 ? t.bits / t.speed : 0;
  if (t && live && entry) {
    if (seconds >= MIN_VISIBLE_TRANSFER_S) {
      pathAt(pts, transferProgress(t, s.simTimeMs, timeMs), at); packet(g, at.x, at.y, t.bits, bandColor(t.family));
    } else { const e = pts[count - 1]; R(g, e[0] - 2, e[1] - 6, 4, 6, '#c6f7cf'); }
  }
  g.restore();
  if (!entry || !rest) return;
  // Labels in the left gutter under the run, beside the first drop (Control deck D17, A05): the link and its
  // speed, then the packet tag on the next line, so neither moves with the text. They never touch
  // the focus art (`art`, CSS px): where one line would, each value takes its own line in the gutter.
  tags.clear();
  const speed = formatHertz(link.speed);
  const moving = !!t && live && seconds >= MIN_VISIBLE_TRANSFER_S;
  const secs = moving && t ? secondsText((1 - transferProgress(t, s.simTimeMs, timeMs)) * seconds) : '';
  const spot = pipeTagSpot(p, vp, f, art, type, link.name, speed, secs, tagAt);
  const x = spot.x, y = spot.y;
  // A short phone can have no gutter at all. Keep the physical pipe, but omit its
  // redundant tag instead of printing it over the queue. The pipe plate retains its speed.
  const tagW = spot.stacked ? Math.max(tagWidth(link.name, type), tagWidth(speed, type), moving && spot.packet ? tagWidth(secs, type) : 0)
    : Math.max(tagWidth(`${link.name} ${speed}`, type), moving ? tagWidth(secs, type) : 0);
  const lines = spot.stacked ? 2 + (moving && spot.packet ? 1 : 0) : moving ? 2 : 1;
  if (art && overlaps(x, y, tagW, type.line * lines, art)) return;
  if (!spot.stacked) {
    tags.label('pipe', x, y, 'left', true).text(`${link.name} ${speed}`, 'net');
    if (moving) tags.label('packet', x, y + type.line, 'left', true).text(secs, 'net');
  } else {
    tags.label('pipe', x, y, 'left', true).text(link.name, 'net');
    tags.label('pipe2', x, y + type.line, 'left', true).text(speed, 'net');
    if (moving && spot.packet) {
      tags.label('packet', x, y + 2 * type.line, 'left', true).text(secs, 'net');
    }
  }
  screen.cx = vp.x + vp.w / 2; screen.cy = vp.y + vp.h / 2; screen.s = ratio.x;
  drawLabels(g, tags, screen, vp, ratio, type, tagAlpha);
}
/** Rough CSS width of a label line at the body size (Chakra Petch averages under 0.6 em), plus its backing. */
const tagWidth = (text: string, type: Typography): number => Math.ceil(text.length * type.body * 0.6) + 8;
const tagAt = { x: 0, y: 0, stacked: false, packet: true };
const overlaps = (x: number, y: number, w: number, h: number, r: Rect): boolean => x < r.x + r.w && r.x < x + w && y < r.y + r.h && r.y < y + h;
/**
 * Where the pipe tags go (CSS px): one line each under the run beside the first drop when that
 * clears the art; else each value on its own line, there or at the view's left lattice, wherever
 * the column fits left of the art (without the packet tag if only that is too wide: the packet
 * itself still shows on the pipe); else (no room) the default spot.
 */
export function pipeTagSpot(p: { readonly x: number; readonly runY: number }, vp: Rect, f: RestFraming, art: Rect | null, type: Typography,
  name: string, speed: string, secs: string, out: { x: number; y: number; stacked: boolean; packet: boolean }): { x: number; y: number; stacked: boolean; packet: boolean } {
  const phone = f.form === 'phone';
  out.x = p.x + (phone ? 16 : 24); out.y = p.runY + (phone ? 8 : 24); out.stacked = false; out.packet = !!secs;
  if (!art) return out;
  const lines = secs ? 2 : 1, oneW = Math.max(tagWidth(`${name} ${speed}`, type), secs ? tagWidth(secs, type) : 0);
  if (!overlaps(out.x, out.y, oneW, lines * type.line, art)) return out;
  const linkW = Math.max(tagWidth(name, type), tagWidth(speed, type)), packetW = secs ? tagWidth(secs, type) : 0;
  for (const withPacket of secs ? [true, false] : [false]) {
    const w = withPacket ? Math.max(linkW, packetW) : linkW, h = (withPacket ? 3 : 2) * type.line;
    for (const x of [p.x + (phone ? 16 : 24), vp.x + f.lattice]) {
      if (!overlaps(x, out.y, w, h, art)) { out.x = x; out.stacked = true; out.packet = withPacket; return out; }
    }
  }
  return out;
}
/** One run of the cable: 4 art px wide on its centre line (inset 0 ink, 1 core, 2 shade). */
function seg(g: CanvasRenderingContext2D, a: readonly [number, number], b: readonly [number, number], c: string, layer: number): void {
  const x = Math.min(a[0], b[0]), y = Math.min(a[1], b[1]), w = Math.abs(b[0] - a[0]), h = Math.abs(b[1] - a[1]);
  if (layer === 2) R(g, x - 2, y - 2, w + 4, h + 4, c);
  else if (layer === 1) R(g, x - 1, y - 1, w + 2, h + 2, c);
  else if (h > 0) R(g, x, y - 1, 1, h + 2, c); else R(g, x - 1, y, w + 2, 1, c);
}
