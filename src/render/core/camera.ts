import type { Point, Rect } from './geom';

/** Scale and origin are in actual backing-store pixels, never CSS pixels. */
export interface Camera { cx: number; cy: number; s: number }
export interface ContainMap { ox: number; oy: number; k: number }
export interface PixelRatio { x: number; y: number }
export const IDENTITY: Readonly<ContainMap> = { ox: 0, oy: 0, k: 1 };
export const camera = (): Camera => ({ cx: 0, cy: 0, s: 1 });
export const contain = (): ContainMap => ({ ox: 0, oy: 0, k: 1 });
export const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

export function restCam(focus: Rect, vp: Rect, ratio: PixelRatio, out: Camera, scaleStep = 1): Camera {
  const vx = (vp.x + vp.w / 2) * ratio.x, vy = (vp.y + vp.h / 2) * ratio.y;
  const fit = Math.min(vp.w * ratio.x / focus.w, vp.h * ratio.y / focus.h);
  const s = Math.max(scaleStep, Math.floor(fit / scaleStep) * scaleStep);
  const ox = Math.round(vx - (focus.x + focus.w / 2) * s);
  const oy = Math.round(vy - (focus.y + focus.h / 2) * s);
  out.cx = (vx - ox) / s; out.cy = (vy - oy) / s; out.s = s;
  return out;
}
/** Layout form: the Control deck desktop deck or the folded phone deck. Levels may lay out per form. */
export type WorldForm = 'desktop' | 'phone';
/**
 * Control deck rest framing (D17, A05). Every rest draws 1:1 at an integer art scale: one art px is n CSS px.
 * The focus is contain-fitted, whole, in the free world: the viewport below `top` (the HUD band and
 * the queue strip) minus the gutters. n is the shell's N (3 desktop, 2 phone) when the focus fits,
 * else the largest lower integer that fits (D15.2: never cropped). The focus centres in the free
 * world, and the level's entry point (or its world origin) snaps to the lattice lcm(8, N).
 */
export interface RestFraming {
  readonly form: WorldForm;
  /** Art scale N, CSS px per art px. */
  readonly scale: number;
  /** CSS px: 24 desktop, 8 phone. */
  readonly lattice: number;
  /** CSS px from the viewport top to the free world: the HUD band plus the queue strip. */
  readonly top: number;
  /**
   * Optional inbound pipe route, CSS px: it drops from (x, y) under the head slot to `runY`, runs
   * across, then drops into the level's entry. The core draws it at rest; during a zoom only the first drop.
   */
  readonly pipe?: { readonly x: number; readonly y: number; readonly runY: number } | null;
  /** Optional CSS px kept clear around the focus; `gutters()` gives the defaults. */
  readonly gutters?: Gutters | null;
}
/** CSS px. Left carries the pipe's vertical run and its tag, right the docked callout (desktop). */
export interface Gutters { readonly left: number; readonly right: number; readonly top: number; readonly bottom: number }
/** Desktop: the right gutter holds the UI's docked callout, 288 px plus a lattice. */
export const CALLOUT_DOCK_W = 288;
/** Desktop: the left gutter fits the pipe's vertical run and its tag (Pipe 1 kHz, the packet under it). */
export const PIPE_TAG_W = 168;
/**
 * The framing's gutters, or the defaults. Desktop: the pipe's vertical run and its tag on the left, the
 * callout dock on the right. Phone: a lattice each side (the run is short and the tag sits beside it).
 * Both: the pipe's run on top.
 */
export function gutters(vp: Rect, f: RestFraming): Gutters {
  if (f.gutters) return f.gutters;
  const lat = f.lattice, p = f.pipe, desk = f.form !== 'phone';
  const left = p && desk ? p.x - vp.x + PIPE_TAG_W : lat;
  const runBottom = p ? p.runY + 2 * f.scale - (vp.y + f.top) : 0;
  const top = Math.max(lat, Math.ceil(runBottom / lat) * lat);
  return { left: Math.ceil(left / lat) * lat, right: desk ? CALLOUT_DOCK_W + lat : lat, top, bottom: 0 };
}
/** The largest integer art scale, at most the framing's N, at which `focus` fits whole in `vp` minus the gutters. */
export function fitScale(focus: Rect, vp: Rect, f: RestFraming): number {
  const g = gutters(vp, f), w = vp.w - g.left - g.right, h = vp.h - f.top - g.top - g.bottom;
  let n = f.scale;
  while (n > 1 && (focus.w * n > w || focus.h * n > h)) n--;
  return n;
}
/** 1440×900: world 24,24 1392×708, free below y 168, pipe from (72, 168) to run y 192 (stage px). */
export const DESKTOP_FRAMING: RestFraming = { form: 'desktop', scale: 3, lattice: 24, top: 144 };
/** 390×780: world 8,8 368×692, free below y 200, pipe from (32, 200) to run y 208. */
export const PHONE_FRAMING: RestFraming = { form: 'phone', scale: 2, lattice: 8, top: 192 };

