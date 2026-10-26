// The CPU grid's busy tag: whether there is one, where its text starts, whether it carries the
// cores' speed, and the art-px area it covers. Shared by the labels (which write it) and the world.
// It only ever sits on bare floor: the grid cells past every drawn site (cores and the add site),
// 1 art px clear of all of them and of the add site's 2 px gold bracket. No clean spot, no tag.
import type { ChipSnapshot } from '../../../game';
import { PHONE_TYPE, typeForScale } from '../../core';
import type { Rect, WorldFrame } from '../../core';
import { gridCells } from './layout';
import type { Floor } from './layout';
import { speedRange, textWidth, tileShowsSpeed } from './speed';

export interface CoreTag {
  /** Art px origin of the first line's text. */
  readonly x: number;
  readonly y: number;
  /** The tag carries the cores' speed (their tiles are too small to show it, and it fits). */
  readonly speed: boolean;
  /** Art y of the speed's own second line when it does not fit beside the count, else null. */
  readonly speedY: number | null;
  /** The art px the tag covers, worst case (every core busy), its backing included. */
  readonly area: Rect;
}
/** At 8 cores or fewer the tiles say it all: no tag (user). */
export const TAG_MIN_CORES = 9;
/** Art px between the tag and any site: the add site's gold bracket (2) plus 1 clear. */
export const TAG_CLEAR = 3;

const span: Rect = { x: 0, y: 0, w: 0, h: 0 };
const area: Rect = { x: 0, y: 0, w: 0, h: 0 };
const tag: { x: number; y: number; speed: boolean; speedY: number | null; area: Rect } = { x: 0, y: 0, speed: false, speedY: null, area };

/** The widest run of cells (index >= `from`) within one grid row, or null when there are none. */
export function emptySpan(cells: readonly Rect[], from: number): Rect | null {
  let found = false;
  for (let i = from; i < cells.length;) {
    const r = cells[i]!; let j = i + 1;
    while (j < cells.length && cells[j]!.y === r.y) j++;
    const last = cells[j - 1]!, w = last.x + last.w - r.x;
    if (!found || w > span.w) { span.x = r.x; span.y = r.y; span.w = w; span.h = r.h; found = true; }
    i = j;
  }
  return found ? span : null;
}

/**
 * The busy tag on the widest run of bare cells (past the drawn sites), inset TAG_CLEAR from the
 * sites before it: "Cores n / m busy", with the cores' speed beside it or on a second line when
 * their tiles can't show it and it fits. Null at 8 cores or fewer, on a full grid, or when even the
 * count doesn't fit (the Clock shows the speed; each tile shows its state).
 */
export function coreTag(chip: ChipSnapshot, sites: readonly Rect[], f: Floor, frame: WorldFrame): CoreTag | null {
  const n = chip.cores.length;
  if (n < TAG_MIN_CORES || sites.length <= 2) return null;
  const free = emptySpan(gridCells(f, sites.length), sites.length);
  if (!free) return null;
  const scale = frame.scale ?? (frame.form === 'phone' ? 2 : 3), t = frame.form === 'phone' ? PHONE_TYPE : typeForScale(scale);
  const line = Math.ceil(t.line / scale);
  // The run starts one cell gap (2 art px) past the last site: inset to TAG_CLEAR on that side, 1 elsewhere.
  const x0 = free.x + (TAG_CLEAR - 2), y0 = free.y + 1, w0 = free.x + free.w - 1 - x0, h0 = free.h - 2;
  let hidden = false;
  for (let i = 0; i < Math.min(sites.length, n); i++) if (!tileShowsSpeed(chip.cores[i]!, sites[i]!, frame)) hidden = true;
  const base = `Cores ${n} / ${n} busy`, sp = speedRange(chip);
  const wOf = (s: string): number => Math.ceil(textWidth(s, t.body) / scale) + 4;
  const fits = (w: number, lines: number): boolean => w <= w0 && lines * line + 2 <= h0;
  let w = wOf(base), lines = 1, speed = false;
  if (hidden && n > 0 && fits(wOf(`${base} · ${sp}`), 1)) { w = wOf(`${base} · ${sp}`); speed = true; }
  else if (hidden && n > 0 && fits(Math.max(w, wOf(sp)), 2)) { w = Math.max(w, wOf(sp)); lines = 2; speed = true; }
  else if (!fits(w, 1)) return null;
  area.x = x0; area.y = y0; area.w = w; area.h = lines * line + 2;
  tag.x = x0 + 2; tag.y = y0 + 1; tag.speed = speed; tag.speedY = lines === 2 ? tag.y + line : null;
  return tag;
}

/** True when two rects overlap. */
export const overlaps = (a: Rect, b: Rect): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
