// System value labels (Control deck main.js systemLabels): every installed part carries its size and speed.
// Desktop: two-line labels in the board's side margins, with silkscreen leaders that end on the
// part. Phone: one-line tags on the board beside each part. Values are snapshot fields, formatted.
import { formatHertz, formatSize } from '../../../game';
import type { SystemSnapshot } from '../../../game';
import { P, R, wattsText, whole } from '../../core';
import type { LabelWriter, Rect, WorldForm, WorldFrame } from '../../core';
import { BOARD, PSU, siteRect } from './layout';
import { boardModel } from './model';
import { tierOf } from './memory';
import type { Site } from './model';
import { writeMemoryRows } from './memoryRows';

export type LabelKey = 'cpu' | 'psu' | 'ram' | 'drive' | 'gpu';
export interface PartLabel {
  readonly key: LabelKey;
  readonly name: string;
  readonly value: string;
  readonly phoneValue?: string;
  readonly side: 'L' | 'R';
  /** D26: the tier's use beside the name ("4.1 kb used"), and its spilled bits, which read as a warning. */
  readonly used?: string; readonly spilled?: string;
  /** The part's rect (hit rect union) in board art px. */
  readonly r: Rect;
  /** Desktop: label top and middle line, the label's inner edge and where the leader meets the part. */
  top: number; mid: number; lx: number; end: number;
  /** Phone: tag anchor (left edge, or right edge when `right`). */
  tagX: number; tagY: number; right: boolean;
}