/** The rest camera under `framing`, at `fitScale`. Scale is n × device ratio. */
export function framedRest(focus: Rect, vp: Rect, ratio: PixelRatio, f: RestFraming, out: Camera, entry: Point | null = null): Camera {
  const n = fitScale(focus, vp, f), lat = f.lattice, g = gutters(vp, f);
  const freeX = vp.x + g.left, freeW = vp.w - g.left - g.right, freeY = vp.y + f.top + g.top, freeH = vp.h - f.top - g.top - g.bottom;
  const ex = (entry?.x ?? 0) * n, ey = (entry?.y ?? 0) * n;
  let ox = freeX + freeW / 2 - (focus.x + focus.w / 2) * n;
  let oy = focus.h * n <= freeH ? freeY + (freeH - focus.h * n) / 2 - focus.y * n : freeY - focus.y * n;
  ox = vp.x + Math.round((ox + ex - vp.x) / lat) * lat - ex;
  oy = vp.y + Math.floor((oy + ey - vp.y) / lat) * lat - ey;
  // The snap may push the art a part-lattice into a gutter; step it back when the slack allows.
  const left = ox + focus.x * n, right = left + focus.w * n, top = oy + focus.y * n, bottom = top + focus.h * n;
  if (left < freeX && right + lat <= freeX + freeW) ox += lat; else if (right > freeX + freeW && left - lat >= freeX) ox -= lat;
  if (top < freeY && bottom + lat <= freeY + freeH) oy += lat;
  const s = n * ratio.x, vx = (vp.x + vp.w / 2) * ratio.x, vy = (vp.y + vp.h / 2) * ratio.y;
  out.s = s; out.cx = (vx - ox * ratio.x) / s; out.cy = (vy - oy * ratio.y) / s;
  return out;
}
/** Rest camera for a focus: framed at N when a framing is set, else the largest integer fit. */
export function restFor(focus: Rect, vp: Rect, ratio: PixelRatio, framing: RestFraming | null, out: Camera, scaleStep = 1,
  entry: Point | null = null): Camera {
  return framing ? framedRest(focus, vp, ratio, framing, out, entry) : restCam(focus, vp, ratio, out, scaleStep);
}
export function toScreen(cam: Camera, vp: Rect, ratio: PixelRatio, x: number, y: number, out: Point): Point {
  out.x = ((x - cam.cx) * cam.s + (vp.x + vp.w / 2) * ratio.x) / ratio.x;
  out.y = ((y - cam.cy) * cam.s + (vp.y + vp.h / 2) * ratio.y) / ratio.y;
  return out;
}
export function toWorld(cam: Camera, vp: Rect, ratio: PixelRatio, xCss: number, yCss: number, out: Point): Point {
  out.x = (xCss - vp.x - vp.w / 2) * ratio.x / cam.s + cam.cx;
  out.y = (yCss - vp.y - vp.h / 2) * ratio.y / cam.s + cam.cy;
  return out;
}
export function projectRect(cam: Camera, vp: Rect, ratio: PixelRatio, r: Rect, out: Rect): Rect {
  toScreen(cam, vp, ratio, r.x, r.y, out);
  out.w = r.w * cam.s / ratio.x; out.h = r.h * cam.s / ratio.y;
  return out;
}
export function containMap(r: Rect, size: Rect, out: ContainMap): ContainMap {
  out.k = Math.min(r.w / size.w, r.h / size.h);
  out.ox = r.x + (r.w - size.w * out.k) / 2 - size.x * out.k;
  out.oy = r.y + (r.h - size.h * out.k) / 2 - size.y * out.k;
  return out;
}
export function compose(a: ContainMap, b: ContainMap, out: ContainMap): ContainMap {
  const ox = a.ox + b.ox * a.k, oy = a.oy + b.oy * a.k, k = a.k * b.k;
  out.ox = ox; out.oy = oy; out.k = k;
  return out;
}
export function camToTop(cam: Camera, m: ContainMap, out: Camera): Camera {
  out.cx = m.ox + cam.cx * m.k; out.cy = m.oy + cam.cy * m.k; out.s = cam.s / m.k;
  return out;
}
export function camFromTop(cam: Camera, m: ContainMap, out: Camera): Camera {
  out.cx = (cam.cx - m.ox) / m.k; out.cy = (cam.cy - m.oy) / m.k; out.s = cam.s * m.k;
  return out;
}
export function lerpCam(a: Camera, b: Camera, u: number, out: Camera): Camera {
  if (u <= 0) { Object.assign(out, a); return out; }
  if (u >= 1) { Object.assign(out, b); return out; }
  const s = Math.exp(Math.log(a.s) + (Math.log(b.s) - Math.log(a.s)) * u);
  const d = 1 / b.s - 1 / a.s;
  const w = Math.abs(d) < 1e-12 ? u : (1 / s - 1 / a.s) / d;
  out.cx = a.cx + (b.cx - a.cx) * w; out.cy = a.cy + (b.cy - a.cy) * w; out.s = s;
  return out;
}
export const ease = (u: number): number => u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
export function smooth(a: number, b: number, x: number): number {
  const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t);
}
