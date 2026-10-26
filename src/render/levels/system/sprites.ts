// System part sprites in 3/4 view (mockup v3 levels/system/sprites.js; the board PSU from
// core/power.js). Each takes a ground footprint from a board site and draws its top face raised
// by z plus a front face. `on` is true only while the part serves a real stage. No fans: nothing
// on a board cools.
import { P, R, bloom, brackets, dotted, frame, mix, prism as prism0, px, silk } from '../../core';
import type { PrismStyle, Rect } from '../../core';
import { DIMM_Z } from './layout';
import type { BoardLayout } from './layout';

type G = CanvasRenderingContext2D;
const top0: Rect = { x: 0, y: 0, w: 0, h: 0 };
/** Board parts stand tall with a deeper shadow than the default. Returns a borrowed top rect. */
const prism = (g: G, x: number, y: number, w: number, h: number, z: number, o: PrismStyle): Rect => prism0(g, x, y, w, h, z, { sx: 3, sy: 3, ...o }, top0);
const LOCK = mix(P.mask, P.silk, 0.3), SLOT = '#14111f';

export function disc(g: G, cx: number, cy: number, r: number, c: string): void {
  g.fillStyle = c;
  for (let dy = -r; dy <= r; dy++) { const hw = Math.floor(Math.sqrt(r * r - dy * dy + r * 0.5)); g.fillRect(cx - hw, cy + dy, hw * 2 + 1, 1); }
}
/** A site the board has but research has not opened: silkscreen corners only. */
export function drawSiteLocked(g: G, r: Rect): void { brackets(g, r.x, r.y, r.w, r.h, LOCK, 3); }

// ---------- CPU ----------
export function drawCpuSocket(g: G, f: Rect): void {
  prism(g, f.x, f.y + 3, f.w, f.h - 3, 3, { top: '#2e2a45', front: '#1d1a30' });
  R(g, f.x + 3, f.y + 2, f.w - 6, f.h - 6, '#1b1830');
  R(g, f.x + f.w - 4, f.y + 6, 2, f.h - 14, P.steel); R(g, f.x + f.w - 4, f.y + 6, 2, 1, P.steelHi);
  R(g, f.x + f.w - 7, f.y + 5, 5, 2, P.steel);
}
/** Researched, empty socket: a bare pad field, lever open. */
export function drawSocketEmpty(g: G, f: Rect): void {
  prism(g, f.x, f.y + 3, f.w, f.h - 3, 3, { top: '#2e2a45', front: '#1d1a30' });
  const x = f.x + 5, y = f.y + 3, w = 36, h = 35;
  R(g, x, y, w, h, '#1b1830');
  for (let j = y + 2; j < y + h - 1; j += 3) for (let i = x + 2; i < x + w - 1; i += 3) px(g, i, j, P.padLo);
  R(g, x, y, 3, 1, P.goldLo); R(g, x, y, 1, 3, P.goldLo);
  R(g, f.x + f.w - 4, f.y + 6, 2, f.h - 14, P.steelLo);
  R(g, f.x + f.w - 4, f.y + 1, 2, 5, P.steel); px(g, f.x + f.w - 4, f.y + 1, P.steelHi);
}
export function drawPackageBody(g: G, pr: Rect, busy: boolean): void {
  if (busy) bloom(g, pr.x, pr.y, pr.w, pr.h + 5, P.op, 0.16 / 0.35);
  prism0(g, pr.x, pr.y + 5, pr.w, pr.h, 5, { top: '#2b2550', front: '#191530', sx: 2, sy: 2 }, top0);
}
export function drawPackageFront(g: G, pr: Rect): void {
  for (let x = pr.x + 2; x < pr.x + pr.w - 2; x += 3) { px(g, x, pr.y + pr.h + 1, P.pad); px(g, x, pr.y + pr.h + 3, P.padLo); }
  R(g, pr.x, pr.y, 3, 1, P.gold); R(g, pr.x, pr.y, 1, 3, P.gold);
}

