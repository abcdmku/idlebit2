// Mini-world helpers. A parent world draws each child as a mini inside the child's
// rect (the same rect `children()` reports). During a zoom the child's full world
// fades in over that mini, so the mini must sit exactly where the full world lands.
import { containMap, contain } from './camera';
import type { ContainMap } from './camera';
import type { Rect } from './geom';

const scratch = contain();
/** Run `draw` with `g` mapped so that the world `size` fits `r` with a uniform contain scale.
 * This is the transform the zoom uses, so a mini drawn through it lines up with the full world.
 */
export function drawContained(g: CanvasRenderingContext2D, r: Rect, size: Rect, draw: () => void, out: ContainMap = scratch): ContainMap {
  containMap(r, size, out);
  g.save(); g.translate(out.ox, out.oy); g.scale(out.k, out.k);
  try { draw(); } finally { g.restore(); }
  return out;
}
/** Child world point → parent world point through a contain map. */
export function mapPoint(m: ContainMap, x: number, y: number, out: { x: number; y: number }): { x: number; y: number } {
  out.x = m.ox + x * m.k; out.y = m.oy + y * m.k; return out;
}
