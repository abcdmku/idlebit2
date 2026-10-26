// What the core draws over a zoom (A27): the outgoing world's labels, frozen at their rest layout
// (FrozenLabels: no relayout, no fit decisions, whole pixels), ride its camera and fade out over the
// first 15% of the eased curve. The incoming world's labels wait for the rest: the view fades them in
// once the camera has landed (user: text must not shuffle). The inbound pipe stays drawn from the
// head slot to the entry as it moves between the two worlds.
import { camFromTop, camera, toScreen } from './camera';
import type { PixelRatio, RestFraming, WorldForm } from './camera';
import type { Point, Rect } from './geom';
import { DESKTOP_TYPE, PHONE_TYPE, drawLabels } from './labels';
import type { FrozenLabels } from './labels';
import { drawPipe } from './pipe';
import type { ZoomTransition } from './transition';
import type { LevelRenderer, LevelSnapshot, RenderSnapshot, ViewPresentation, WorldFrame } from './types';

type MutableFrame = { -readonly [K in keyof WorldFrame]: WorldFrame[K] };
export interface ZoomLayer {
  readonly g: CanvasRenderingContext2D; readonly zoom: ZoomTransition; readonly vp: Rect; readonly ratio: PixelRatio;
  readonly framing: RestFraming | null; readonly form: WorldForm; readonly frozen: FrozenLabels;
  readonly level: (s: LevelSnapshot) => LevelRenderer;
  readonly report: (where: string, error: unknown) => void;
}
const local = [camera(), camera()], ends: Point[] = [{ x: 0, y: 0 }, { x: 0, y: 0 }], at: Point = { x: 0, y: 0 };
export const LABELS_OUT = 0.15;

/** `snaps[i]` is path node i (0 = parent). */
export function drawZoomLayer(c: ZoomLayer, s: RenderSnapshot, snaps: readonly LevelSnapshot[], view: ViewPresentation, frame: MutableFrame): void {
  const z = c.zoom, st = z.state, e = view.reducedMotion ? st.progress : st.eased;
  for (let i = 0; i < 2; i++) {
    if (view.reducedMotion) Object.assign(local[i]!, z.rests[i]); else camFromTop(z.camera, z.maps[i]!, local[i]!);
  }
  const type = c.form === 'phone' ? PHONE_TYPE : DESKTOP_TYPE;
  // Reduced motion: an instant swap (no labels during the cross-fade; the rest draws the new ones at once).
  const out = st.fromIndex, alpha = view.reducedMotion ? 0 : 1 - e / LABELS_OUT, fz = c.frozen;
  if (alpha > 0 && fz.type && fz.level === snaps[out]!.level) drawLabels(c.g, fz.buf, local[out]!, c.vp, c.ratio, fz.type, Math.min(1, alpha), fz);
  if (!c.framing?.pipe) return;
  // The pipe meets the entry as it travels: each world's entry through its own camera, eased between.
  let found = 0;
  for (let k = 0; k < 2; k++) {
    const i = k ? st.toIndex : st.fromIndex, node = st.path[i];
    const p = node?.entry;
    if (!p) continue;
    toScreen(local[i]!, c.vp, c.ratio, p.x, p.y, ends[k]!); found |= 1 << k;
  }
  if (found !== 3) { drawPipe(c.g, s, frame.timeMs, frame.paused, c.framing, c.vp, c.ratio, null, type); return; }
  at.x = ends[0]!.x + (ends[1]!.x - ends[0]!.x) * e; at.y = ends[0]!.y + (ends[1]!.y - ends[0]!.y) * e;
  drawPipe(c.g, s, frame.timeMs, frame.paused, c.framing, c.vp, c.ratio, at, type, false);
}