// ---------- RAM ----------
export function drawDimmSlot(g: G, f: Rect): void {
  R(g, f.x, f.y, f.w, 3, SLOT); for (let x = f.x + 3; x < f.x + f.w - 3; x += 3) px(g, x, f.y + 1, P.padLo);
  R(g, f.x - 1, f.y - 3, 2, 6, P.steel); R(g, f.x + f.w - 1, f.y - 3, 2, 6, P.steel);
}
/** A DIMM standing in its slot; more chips per level. Chips light while it serves a RAM stage. */
export function drawDimm(g: G, f: Rect, level: number, on: boolean): void {
  drawDimmSlot(g, f);
  const x = f.x + 2, w = f.w - 4;
  prism(g, x, f.y + 1, w, 1, DIMM_Z, { top: '#5866a0', front: '#2f3a5c', edge: '#5866a0', sx: 2, sy: 2 });
  const n = 2 + Math.min(4, Math.max(1, level)), cw = 4, gap = Math.floor((w - 4 - n * cw) / Math.max(1, n - 1));
  for (let k = 0; k < n; k++) {
    const cx = x + 2 + k * (cw + gap);
    R(g, cx, f.y - 7, cw, 5, on ? P.ram : '#1f2236');
    if (on) { const a = g.globalAlpha; g.globalAlpha = a * 0.35; R(g, cx - 1, f.y - 8, cw + 2, 7, P.ram); g.globalAlpha = a; }
  }
  R(g, x + 1, f.y, w - 2, 1, P.padLo);
}
export function drawDimmSlotV(g: G, f: Rect): void {
  R(g, f.x, f.y, f.w, f.h, SLOT); for (let y = f.y + 3; y < f.y + f.h - 2; y += 3) px(g, f.x + 1, y, P.padLo);
  R(g, f.x - 1, f.y - 2, f.w + 2, 2, P.steel); R(g, f.x - 1, f.y + f.h, f.w + 2, 2, P.steel);
}
export function drawDimmV(g: G, f: Rect, level: number, on: boolean): void {
  drawDimmSlotV(g, f);
  const t = prism(g, f.x, f.y + 1, f.w, f.h - 2, 7, { top: '#4a5888', front: '#2f3a5c', sx: 2, sy: 2 });
  const tx = t.x, ty = t.y, tw = t.w, th = t.h;
  const n = 2 + Math.min(4, Math.max(1, level)), seg = Math.floor((th - 2) / n);
  for (let k = 0; k < n; k++) R(g, tx + 1, ty + 1 + k * seg, 1, seg - 2, on ? P.ram : '#1f2236');
  if (on) bloom(g, tx, ty, tw, th + 7, P.ram, 0.2 / 0.35);
}

