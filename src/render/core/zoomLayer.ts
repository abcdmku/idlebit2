// What the core draws over a zoom (A27): each world's labels fade out over the first 15% of the
// eased curve and in over the last 20%, through that world's own camera; the inbound pipe stays
// drawn from the head slot to the entry as it moves between the two worlds.
import { camFromTop, camera, toScreen } from './camera';
import type { PixelRatio, RestFraming, WorldForm } from './camera';
import type { Point, Rect } from './geom';
import { DESKTOP_TYPE, PHONE_TYPE, drawLabels, typeForScale } from './labels';
import type { LabelBuffer } from './labels';
import { drawPipe } from './pipe';
import type { ZoomTransition } from './transition';
import type { LevelRenderer, LevelSnapshot, RenderSnapshot, ViewPresentation, WorldFrame } from './types';

type MutableFrame = { -readonly [K in keyof WorldFrame]: WorldFrame[K] };
export interface ZoomLayer {
  readonly g: CanvasRenderingContext2D; readonly zoom: ZoomTransition; readonly vp: Rect; readonly ratio: PixelRatio;
  readonly framing: RestFraming | null; readonly form: WorldForm; readonly labels: LabelBuffer;
  readonly level: (s: LevelSnapshot) => LevelRenderer;
  readonly report: (where: string, error: unknown) => void;
}
const local = [camera(), camera()], ends: Point[] = [{ x: 0, y: 0 }, { x: 0, y: 0 }], at: Point = { x: 0, y: 0 };
export const LABELS_OUT = 0.15, LABELS_IN = 0.8;

/** `snaps[i]` is path node i (0 = parent). */
export function drawZoomLayer(c: ZoomLayer, s: RenderSnapshot, snaps: readonly LevelSnapshot[], view: ViewPresentation, frame: MutableFrame): void {
  const z = c.zoom, st = z.state, e = view.reducedMotion ? st.progress : st.eased;
  for (let i = 0; i < 2; i++) {
    if (view.reducedMotion) Object.assign(local[i]!, z.rests[i]); else camFromTop(z.camera, z.maps[i]!, local[i]!);
  }
  const type = c.form === 'phone' ? PHONE_TYPE : DESKTOP_TYPE;
  const fades: readonly [number, number][] = [[st.fromIndex, 1 - e / LABELS_OUT], [st.toIndex, (e - LABELS_IN) / (1 - LABELS_IN)]];
  for (const [i, alpha] of fades) {
    const w = snaps[i]!, lv = c.level(w);
    if (alpha <= 0 || !lv.labels) continue;
    frame.scale = Math.round(z.rests[i]!.s / c.ratio.x);
    c.labels.clear();
    const wt = c.form === 'phone' ? PHONE_TYPE : typeForScale(frame.scale);
    try { lv.labels(w, view, frame, c.labels); drawLabels(c.g, c.labels, local[i]!, c.vp, c.ratio, wt, Math.min(1, alpha)); }
    catch (error) { c.report(`${w.level} labels`, error); }
  }
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
