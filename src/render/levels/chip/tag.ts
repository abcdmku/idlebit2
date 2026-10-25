// The CPU grid's busy tag: where it sits, whether it carries the cores' speed, and the art-px area
// its text covers. Shared by the labels (which write it) and the world (whose lock mark avoids it),
// so no label covers a meaningful mark.
import type { ChipSnapshot } from '../../../game';
import { PHONE_TYPE, typeForScale } from '../../core';
import type { Rect, WorldFrame } from '../../core';
import type { Floor } from './layout';
import { spanFits, speedRange, textWidth, tileShowsSpeed } from './speed';

export interface CoreTag {
  /** The spot the tag's top-left sits in (an empty row run, or the cores block on a full grid). */
  readonly box: Rect;
  /** The tag carries the cores' speed (their tiles are too small to show it). */
  readonly speed: boolean;
  /** Art y of the speed's own second line when it does not fit beside the count, else null. */
  readonly speedY: number | null;
  /** The art px the tag's text covers, worst case (every core busy). */
  readonly area: Rect;
}

const span: Rect = { x: 0, y: 0, w: 0, h: 0 };
const area: Rect = { x: 0, y: 0, w: 0, h: 0 };
const fit: Rect = { x: 0, y: 0, w: 0, h: 0 };
const tag: { box: Rect; speed: boolean; speedY: number | null; area: Rect } = { box: span, speed: false, speedY: null, area };
/** Art px kept free at a locked run's far end for the lock mark (7 px wide, 2 px margin each side). */
export const LOCK_ROOM = 11;
let spanLast = -1;

/** The widest run of empty sites (index >= `installed`) within one grid row, or null on a full grid. */
export function emptySpan(sites: readonly Rect[], installed: number): Rect | null {
  let found = false;
  for (let i = installed; i < sites.length;) {
    const r = sites[i]!; let j = i + 1;
    while (j < sites.length && sites[j]!.y === r.y) j++;
    const last = sites[j - 1]!, w = last.x + last.w - r.x;
    if (!found || w > span.w) { span.x = r.x; span.y = r.y; span.w = w; span.h = r.h; spanLast = j - 1; found = true; }
    i = j;
  }
  return found ? span : null;
}

/**
 * The tag goes on the widest run of empty sites in one grid row, off every installed core; a full
 * grid has no free spot, so it sits over the first row only when it must carry the speed. The speed
 * (the user: cores always show their Hz) goes on a second line when the run is too short for one. When the run ends in locked
 * sites (from `lockedFrom`), its far end stays free for the lock mark. Null on a full grid whose
 * tiles show their own speed, or on the two big sites (no tag).
 */
export function coreTag(chip: ChipSnapshot, sites: readonly Rect[], lockedFrom: number, f: Floor, frame: WorldFrame): CoreTag | null {
  if (sites.length <= 2) return null;
  let hidden = false;
  for (let i = 0; i < Math.min(sites.length, chip.cores.length); i++) if (!tileShowsSpeed(chip.cores[i]!, sites[i]!, frame)) hidden = true;
  const free = emptySpan(sites, chip.cores.length);
  const box = free ?? (hidden ? f.cores : null);
  if (!box) return null;
  const room = free && spanLast >= lockedFrom ? LOCK_ROOM : 0;
  fit.x = box.x; fit.y = box.y; fit.w = box.w - room; fit.h = box.h;
  const n = chip.cores.length, base = `Cores ${n} / ${n} busy`;
  const speed = hidden && n > 0, one = `${base} · ${speedRange(chip)}`;
  const split = speed && !spanFits(one, fit, frame);
  const scale = frame.scale ?? (frame.form === 'phone' ? 2 : 3), t = frame.form === 'phone' ? PHONE_TYPE : typeForScale(scale);
  const line = Math.ceil(t.line / scale), text = speed && !split ? one : base;
  const wide = Math.max(textWidth(text, t.body), split ? textWidth(speedRange(chip), t.body) : 0);
  // The label sits at (box.x + 2, box.y + 2) with a few px of backing: 2 art px of slack each way.
  area.x = box.x; area.y = box.y;
  area.w = Math.min(fit.w, 4 + Math.ceil(wide / scale) + 2);
  area.h = split ? 4 + 2 * line : Math.min(box.h, 4 + line);
  tag.box = box; tag.speed = speed; tag.speedY = split ? box.y + 2 + line : null;
  return tag;
}

/** True when two rects overlap. */
export const overlaps = (a: Rect, b: Rect): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