const LAT = 8, ROW = 16, GAP = 2 * LAT, FIRST = 24;
const q4 = (v: number) => Math.round(v / 4) * 4;
function union(sites: readonly Site[], b: Parameters<typeof siteRect>[0]): Rect {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of sites) {
    const r = siteRect(b, s.type, s.index);
    x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y); x1 = Math.max(x1, r.x + r.w); y1 = Math.max(y1, r.y + r.h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
const times = (n: number) => (n > 1 ? ` ×${n}` : '');
/** "16.4 + 8.19 kb" when the sizes share a unit, else "512 b + 8.19 kb" (formatSize). */
export function sizes(bits: readonly number[]): string {
  if (bits.every(n => n === bits[0])) return `${formatSize(bits[0]!)}${times(bits.length)}`;
  const parts = bits.map(formatSize), unit = parts[0]!.slice(parts[0]!.indexOf(' ') + 1);
  if (parts.every(p => p.endsWith(` ${unit}`))) return `${parts.map(p => p.slice(0, p.indexOf(' '))).join(' + ')} ${unit}`;
  return parts.join(' + ');
}

/** A tier's use and spill for its label (D26), from `SystemSnapshot.memory`. */
function tierNote(s: SystemSnapshot, tier: 'ram' | 'disk'): { used?: string; spilled?: string } {
  const t = tierOf(s, tier);
  if (!t) return {};
  // RAM shows its use. On disk every used bit is spilled, so the drive shows only "spilled" (warning).
  if (tier === 'disk') return t.spilledBits > 0 ? { spilled: formatSize(t.spilledBits) } : {};
  return { used: formatSize(t.usedBits) };
}
/** The label values, all read from the snapshot. */
function values(s: SystemSnapshot): Omit<PartLabel, 'top' | 'mid' | 'lx' | 'end' | 'tagX' | 'tagY' | 'right'>[] {
  const m = boardModel(s), b = m.b, out: Omit<PartLabel, 'top' | 'mid' | 'lx' | 'end' | 'tagX' | 'tagY' | 'right'>[] = [];
  const cores = s.chip.cores.length;
  out.push({ key: 'cpu', name: 'CPU', value: `${formatHertz(s.chip.clock.hz)} · ${whole(cores)} ${cores === 1 ? 'core' : 'cores'}${times(s.cpuCount)}`,
    side: 'L', r: siteRect(b, 'cpu', 0) });
  // the system's power supply (user: never "PSU" or "Board PSU")
  out.push({ key: 'psu', name: 'Power supply', value: wattsText(s.psu.capacityW), side: 'R', r: { ...PSU } });
  const ram = m.installed.ram, drive = m.installed.drive, gpu = m.installed.gpu;
  // R40: per-stick capacity and the slowest channel ("16.4 + 16.4 kb · 1 kHz"); per-drive size and IO.
  if (ram.length) {
    const rate = s.rates.ramBits;
    const capacities = ram.map(q => q.part!.capacityBits ?? 0);
    const total = capacities.reduce((sum, n) => sum + n, 0), used = tierOf(s, 'ram')?.usedBits ?? 0;
    out.push({ key: 'ram', name: 'RAM', value: `${formatSize(total)} total · ${formatSize(rate)}/s`,
      phoneValue: `${formatSize(used)} used / ${formatSize(total)}`, side: 'R', r: union(ram, b), ...tierNote(s, 'ram') });
  }
  if (drive.length) {
    const capacity = `${formatSize(s.capacities.storage)} total`, rate = s.rates.ioBits;
    out.push({ key: 'drive', name: 'Drive', value: `${capacity} · ${formatSize(rate)}/s`,
      phoneValue: capacity, side: 'R', r: union(drive, b), ...tierNote(s, 'disk') });
  }
  if (gpu.length) {
    const cards = gpu.map(q => q.part!), stats = cards.flatMap(p => p.gpu ? [p.gpu] : []);
    const models = cards.map(p => p.gpu?.model ?? `NPU L${whole(p.level)}`);
    const same = models.every(model => model === models[0]);
    const phoneValue = same ? `${models[0]}${times(cards.length)}` : models.join(' + ');
    const value = stats.length === cards.length ? same
      ? `${stats[0]!.model} · ${whole(stats[0]!.cores)} cores · ${formatSize(stats[0]!.vramBits)}${times(cards.length)}`
      : `${models.join(' + ')} · ${stats.map(p => whole(p.cores)).join(' + ')} cores · ${sizes(stats.map(p => p.vramBits))}`
      : phoneValue;
    // D26 unifiedMemory: VRAM need beyond the cards, placed in RAM and on disk.
    let spill = 0;
    for (const q of gpu) spill += q.part?.unifiedSpillBits ?? 0;
    out.push({ key: 'gpu', name: stats.length === 0 ? 'NPU' : stats.length === cards.length ? 'GPU' : 'Accelerators', value,
      phoneValue: stats.length === 0 ? phoneValue.replaceAll('NPU ', '') : phoneValue,
      side: 'L', r: union(gpu, b), ...(spill > 0 ? { spilled: formatSize(spill) } : {}) });
  }
  return out;
}

/** The first label top on desktop: below the band and strip at rest (frame.visible), on the lattice. */
export function firstRow(frame: WorldFrame): number {
  const v = frame.visible;
  return v ? Math.max(FIRST, Math.ceil(v.y / LAT) * LAT) : FIRST;
}

function place(list: PartLabel[], form: WorldForm | undefined, first: number): void {
  if (form === 'phone') {
    const top = BOARD.y - 16;
    for (const it of list) {
      const r = it.r;
      it.right = it.key === 'ram' || it.key === 'drive';
      it.tagX = q4(it.right ? r.x + r.w : r.x);
      it.tagY = q4(it.key === 'psu' ? top : it.key === 'ram' ? r.y + r.h : it.key === 'gpu' ? r.y - 10
        : it.key === 'drive' ? BOARD.y + BOARD.h + 4 : r.y + r.h + 2);
    }
    return;
  }
  const boardL = BOARD.x, boardR = BOARD.x + BOARD.w;
  for (const side of ['L', 'R'] as const) {
    let next = first;
    const mine = list.filter(q => q.side === side).sort((a, c) => a.r.y - c.r.y);
    for (const it of mine) {
      let mid = Math.round((it.r.y + it.r.h / 2) / LAT) * LAT;
      mid = Math.min(Math.max(mid, Math.ceil(it.r.y / LAT) * LAT), Math.floor((it.r.y + it.r.h) / LAT) * LAT);
      if (mid - ROW / 2 < next) mid = next + ROW / 2;
      it.top = mid - ROW / 2; it.mid = mid; next = it.top + ROW + LAT;
      it.lx = side === 'L' ? boardL - GAP : boardR + GAP;
      it.end = side === 'L' ? it.r.x : it.r.x + it.r.w;
    }
  }
}

interface Placed { first: number; list: PartLabel[] }
const cache = { desktop: new WeakMap<SystemSnapshot, Placed>(), phone: new WeakMap<SystemSnapshot, Placed>() };
/** Labels for a snapshot and form, placed from row `first` down. Cached per published snapshot. */
export function partLabels(s: SystemSnapshot, form: WorldForm | undefined, first = FIRST): readonly PartLabel[] {
  const map = cache[form === 'phone' ? 'phone' : 'desktop'];
  let entry = map.get(s);
  if (!entry || entry.first !== first) {
    const list = values(s).map(v => ({ ...v, top: 0, mid: 0, lx: 0, end: 0, tagX: 0, tagY: 0, right: false }));
    place(list, form, first); entry = { first, list }; map.set(s, entry);
  }
  return entry.list;
}

/** Desktop leaders: a silk line from the label's inner edge to the part, with a dot on the part. Art. */
export function drawLeaders(g: CanvasRenderingContext2D, s: SystemSnapshot, first = FIRST): void {
  for (const it of partLabels(s, 'desktop', first)) {
    if (it.key === 'ram' || it.key === 'drive') continue;
    const a = Math.min(it.lx, it.end), b = Math.max(it.lx, it.end);
    R(g, a, it.mid, b - a, 1, P.silk); R(g, it.end - 1, it.mid - 1, 3, 3, P.silk);
  }
}

/** Desktop hardware labels stay outside the board. Memory has its own reserved rows. */
export function writeLabels(s: SystemSnapshot, frame: WorldFrame, out: LabelWriter): void {
  writeMemoryRows(s, frame, out);
  const form = frame.form;
  if (form === 'phone') return;
  for (const it of partLabels(s, form, firstRow(frame))) {
    if (it.key === 'ram' || it.key === 'drive') continue;
    const left = it.side === 'L';
    out.label(it.key, left ? it.lx - 3 : it.lx + 3, it.top, left ? 'right' : 'left').text(it.name, 'silk', true);
    if (it.used) out.text(`· ${it.used} used`, 'mute');
    if (it.spilled) out.text(`· ${it.spilled} spilled`, 'warn');
    out.br().text(it.value, 'value');
  }
}
