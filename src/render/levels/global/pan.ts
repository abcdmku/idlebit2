// World framing (A09): the rest frames the player's own sites plus one region of context. When that
// doesn't fit whole at 2, the core rests at 2 and pans (core/restPan.ts), centred on the owned sites,
// with the rack row's clamped drag and snap. `worldPan` is that core pan, kept under this name for
// the UI: route the World's drag to it (see restPan.ts).
import type { GlobalSnapshot } from '../../../game';
import { restPan } from '../../core';
import type { Point, Rect, RestPanControl } from '../../core';
import { CELLS, SIZE } from './layout';

/** One region of context around the owned sites: a column and a row pitch of the map's grid. */
const CTX_X = 96, CTX_Y = 49, MARGIN = 6;
/** The map grid's pitch: a pan snaps a region at a time. */
export const WORLD_SNAP = { x: CTX_X, y: CTX_Y } as const;
export const worldPan: RestPanControl = restPan;

/** The owned sites' bounding box (with a small margin), or the whole map before any site is owned. */
export function ownedBox(s: GlobalSnapshot, out: Rect): Rect {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < s.sites.length && i < CELLS.length; i++) {
    if (s.sites[i]!.siteId === null) continue;
    const c = CELLS[i]!;
    x0 = Math.min(x0, c.x); y0 = Math.min(y0, c.y); x1 = Math.max(x1, c.x + c.w); y1 = Math.max(y1, c.y + c.h);
  }
  if (x0 === Infinity) { out.x = SIZE.x; out.y = SIZE.y; out.w = SIZE.w; out.h = SIZE.h; return out; }
  out.x = Math.max(SIZE.x, x0 - MARGIN); out.y = Math.max(SIZE.y, y0 - MARGIN);
  out.w = Math.min(SIZE.x + SIZE.w, x1 + MARGIN) - out.x; out.h = Math.min(SIZE.y + SIZE.h, y1 + MARGIN) - out.y;
  return out;
}
const box: Rect = { x: 0, y: 0, w: 0, h: 0 };
/** The rest focus: the owned sites plus a region of context each way, clamped to the map. */
export function worldFocus(s: GlobalSnapshot, out: Rect): Rect {
  ownedBox(s, box);
  const x0 = Math.max(SIZE.x, box.x - CTX_X), y0 = Math.max(SIZE.y, box.y - CTX_Y);
  out.x = x0; out.y = y0;
  out.w = Math.min(SIZE.x + SIZE.w, box.x + box.w + CTX_X) - x0; out.h = Math.min(SIZE.y + SIZE.h, box.y + box.h + CTX_Y) - y0;
  return out;
}
/** A panned rest centres on the owned sites. */
export function worldCentre(s: GlobalSnapshot, out: Point): void {
  ownedBox(s, box); out.x = box.x + box.w / 2; out.y = box.y + box.h / 2;
}
