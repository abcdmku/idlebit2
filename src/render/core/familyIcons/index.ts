// Task icons (D23). Every family belongs to a player-facing task type (derived from its catalog
// band). Each type has one colour and a frame silhouette; a family icon is its type's frame with
// the family's glyph on the frame's dark plate. Icons are 16×16 art cells with a baked 1 px ink
// outline, pixel-exact at any integer scale N. Data is generated from ./art (generate.mjs).
import { FAMILIES, familyKey } from '../../../game';
import type { BandId, FamilyId } from '../../../game';
import { ICONS as ACCEL } from './icons-accel';
import { ICONS as CLUSTER } from './icons-cluster';
import { ICONS as COMPUTE } from './icons-compute';
import { ICONS as MEMORY } from './icons-memory';
import { ICONS as PARALLEL } from './icons-parallel';
import { ICONS as REGION } from './icons-region';
import { ICONS as STORAGE } from './icons-storage';
import { ICONS as ZONES } from './icons-zones';
import { BAND_NAME, BAND_ORDER, BAND_TYPE, PIPS, TYPE, TYPE_ICONS } from './types';
import type { TaskType, TypeStyle } from './types';

export { BAND_ORDER, BAND_TYPE, PIPS, TASK_TYPES, TYPE } from './types';
export type { TaskType, TypeStyle } from './types';
/** The icon silhouette (14) and the cell it sits in (16, the outline fills the 1 px margin). */
export const FAMILY_ICON = 14, FAMILY_CELL = 16;
/** 'type': the type's colours; 'fail': the same art in the fault ramp. */
export type IconTone = 'type' | 'fail';

const BY_TYPE: Readonly<Record<TaskType, Readonly<Record<string, readonly string[]>>>> = {
  compute: COMPUTE, parallel: PARALLEL, memory: MEMORY, accel: ACCEL, storage: STORAGE, cluster: CLUSTER, zones: ZONES, region: REGION,
};
const INK = '#0e0b1c', WHITE = '#f6f3ff';
const FAIL: Readonly<Record<string, string>> = { o: INK, k: '#3a1420', l: '#ff8a7a', a: '#ff3b3b', d: '#8a2430', w: '#ffc9c0' };

/** Family key → [display name, band], from the game catalog. */
export const FAMILY: Readonly<Record<string, readonly [string, BandId]>> = Object.fromEntries(FAMILIES.map((f) => [f.key, [f.name, f.band] as const]));
/** A band's name and its type's colours (since D23 a band shows its type's colours). */
export interface BandStyle { readonly name: string; readonly type: TaskType; readonly a: string; readonly d: string; readonly l: string }
const bandStyle = (b: BandId): BandStyle => { const type = BAND_TYPE[b], t = TYPE[type]; return { name: BAND_NAME[b], type, a: t.a, d: t.d, l: t.l }; };
export const BAND = Object.fromEntries(BAND_ORDER.map((b) => [b, bandStyle(b)])) as Readonly<Record<BandId, BandStyle>>;

const keyOf = (family: FamilyId | string): string => (typeof family === 'string' ? family : familyKey(family));
export const familyBand = (family: FamilyId | string): BandId => FAMILY[keyOf(family)]?.[1] ?? 'bits';
export const familyName = (family: FamilyId | string): string => FAMILY[keyOf(family)]?.[0] ?? keyOf(family);
/** The task type a family belongs to. */
export const typeOf = (family: FamilyId | string): TaskType => BAND_TYPE[familyBand(family)];
export const typeColor = (type: TaskType): string => TYPE[type].a;
export const typeName = (type: TaskType): string => TYPE[type].name;
/** The family's type colour (since D23 a band shows its type's colour). */
export const bandColor = (family: FamilyId | string): string => typeColor(typeOf(family));
export const hasFamilyIcon = (family: FamilyId | string): boolean => !!BY_TYPE[typeOf(family)][keyOf(family)];

