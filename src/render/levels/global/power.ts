// D31 at World: each site's off-grid generation (a kind icon and how much of its output the site
// uses now) in the free top-right corner of its cell, and the global start controller's tag on
// the scheduler hub ("Start 2/5 sites on"). Values are snapshot fields; nothing moves on its own.
import { P, R, mix, px, silk, silkWidth, whole } from '../../core';
import type { LabelWriter, Rect } from '../../core';
import type { GenerationView, GlobalSnapshot } from '../../../game';
import { label } from '../rack/art';
import { hubRect } from './layout';

type G = CanvasRenderingContext2D;
const SUN = P.gold, BLADE = P.paper, CELL_C = P.cool, PLANT = mix(P.steel, P.ink, 0.1);
/** The 7 × 7 icon and the 3-glyph use readout, right-aligned in the cell's top-right corner. */
export const GEN_BOX = { dx: -12, w: 11, icon: 7 } as const;

/** Used share of the output, as the corner readout: "60%", or "MAX" at 100% (four glyphs don't fit). */
export function genText(gen: GenerationView): string {
  const pct = gen.outputW > 0 ? Math.round(Math.min(1, gen.usedW / gen.outputW) * 100) : 0;
  return pct >= 100 ? 'MAX' : label('', pct, '%');
}

function icon(g: G, kind: GenerationView['kind'], x: number, y: number): void {
  R(g, x - 1, y - 1, 9, 9, P.ink);
  switch (kind) {
    case 'solar': // a sun: a 3 × 3 disc with four rays
      R(g, x + 2, y + 2, 3, 3, SUN); px(g, x + 3, y, SUN); px(g, x + 3, y + 6, SUN); px(g, x, y + 3, SUN); px(g, x + 6, y + 3, SUN);
      break;
    case 'wind': // a turbine: mast and three blades
      R(g, x + 3, y + 3, 1, 4, P.steelHi); px(g, x + 3, y + 2, BLADE);
      px(g, x + 3, y + 1, BLADE); px(g, x + 3, y, BLADE); px(g, x + 2, y + 3, BLADE); px(g, x + 1, y + 4, BLADE); px(g, x + 4, y + 3, BLADE); px(g, x + 5, y + 4, BLADE);
      break;
    case 'fuelCell': // a cell stack: a box with an H
      R(g, x, y + 1, 7, 5, mix(CELL_C, P.ink, 0.5)); R(g, x + 2, y + 2, 1, 3, CELL_C); R(g, x + 4, y + 2, 1, 3, CELL_C); px(g, x + 3, y + 3, CELL_C);
      break;
    case 'ownPlant': // a plant: hall and chimney
      R(g, x, y + 4, 7, 3, PLANT); R(g, x + 5, y + 1, 1, 3, PLANT); px(g, x + 1, y + 5, P.amber); px(g, x + 3, y + 5, P.amber);
      break;
  }
}
/** The site's generation in cell `b`: kind icon, then the used share of its output under it. */
export function drawGeneration(g: G, b: Rect, gen: GenerationView | null | undefined, dark: boolean): void {
  if (!gen) return;
  const x = b.x + b.w + GEN_BOX.dx, ix = x + ((GEN_BOX.w - GEN_BOX.icon) >> 1);
  icon(g, gen.kind, ix, b.y + 3);
  const t = genText(gen), tw = silkWidth(t);
  R(g, x - 1, b.y + 11, GEN_BOX.w + 2, 7, P.ink);
  silk(g, x + GEN_BOX.w - tw, b.y + 12, t, dark ? P.dim : gen.kind === 'solar' || gen.kind === 'wind' ? P.led : P.amber);
}

const hub: Rect = { x: 0, y: 0, w: 0, h: 0 };
/** The global start controller's tag above the map, with a leader down the ocean gap to the scheduler hub. */
export function globalStartTag(s: GlobalSnapshot, gateway: number, out: LabelWriter): void {
  const st = s.start ?? null;
  if (!st) return;
  hubRect(gateway, hub);
  const x = hub.x + (hub.w >> 1);
  out.label('start', x, -12, 'center', true).text('Start', 'name', true).text(`${whole(st.awake)}/${whole(st.total)} sites on`, 'value')
    .leader(x, hub.y);
}
