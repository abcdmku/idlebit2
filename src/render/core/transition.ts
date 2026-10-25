// Semantic zoom between nested worlds (mockup core/view.js). Top node first. Each node's world
// (or its mini rect) maps into its rect in the parent's world with a uniform contain scale; the
// camera flies in the top world on a log-scale lerp, and each deeper world fades in over the
// parent's mini of it by effective scale.
import { camera, camToTop, clamp01, compose, contain, containMap, ease, lerpCam, restFor, smooth } from './camera';
import type { Camera, ContainMap, PixelRatio, RestFraming } from './camera';
import type { Point, Rect } from './geom';

export const MAX_PATH = 8;
/** One world on the zoom path, measured at navigation time. */
export interface PathNode {
  readonly key: string;
  /** World size in art px (x, y may be non-zero). */
  readonly size: Rect;
  /** This world's rect inside the parent world. Ignored for the top node. */
  readonly rect: Rect;
  /** The level's rest focus rect in its own world. */
  readonly focus: Rect;
  readonly scaleStep?: number;
  /** The rect of this world that its parent's mini shows (`LevelRenderer.miniRect`); defaults to `size`. */
  readonly mini?: Rect;
  /** The level's link entry (`LevelRenderer.entry`); the framed rest puts it on the lattice. */
  readonly entry?: Point;
}
/**
 * A slice of a chained zoom. A jump of n levels plays as n one-level steps over one eased curve
 * of `total` seconds (mockup core/view.js: min(2.6, 0.62 + 0.56 n)); step k covers [k/n, (k+1)/n].
 */
export interface ZoomSegment { readonly a: number; readonly b: number; readonly total: number }
export const zoomSeconds = (steps: number): number => Math.min(2.6, 0.62 + 0.56 * steps);
export const REDUCED_ZOOM_S = 0.26;
export interface ZoomOptions { readonly framing?: RestFraming | null; readonly segment?: ZoomSegment | null }

export interface ZoomState {
  from: string; to: string; direction: 'in' | 'out';
  /** Path indices of the endpoints. */
  fromIndex: number; toIndex: number;
  /** Linear 0..1 within this step, and eased: the camera's travel from `from` (0) to `to` (1). */
  progress: number; eased: number;
  path: readonly PathNode[];
  /** Per path node: how far its full world has faded in over its mini. */
  readonly alphas: Float32Array;
}

/** Navigation-time `begin` allocates; sampling writes only reusable storage. */
export class ZoomTransition {
  readonly camera = camera();
  readonly maps: ContainMap[] = [];
  readonly rests: Camera[] = [];
  readonly alphas = new Float32Array(MAX_PATH);
  readonly fills = new Float32Array(MAX_PATH);
  readonly state: ZoomState = { from: '', to: '', direction: 'in', fromIndex: 0, toIndex: 0, progress: 0, eased: 0, path: [], alphas: this.alphas };
  private readonly fromCam = camera();
  private readonly toCam = camera();
  private readonly scratch = contain();
  private readonly entryScale = new Float64Array(MAX_PATH);
  private start = 0;
  private duration = 1;
  private segA = 0;
  private segB = 1;
  private lastTime = 0;
  private held: number | null = null;
  /** Path indices of the endpoints of the current zoom. */
  fromIndex = 0;
  toIndex = 0;
  active = false;

  begin(path: readonly PathNode[], from: string, to: string, viewport: Rect, ratio: PixelRatio,
    timeS: number, reducedMotion: boolean, options: ZoomOptions = {}): void {
    if (path.length < 2 || path.length > MAX_PATH) throw new Error(`Zoom path must contain 2 to ${MAX_PATH} nodes`);
    const framing = options.framing ?? null;
    let fromIndex = -1, toIndex = -1;
    for (let i = 0; i < path.length; i++) {
      const node = path[i];
      this.maps[i] ??= contain(); this.rests[i] ??= camera();
      if (i === 0) { this.maps[i].ox = 0; this.maps[i].oy = 0; this.maps[i].k = 1; }
      else { containMap(node.rect, node.mini ?? node.size, this.scratch); compose(this.maps[i - 1], this.scratch, this.maps[i]); }
      restFor(node.focus, viewport, ratio, framing, this.rests[i], node.scaleStep, node.entry ?? null);
      this.entryScale[i] = i ? this.rests[i - 1].s * this.scratch.k : 1;
      if (node.key === from) fromIndex = i;
      if (node.key === to) toIndex = i;
    }
    if (fromIndex < 0 || toIndex < 0) throw new Error('Zoom endpoints must be on the path');
    camToTop(this.rests[fromIndex], this.maps[fromIndex], this.fromCam);
    camToTop(this.rests[toIndex], this.maps[toIndex], this.toCam);
    this.fromIndex = fromIndex; this.toIndex = toIndex;
    this.state.from = from; this.state.to = to; this.state.path = path;
    this.state.direction = toIndex > fromIndex ? 'in' : 'out';
    this.state.fromIndex = fromIndex; this.state.toIndex = toIndex;
    this.start = timeS; this.lastTime = timeS; this.held = null;
    const seg = reducedMotion ? null : options.segment ?? null;
    this.segA = seg ? seg.a : 0; this.segB = seg ? seg.b : 1;
    this.duration = reducedMotion ? REDUCED_ZOOM_S : seg ? (seg.b - seg.a) * seg.total : zoomSeconds(Math.abs(toIndex - fromIndex));
    this.active = true; this.sample(timeS, reducedMotion);
  }
  /** Seconds this step lasts. */
  get seconds(): number { return this.duration; }
  /** Freeze at a progress (QA). null resumes from the held point without skipping. */
  hold(progress: number | null): void {
    if (progress === null && this.held !== null) this.start = this.lastTime - this.held * this.duration;
    this.held = progress === null ? null : clamp01(progress);
  }
  get isHeld(): boolean { return this.held !== null; }
  sample(timeS: number, reducedMotion: boolean): ZoomState {
    this.lastTime = timeS;
    const progress = timeS >= this.start + this.duration ? 1 : clamp01((timeS - this.start) / this.duration);
    return this.sampleProgress(this.held ?? progress, reducedMotion);
  }
  sampleProgress(progress: number, reducedMotion: boolean): ZoomState {
    const u = clamp01(progress), a = this.segA, b = this.segB, ea = ease(a);
    const e = a === 0 && b === 1 ? ease(u) : (ease(a + u * (b - a)) - ea) / (ease(b) - ea);
    this.state.progress = u; this.state.eased = e;
    lerpCam(this.fromCam, this.toCam, e, this.camera);
    const path = this.state.path;
    for (let i = 0; i < path.length; i++) {
      const d = Math.log(this.rests[i].s) - Math.log(this.entryScale[i]);
      const r = Math.abs(d) < 1e-6 ? 1 : (Math.log(this.camera.s * this.maps[i].k) - Math.log(this.entryScale[i])) / d;
      const alpha = !i ? 1 : reducedMotion ? (this.state.direction === 'in' ? u : 1 - u) : smooth(0.3, 0.78, r);
      this.alphas[i] = alpha; this.fills[i] = !i || reducedMotion ? alpha : alpha * smooth(0.55, 1, r);
    }
    return this.state;
  }
  get finished(): boolean { return this.state.progress >= 1 && !this.isHeld; }
}

/** How far `key`'s full world has faded in over its mini: 0 off-path or at rest. */
export function transitionAlpha(state: ZoomState | null, key: string): number {
  if (state) for (let i = 0; i < state.path.length; i++) if (state.path[i].key === key) return state.alphas[i];
  return 0;
}