type Run = readonly [x: number, y: number, len: number, ch: string];
const runCache = new Map<readonly string[], readonly Run[]>();
/** Horizontal runs of one char, so a row of plate is one fill instead of ten. */
function runsOf(rows: readonly string[]): readonly Run[] {
  let runs = runCache.get(rows);
  if (runs) return runs;
  const out: Run[] = [];
  rows.forEach((r, y) => {
    for (let x = 0; x < r.length;) {
      const ch = r[x]!; let n = 1;
      while (r[x + n] === ch) n++;
      if (ch !== '.') out.push([x, y, n, ch]);
      x += n;
    }
  });
  runs = out; runCache.set(rows, runs);
  return runs;
}
const palettes = new Map<TaskType, Readonly<Record<string, string>>>();
function palette(type: TaskType, tone: IconTone): Readonly<Record<string, string>> {
  if (tone === 'fail') return FAIL;
  let p = palettes.get(type);
  if (!p) { const t: TypeStyle = TYPE[type]; p = { o: INK, k: t.k, l: t.l, a: t.a, d: t.d, w: WHITE }; palettes.set(type, p); }
  return p;
}
function drawRows(g: CanvasRenderingContext2D, rows: readonly string[], pal: Readonly<Record<string, string>>, x: number, y: number, n: number): void {
  for (const [rx, ry, len, ch] of runsOf(rows)) { g.fillStyle = pal[ch]!; g.fillRect(x + rx * n, y + ry * n, len * n, n); }
}

/** Draw a family's icon in the 16×16 cell whose top-left is (x, y), each art pixel `scale` px. */
export function drawFamilyIcon(g: CanvasRenderingContext2D, family: FamilyId | string, x: number, y: number, scale = 1, tone: IconTone = 'type'): void {
  const type = typeOf(family), rows = BY_TYPE[type][keyOf(family)];
  if (rows) drawRows(g, rows, palette(type, tone), x, y, scale);
}
/** Draw a task type's icon (its frame and emblem) in the 16×16 cell at (x, y). */
export function drawTypeIcon(g: CanvasRenderingContext2D, type: TaskType, x: number, y: number, scale = 1, tone: IconTone = 'type'): void {
  drawRows(g, TYPE_ICONS[type], palette(type, tone), x, y, scale);
}
/** Draw requirement pip `req` (a PIPS key), 5×5 art px (or 3×3 when `mini`), at (x, y). */
export function drawPip(g: CanvasRenderingContext2D, req: string, x: number, y: number, scale = 1, mini = false): void {
  const p = PIPS[req];
  if (!p) return;
  const rows = mini ? p.mini : p.px, n = rows.length;
  g.fillStyle = p.c;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) if (rows[j]![i] === 'w') g.fillRect(x + i * scale, y + j * scale, scale, scale);
}

function paint(canvas: HTMLCanvasElement, scale: number, dpr: number, draw: (g: CanvasRenderingContext2D, n: number) => void): void {
  const n = Math.max(1, Math.round(scale)), k = Math.max(1, Math.round(dpr)), size = FAMILY_CELL * n;
  if (canvas.width !== size * k || canvas.height !== size * k) { canvas.width = size * k; canvas.height = size * k; }
  canvas.style.width = `${size}px`; canvas.style.height = `${size}px`; canvas.style.imageRendering = 'pixelated';
  const g = canvas.getContext('2d');
  if (!g) return;
  g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, canvas.width, canvas.height); g.imageSmoothingEnabled = false;
  draw(g, n * k);
}
/**
 * For DOM: paint a family icon into `canvas` at integer scale N (the canvas becomes 16N × 16N CSS px
 * backed at `dpr`), pixel-exact. Show it with `image-rendering: pixelated`.
 */
export function paintFamilyIcon(canvas: HTMLCanvasElement, family: FamilyId | string, scale: number, dpr = 1, tone: IconTone = 'type'): void {
  paint(canvas, scale, dpr, (g, n) => drawFamilyIcon(g, family, 0, 0, n, tone));
}
/** For DOM: paint a task type's icon, like paintFamilyIcon. */
export function paintTypeIcon(canvas: HTMLCanvasElement, type: TaskType, scale: number, dpr = 1, tone: IconTone = 'type'): void {
  paint(canvas, scale, dpr, (g, n) => drawTypeIcon(g, type, 0, 0, n, tone));
}