// ---------- GPU ----------
export function drawGpuSlot(g: G, f: Rect): void {
  const y = f.y + 13;
  prism(g, f.x + 4, y, f.w - 8, 4, 3, { top: '#16131f', front: '#0f0d18', sx: 2, sy: 2 });
  R(g, f.x + 8, y - 2, f.w - 16, 1, '#2b2740'); for (let i = f.x + 9; i < f.x + f.w - 9; i += 3) px(g, i, y - 2, P.padLo);
  R(g, f.x + f.w - 8, y - 4, 3, 6, P.steelLo);
}
/** A GPU card lying flat over its slot: passive fins, one VRAM pair per level, a strip lit on GPU stages. */
export function drawGpuCard(g: G, f: Rect, level: number, on: boolean, colour: string): void {
  const n = Math.min(4, Math.max(1, level));
  R(g, f.x + 4, f.y + 1, f.w - 8, 2, SLOT);
  const t = prism(g, f.x + 1, f.y + 6, f.w - 2, f.h - 9, 6, { top: '#3f3a5a', front: '#24203a' });
  const tx = t.x, ty = t.y, tw = t.w, th = t.h;
  for (let x = tx + 3; x < tx + tw - 12; x += 3) R(g, x, ty + 3, 2, th - 5, '#2b2742');
  R(g, tx + tw - 10, ty + 3, 7, th - 5, P.steelLo); R(g, tx + tw - 9, ty + 4, 5, 1, P.steel);
  R(g, tx + 2, ty + 1, tw - 4, 1, on ? colour : mix(colour, P.ink, 0.55));
  const fy = ty + th;
  for (let i = 0; i < n; i++) { R(g, tx + 3 + i * 8, fy + 1, 6, 3, P.ink); R(g, tx + 4 + i * 8, fy + 2, 4, 1, '#3d3858'); }
  R(g, tx + 2, fy + 4, tw - 4, 1, on ? colour : mix(colour, P.ink, 0.6));
  if (on) bloom(g, tx, ty, tw, th + 6, colour, 0.18 / 0.35);
}
export function drawModuleEmpty(g: G, f: Rect): void {
  R(g, f.x + 1, f.y - 4, f.w - 2, f.h - 2, mix(P.mask, SLOT, 0.55));
  R(g, f.x + 5, f.y + 2, f.w - 10, 3, SLOT); R(g, f.x + 5, f.y + f.h - 12, f.w - 10, 3, SLOT);
  for (let x = f.x + 6; x < f.x + f.w - 6; x += 2) { px(g, x, f.y + 3, P.padLo); px(g, x, f.y + f.h - 11, P.padLo); }
  for (const [x, y] of [[f.x + 2, f.y - 3], [f.x + f.w - 4, f.y - 3], [f.x + 2, f.y + f.h - 6], [f.x + f.w - 4, f.y + f.h - 6]] as const) R(g, x, y, 2, 2, P.steelLo);
}
/** Baseboard module with its passive heatsink; HBM stacks by level; the bar lights on GPU stages. */
export function drawModule(g: G, f: Rect, level: number, on: boolean, colour: string): void {
  const n = Math.min(4, Math.max(1, level));
  const t = prism(g, f.x, f.y, f.w, f.h - 6, 6, { top: '#3f3a5a', front: '#24203a' });
  const tx = t.x, ty = t.y, tw = t.w, th = t.h;
  for (let x = tx + 2; x < tx + tw - 2; x += 2) R(g, x, ty + 6, 1, th - 9, '#2b2742');
  R(g, tx + 2, ty + 2, tw - 4, 2, on ? colour : mix(colour, P.ink, 0.55));
  const fy = ty + th;
  for (let i = 0; i < n; i++) R(g, tx + 3 + i * 7, fy + 1, 5, 2, P.ink);
  R(g, tx + 2, fy + 4, tw - 4, 1, on ? colour : mix(colour, P.ink, 0.6));
  if (on) bloom(g, tx, ty, tw, th + 6, colour, 0.18 / 0.35);
}

// ---------- storage ----------
export function drawBayEmpty(g: G, f: Rect): void {
  dotted(g, f.x + 1, f.y - 2, f.w - 2, f.h - 2, mix(P.mask, P.silk, 0.35), 0, 1, 2);
  prism(g, f.x + 6, f.y + f.h - 6, 10, 2, 3, { top: '#2b2a3f', front: '#1d1c2c', sx: 1, sy: 1 });
}
/** A small drive lying flat: platter on top, one activity LED per level, lit on storage stages. */
export function drawDrive(g: G, f: Rect, level: number, on: boolean): void {
  const n = Math.min(4, Math.max(1, level));
  const t = prism(g, f.x + 1, f.y + 4, f.w - 2, f.h - 8, 6, { top: P.steelLo, front: '#3d4060' });
  const tx = t.x, ty = t.y, tw = t.w, th = t.h;
  disc(g, tx + (tw >> 1), ty + (th >> 1), 4, '#4a4e6c'); disc(g, tx + (tw >> 1), ty + (th >> 1), 1, P.steel);
  px(g, tx + 1, ty + 1, P.steel); px(g, tx + tw - 2, ty + th - 2, P.steel);
  const fy = ty + th;
  for (let i = 0; i < n; i++) R(g, tx + 2 + i * 3, fy + 2, 2, 2, on ? P.stor : P.ledOff);
  for (let x = tx + tw - 6; x < tx + tw - 1; x += 2) R(g, x, fy + 1, 1, 4, '#2a2c40');
}
export function drawM2Empty(g: G, f: Rect): void {
  R(g, f.x, f.y - 1, 3, f.h + 1, SLOT); R(g, f.x + f.w - 3, f.y, 3, 3, P.steelLo); px(g, f.x + f.w - 2, f.y + 1, P.ink);
  dotted(g, f.x + 3, f.y - 1, f.w - 6, f.h + 1, mix(P.mask, P.silk, 0.3), 0, 1, 2);
}
export function drawM2(g: G, f: Rect, level: number, on: boolean): void {
  const n = 1 + Math.min(3, Math.max(1, level));
  R(g, f.x, f.y - 1, 3, f.h + 1, SLOT);
  const t = prism(g, f.x + 2, f.y, f.w - 3, f.h - 1, 2, { top: '#2f5246', front: '#1d3a30', sx: 1, sy: 1 });
  const tx = t.x, ty = t.y, tw = t.w, th = t.h;
  R(g, tx + 2, ty + 1, 4, th - 2, P.steelLo);
  for (let i = 0; i < n; i++) R(g, tx + 8 + i * 5, ty + 1, 4, th - 2, P.ink);
  px(g, tx + tw - 3, ty + 1, on ? P.stor : P.ledOff);
  R(g, f.x + f.w - 2, f.y + 1, 2, 2, P.steel);
}

