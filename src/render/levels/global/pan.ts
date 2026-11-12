// World framing (A09): the plan (layout.ts) is sized to the free world, so the map rests whole
// wherever it fits. Where it doesn't, the core rests at 2 and pans (core/restPan.ts). The desktop grid
// pans by rows: the window opens on the row of the first owned site, the hub in view when that is the
// top row. The phone list opens at its top, where the hub and the built sites are. `worldPan` is that
// core pan, kept under this name for the UI.
import type { GlobalSnapshot } from '../../../game';
import { restPan } from '../../core';
import type { Point, RestArea, RestPanControl } from '../../core';
import { HEAD, plan } from './layout';

export const worldPan: RestPanControl = restPan;
let viewH = Infinity;
/** The free world's height in art px at the panned rest (2). */
export function setView(area: RestArea | undefined): void { viewH = area ? Math.floor(area.h / Math.min(2, area.scale)) : Infinity; }

/** A panned rest opens with the first owned site's row at the top of the window. */
export function worldCentre(s: GlobalSnapshot, out: Point): void {
  const p = plan();
  let top = Infinity;
  for (let i = 0; i < s.sites.length && i < p.cells.length; i++) if (s.sites[i]!.siteId !== null) top = Math.min(top, p.cells[i]!.y);
  const first = top === Infinity || p.list ? 0 : Math.round((top - HEAD) / p.pitchY) * p.pitchY;
  out.x = p.focus.x + p.focus.w / 2;
  out.y = Number.isFinite(viewH) ? first + viewH / 2 : p.focus.y + p.focus.h / 2;
}