/** Installed and empty sprites per board style. */
export function drawRamPart(g: G, b: BoardLayout, f: Rect, level: number, on: boolean): void { (b.dimm === 'h' ? drawDimm : drawDimmV)(g, f, level, on); }
export function drawGpuPart(g: G, b: BoardLayout, f: Rect, level: number, on: boolean, colour: string): void { (b.dimm === 'h' ? drawGpuCard : drawModule)(g, f, level, on, colour); }
export function drawDrivePart(g: G, b: BoardLayout, f: Rect, level: number, on: boolean): void { (b.dimm === 'h' ? drawDrive : drawM2)(g, f, level, on); }
export function drawEmptySite(g: G, b: BoardLayout, type: 'cpu' | 'ram' | 'gpu' | 'drive', f: Rect): void {
  if (type === 'cpu') drawSocketEmpty(g, f);
  else if (type === 'ram') (b.dimm === 'h' ? drawDimmSlot : drawDimmSlotV)(g, f);
  else if (type === 'gpu') (b.dimm === 'h' ? drawGpuSlot : drawModuleEmpty)(g, f);
  else (b.dimm === 'h' ? drawBayEmpty : drawM2Empty)(g, f);
}

/** D35: where the pipe meets the board, a plain edge connector (gold contacts, lit while a task lands). */
export function drawConnector(g: G, f: Rect, on: boolean): void {
  R(g, f.x, f.y, f.w, f.h, P.ink); R(g, f.x + 1, f.y + 1, f.w - 2, f.h - 2, on ? P.padHi : P.pad);
}
/** Copper cable from the board's connector up to the world's top edge, where the pipe enters. Fades out at the top. */
export function drawCable(g: G, x: number, y0: number, y1: number, lit: boolean): void {
  const a = g.globalAlpha, core = lit ? '#4f8f61' : '#3d3a58', hi = lit ? P.net : '#55517a';
  for (let y = y0; y < y1; y++) {
    g.globalAlpha = a * Math.min(1, (y - y0 + 1) / 14);
    R(g, x - 2, y, 5, 1, P.ink); R(g, x - 1, y, 3, 1, core); px(g, x - 1, y, hi);
  }
  g.globalAlpha = a;
}
/** Board PSU: vents and a usage meter (one LED per step of delivered / capacity). Amber while it warns. */
export function drawPsu(g: G, r: Rect, usage: number, warning: boolean): void {
  const t = prism0(g, r.x, r.y, r.w, r.h, 5, { top: P.steelLo, front: P.substrate, hi: P.steelHi }, top0);
  const tx = t.x, ty = t.y, tw = t.w, th = t.h;
  for (let x = tx + 3; x < tx + tw - 3; x += 4) R(g, x, ty + 2, 2, 3, P.ink);
  R(g, tx + 2, ty + th - 5, tw - 4, 4, P.ink);
  const col = warning ? P.amber : P.led, n = Math.floor((r.w - 4) / 3);
  for (let i = 0; i < n; i++) R(g, tx + 2 + i * 3, ty + th - 4, 2, 2, i / n < usage ? col : P.ledOff);
  if (warning) { frame(g, tx - 2, ty - 2, tw + 4, th + 9, P.amber); silk(g, tx + Math.floor(tw / 2) - 1, ty - 7, '!', P.amber); }
}
