// The canvas renderer. Display only: no listeners, no scheduler, no sim stepping, no
// quotes. It draws snapshot.focus (and snapshot.partner during a zoom), answers hit
// tests in CSS px and reports the zoom so the UI can drop the partner when it ends.
// One bad frame never stops the loop: every level call is guarded and reported once.
import { MAX_EXTRAPOLATION_MS } from './activity';
import { camera, camFromTop, gutters, lerpCam, projectRect, restFor, toScreen, toWorld } from './camera';
import type { Camera, PixelRatio, RestFraming, WorldForm } from './camera';
import { ZoomChain } from './chain';
import { createEffectPool } from './fx';
import { loadCanvasFont } from './fonts';
import { copyRect, contains, rect } from './geom';
import { arbitrateHit } from './hit';
import { DESKTOP_TYPE, FrozenLabels, LabelBuffer, PHONE_TYPE, drawLabels, typeForScale } from './labels';
/** Seconds the landed level's labels take to fade in after a zoom (user: no text shuffles mid-zoom). */
export const LABELS_FADE_S = 0.15;
/** The hover/press bracket's strength against the selection's. */
export const HOVER_ALPHA = 0.45;
import type { Typography } from './labels';
import { BG, P } from './palette';
import { zoomPath } from './paths';
import { drawPipe } from './pipe';
import { Feedback } from './feedback';
import { frameRest, homeBelow, restPan } from './restPan';
import { drawZoomLayer } from './zoomLayer';
import type { ZoomLayer } from './zoomLayer';
import { brackets, setReducedMotion } from './px';
import { depth } from './registry';
import { clearSpriteCache, context2d } from './sprites';
import { ZoomTransition } from './transition';
import { copyHitTarget, createHitTarget, isRef, refKey, refOf, resetHitTarget } from './types';
import type { CanvasRendererDebug, ChildView, FrameClock, HitTarget, LevelId, LevelRegistry, LevelSnapshot,
  Rect, RenderSnapshot, RestArea, TransitionInfo, ViewPresentation, WorldFrame } from './types';
import { drawVeil } from './unit';

export const MAX_CHILDREN = 32, MAX_TARGETS = 272, MAX_FAULTS = 16;
const CHILD_IDS = Array.from({ length: MAX_CHILDREN }, (_, i) => `child${i}`);
interface WorldBuffer { canvas: HTMLCanvasElement; g: CanvasRenderingContext2D; size: Rect }
type MutableFrame = { -readonly [K in keyof WorldFrame]: WorldFrame[K] };

import { reportRenderError } from './errors';
export { reportRenderError } from './errors';

export function createCanvasRenderer(canvas: HTMLCanvasElement, registry: LevelRegistry): CanvasRendererDebug {
  const g = context2d(canvas), viewport = rect(), ratio: PixelRatio = { x: 1, y: 1 };
  const cam = camera(), targetCam = camera(), oldTarget = camera(), framingFrom = camera(), localCam = camera();
  let labelType: Typography | null = null, labelsSince = -Infinity, pressedId: string | null = null;
  const frozen = new FrozenLabels();
  const artRect = rect(), artSrc = rect(), artTl = { x: 0, y: 0 }, artBr = { x: 0, y: 0 };
  const focusRect = rect(), visible = rect(), entry = { x: 0, y: 0 }, corner = { x: 0, y: 0 }, scratch = rect(), hitOut = createHitTarget(), zoom = new ZoomTransition(), effects = createEffectPool(1), fb = new Feedback(), popClip = rect();
  const area: { w: number; h: number; scale: number } = { w: 0, h: 0, scale: 1 };
  const chain = new ZoomChain(), labels = new LabelBuffer();
  const buffers = new Map<LevelId, WorldBuffer>();
  const children: ChildView[] = Array.from({ length: MAX_CHILDREN }, () => ({ ref: { level: 'chip', id: 0 } as ChildView['ref'], rect: rect() }));
  const targets: HitTarget[] = Array.from({ length: MAX_TARGETS }, createHitTarget);
  const faults: Rect[] = Array.from({ length: MAX_FAULTS }, () => rect());
  let snapshot: RenderSnapshot | null = null, view: ViewPresentation | null = null, frame: MutableFrame | null = null;
  let parentIsFocus = false, framing: RestFraming | null = null, form: WorldForm = 'desktop';
  let hint: ReturnType<typeof refOf> | null = null, current: ReturnType<typeof refOf> | null = null, epoch = -1, partsFor: LevelSnapshot | null = null, disposed = false, pausedAt: number | null = null;
  let framingStart = -Infinity, lastNow = 0, held: number | null = null, info: (TransitionInfo & { progress: number }) | null = null;
  let measured = { w: 0, h: 0, dpr: 0 };
  let fontReady = !canvas.ownerDocument.fonts, lastClock: FrameClock | null = null;
  if (!fontReady) void loadCanvasFont(canvas.ownerDocument).then(() => {
    if (disposed) return;
    fontReady = true;
    clearSpriteCache();
    if (snapshot && view && lastClock) renderer.draw(snapshot, view, lastClock);
  }).catch(error => console.error('Unable to load Chakra Petch for canvas text', error));

  function level(s: LevelSnapshot) { return registry.level(s.level as LevelId); }
  function buffer(s: LevelSnapshot): WorldBuffer {
    let entry = buffers.get(s.level);
    if (!entry) {
      const c = canvas.ownerDocument.createElement('canvas');
      entry = { canvas: c, g: context2d(c), size: rect() }; buffers.set(s.level, entry);
    }
    level(s).size(s, entry.size, form);
    if (entry.canvas.width !== entry.size.w || entry.canvas.height !== entry.size.h) {
      entry.canvas.width = entry.size.w; entry.canvas.height = entry.size.h; entry.g.imageSmoothingEnabled = false;
    }
    return entry;
  }
  /** Children first (as drill targets), then the level's own targets in front of them. */
  function fillTargets(s: LevelSnapshot): number {
    const owner = refOf(s);
    let count = 0;
    try {
      for (let i = 0; i < MAX_CHILDREN; i++) children[i].world = null;
      count = Math.min(MAX_CHILDREN, level(s).children(s, children, form));
      for (let i = 0; i < count; i++) {
        const t = resetHitTarget(targets[i], CHILD_IDS[i], 'child', owner);
        t.drill = children[i].ref; copyRect(children[i].rect, t.rect);
      }
      return Math.min(MAX_TARGETS, level(s).targets(s, view!, targets, count, form));
    } catch (error) { reportRenderError(`${s.level} targets`, error); return count; }
  }
  function fill(levelId: LevelId, alpha: number): void {
    g.globalAlpha = alpha; g.fillStyle = BG[levelId];
    g.fillRect(viewport.x * ratio.x, viewport.y * ratio.y, viewport.w * ratio.x, viewport.h * ratio.y); g.globalAlpha = 1;
  }
  function blit(s: LevelSnapshot, c: Camera, alpha: number, focusWorld: boolean): void {
    const entry = buffer(s), bg = entry.g, size = entry.size;
    bg.setTransform(1, 0, 0, 1, -size.x, -size.y); bg.globalAlpha = 1; bg.clearRect(size.x, size.y, size.w, size.h);
    bg.save();
    try { level(s).draw(bg, s, view!, frame!); } catch (error) { reportRenderError(`${s.level} draw`, error); }
    bg.restore(); bg.globalAlpha = 1;
    const sel = view!.selectedId, hov = pressedId ?? view!.hoverId ?? null;
    if (focusWorld && (sel || hov) && !zoom.active) {
      const count = fillTargets(s);
      for (let i = 0; i < count; i++) {
        const id = targets[i].id, r = targets[i].rect;
        if (id === sel) brackets(bg, r.x - 1, r.y - 1, r.w + 2, r.h + 2, P.paper);
        // what the pointer is over: the selection bracket at reduced strength (every level alike)
        else if (id === hov) { const a = bg.globalAlpha; bg.globalAlpha = a * HOVER_ALPHA; brackets(bg, r.x - 1, r.y - 1, r.w + 2, r.h + 2, P.paper); bg.globalAlpha = a; }
      }
    }
    const ox = (viewport.x + viewport.w / 2) * ratio.x + (size.x - c.cx) * c.s, oy = (viewport.y + viewport.h / 2) * ratio.y + (size.y - c.cy) * c.s;
    const x0 = viewport.x * ratio.x, y0 = viewport.y * ratio.y, x1 = x0 + viewport.w * ratio.x, y1 = y0 + viewport.h * ratio.y;
    const sx0 = Math.max(0, Math.floor((x0 - ox) / c.s)), sy0 = Math.max(0, Math.floor((y0 - oy) / c.s));
    const sx1 = Math.min(size.w, Math.ceil((x1 - ox) / c.s)), sy1 = Math.min(size.h, Math.ceil((y1 - oy) / c.s));
    if (sx1 <= sx0 || sy1 <= sy0) return;
    g.save(); g.beginPath(); g.rect(x0, y0, x1 - x0, y1 - y0); g.clip();
    g.globalAlpha = alpha; g.imageSmoothingEnabled = false;
    g.drawImage(entry.canvas, sx0, sy0, sx1 - sx0, sy1 - sy0, ox + sx0 * c.s, oy + sy0 * c.s, (sx1 - sx0) * c.s, (sy1 - sy0) * c.s);
    g.restore();
  }
  function endZoom(nowS: number): void {
    // the landed level's labels fade in from here, on their final layout
    if (zoom.active) { chain.end(nowS); labelsSince = nowS; }
    zoom.active = false; info = null; framingStart = -Infinity;
    if (frame) frame.zoom = null;
  }
  function navigate(s: RenderSnapshot, nowS: number): void {
    const focus = s.focus;
    if (current && isRef(focus, current)) return;
    const prev = current;
    // Freeze the outgoing level's rest labels before anything moves (they ride its camera out).
    if (prev && labelType && !zoom.active) frozen.freeze(labels, prev.level, cam, viewport, ratio, labelType); else frozen.clear();
    hint = prev; current = refOf(focus); pressedId = null; endZoom(nowS); fb.leaveWorld(); restPan.reset();
    if (!prev || !s.partner || !isRef(s.partner, prev)) { chain.reset(); return; }
    const path = zoomPath(registry, s.partner, focus, viewport, children, form);
    if (!path) { chain.reset(); return; }
    const to = refOf(focus), goal = view!.zoomGoal ? depth(view!.zoomGoal) : null;
    const segment = chain.step(depth(prev.level), depth(focus.level), goal, nowS);
    zoom.begin(path, refKey(prev), refKey(to), viewport, ratio, nowS, view!.reducedMotion, { framing, segment });
    parentIsFocus = path[0].key === refKey(to);
    if (held !== null) zoom.hold(held);
    info = { from: prev, to, direction: zoom.state.direction, progress: 0 };
  }
  /** The level's link entry: `entry()`, else the top centre of a target with id 'entry'. */
  function entryOf(s: LevelSnapshot): typeof entry | null {
    try {
      const lv = level(s);
      if (lv.entry) return lv.entry(s, entry, form);
      const count = fillTargets(s);
      for (let i = 0; i < count; i++) if (targets[i].id === 'entry') {
        const r = targets[i].rect; entry.x = r.x + r.w / 2; entry.y = r.y; return entry;
      }
      return null;
    } catch (error) { reportRenderError(`${s.level} entry`, error); return null; }
  }
  /** The free world at rest (A05): the view below the strip minus the gutters, at the shell's N. */
  function restArea(): RestArea | undefined {
    if (!framing) return undefined;
    const gt = gutters(viewport, framing);
    area.w = viewport.w - gt.left - gt.right; area.h = viewport.h - framing.top - gt.top - gt.bottom; area.scale = framing.scale;
    return area;
  }
  function drawRest(s: LevelSnapshot, nowS: number): void {
    const ra = restArea();
    level(s).focus(s, viewport, focusRect, form, ra);
    if (framing && ra) frameRest(level(s), s, focusRect, viewport, framing, ra, hint ?? homeBelow(snapshot!, s), reportRenderError);
    const e = entryOf(s);
    restFor(focusRect, viewport, ratio, framing, targetCam, level(s).cameraScaleStep?.(s), e ? { x: e.x, y: e.y } : null);
    if (framingStart === -Infinity) { Object.assign(cam, targetCam); Object.assign(oldTarget, targetCam); framingStart = nowS - 1; }
    else if (targetCam.cx !== oldTarget.cx || targetCam.cy !== oldTarget.cy || targetCam.s !== oldTarget.s) {
      Object.assign(framingFrom, cam); Object.assign(oldTarget, targetCam); framingStart = nowS;
    }
    const follow = !!level(s).followFocus?.(s) || restPan.dragging, easeS = restPan.active ? 0.15 : level(s).restEaseS?.(s) ?? 0.25;
    const u = view!.reducedMotion || follow ? 1 : Math.min(1, (nowS - framingStart) / easeS);
    frame!.scale = Math.max(1, Math.round(targetCam.s / ratio.x));
    if (u >= 1) Object.assign(cam, targetCam); else lerpCam(framingFrom, targetCam, u, cam);
    toWorld(cam, viewport, ratio, viewport.x, viewport.y + (framing?.top ?? 0), corner); visible.x = corner.x; visible.y = corner.y;
    toWorld(cam, viewport, ratio, viewport.x + viewport.w, viewport.y + viewport.h, corner);
    visible.w = corner.x - visible.x; visible.h = corner.y - visible.y; frame!.visible = visible;
    fill(s.level, 1); blit(s, cam, 1, true);
    const lv = level(s), type = form === 'phone' ? PHONE_TYPE : DESKTOP_TYPE;
    // The level's labels are written here and drawn after the world art and fault marks (drawWorldLabels).
    labels.clear(); labelType = null;
    if (lv.labels) {
      const worldType = typeForScale(frame!.scale ?? framing?.scale ?? 3);
      try { lv.labels(s, view!, frame!, labels); labelType = form === 'phone' ? PHONE_TYPE : worldType; }
      catch (error) { reportRenderError(`${s.level} labels`, error); }
    }
    // the purchase flash: a part's version rising, or a new child (sled, rack, hall) appearing
    if (s !== partsFor) {
      partsFor = s;
      try { fb.parts(s, lv, targets, fillTargets(s), nowS); } catch (error) { reportRenderError(`${s.level} partVersion`, error); }
    }
    fb.drawFlash(g, nowS, cam, viewport, ratio);
    if (!framing?.pipe) return;
    const at = entryOf(s) ?? { x: focusRect.x + focusRect.w / 2, y: focusRect.y };
    // the focus art on screen (CSS px), which the pipe tags keep clear of
    const art = lv.tagClear ? lv.tagClear(s, artSrc) : focusRect;
    toScreen(cam, viewport, ratio, art.x, art.y, artTl); toScreen(cam, viewport, ratio, art.x + art.w, art.y + art.h, artBr);
    artRect.x = artTl.x; artRect.y = artTl.y; artRect.w = artBr.x - artTl.x; artRect.h = artBr.y - artTl.y;
    toScreen(cam, viewport, ratio, at.x, at.y, corner);
    drawPipe(g, snapshot!, frame!.timeMs, frame!.paused, framing, viewport, ratio, corner, type, true, artRect, labelAlpha(nowS));
  }
  function drawZoom(s: RenderSnapshot): boolean {
    const partner = s.partner;
    if (!partner) return false;
    const snaps = parentIsFocus ? [s.focus, partner] : [partner, s.focus];
    if (view!.reducedMotion) {
      const a = zoom.fromIndex, b = zoom.toIndex, u = zoom.state.progress;
      frame!.scale = Math.round(zoom.rests[a].s / ratio.x); fill(snaps[a].level, 1); blit(snaps[a], zoom.rests[a], 1, false);
      frame!.scale = Math.round(zoom.rests[b].s / ratio.x); fill(snaps[b].level, u); blit(snaps[b], zoom.rests[b], u, false);
      drawZoomLayer(layer(), s, snaps, view!, frame!);
      return true;
    }
    const start = zoom.fills[1] >= 0.999 ? 1 : 0;
    fill(snaps[start].level, 1);
    for (let i = start; i < 2; i++) {
      if (i > start && zoom.alphas[i] <= 0.001) break;
      if (i > start && zoom.fills[i] > 0.001) fill(snaps[i].level, zoom.fills[i]);
      camFromTop(zoom.camera, zoom.maps[i], localCam);
      frame!.scale = Math.round(zoom.rests[i].s / ratio.x);
      blit(snaps[i], localCam, i === start ? 1 : zoom.alphas[i], false);
    }
    drawZoomLayer(layer(), s, snaps, view!, frame!);
    return true;
  }
  function drawFaults(s: LevelSnapshot): void {
    let count = 0;
    try { count = Math.min(MAX_FAULTS, level(s).faults?.(s, faults) ?? 0); } catch (error) { reportRenderError(`${s.level} faults`, error); }
    for (let i = 0; i < count; i++) {
      projectRect(cam, viewport, ratio, faults[i], scratch); effects.smoke(i, scratch.x + scratch.w / 2, scratch.y);
    }
  }
  let zoomLayer: ZoomLayer | null = null;
  function layer(): ZoomLayer {
    if (!zoomLayer || zoomLayer.framing !== framing || zoomLayer.form !== form) {
      zoomLayer = { g, zoom, vp: viewport, ratio, framing, form, frozen, level, report: reportRenderError };
    }
    return zoomLayer;
  }
  /** The rest world's labels, over the world art; the payout pops draw over them (drawFrame). */
  function drawWorldLabels(nowS: number): void {
    if (labelType) drawLabels(g, labels, cam, viewport, ratio, labelType, labelAlpha(nowS));
  }
  /** The rest labels' fade-in after a zoom lands: LABELS_FADE_S, or at once under reduced motion. */
  function labelAlpha(nowS: number): number {
    return view?.reducedMotion ? 1 : Math.max(0, Math.min(1, (nowS - labelsSince) / LABELS_FADE_S));
  }
  function drawPops(): void {
    const n = frame!.scale ?? Math.max(1, Math.round(cam.s / ratio.x)), top = framing?.top ?? 0;
    popClip.x = viewport.x; popClip.y = viewport.y + top; popClip.w = viewport.w; popClip.h = viewport.h - top;
    fb.drawPops(g, frame!.timeMs, cam, viewport, ratio, form === 'phone' ? PHONE_TYPE : typeForScale(n), n, popClip, view!.reducedMotion);
  }
  function drawFrame(next: RenderSnapshot, nextView: ViewPresentation, clock: FrameClock): void {
    if (epoch !== next.epoch) {
      // A load or reset: its completions and failures are history, consumed without drawing.
      epoch = next.epoch; effects.clear(); fb.reset(next); partsFor = null;
      endZoom(clock.nowS); chain.reset(); current = null; pausedAt = null;
    }
    const paused = next.round.state !== 'running' && !(next.feed.research?.running && next.feed.research.opsPerSec > 0);
    const live = next.simTimeMs + Math.max(0, Math.min(MAX_EXTRAPOLATION_MS, clock.sincePublishMs));
    if (!paused) pausedAt = null; else pausedAt ??= live;
    frame ??= { snapshot: next, timeMs: 0, paused, reducedMotion: false, zoom: null, form, visible: null };
    frame.snapshot = next; frame.timeMs = paused ? pausedAt! : live; frame.paused = paused;
    frame.reducedMotion = nextView.reducedMotion; frame.zoom = null; frame.form = form; frame.visible = null; frame.scale = framing?.scale;
    navigate(next, clock.nowS);
    g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1;
    g.clearRect(viewport.x * ratio.x, viewport.y * ratio.y, viewport.w * ratio.x, viewport.h * ratio.y);
    if (zoom.active) {
      zoom.sample(clock.nowS, nextView.reducedMotion); frame.zoom = zoom.state; info!.progress = zoom.state.progress;
      if (!drawZoom(next) || zoom.finished) endZoom(clock.nowS);
    }
    try { fb.take(next, level(next.focus), form, frame.timeMs, clock.nowS, !zoom.active && !paused); }
    catch (error) { reportRenderError(`${next.focus.level} payoutAnchor`, error); }
    if (!zoom.active) { drawRest(next.focus, clock.nowS); drawFaults(next.focus); drawWorldLabels(clock.nowS); }
    if (framing) fb.drawFailure(g, clock.nowS, framing, viewport, ratio);
    if (next.round.state !== 'running') { g.save(); g.translate(viewport.x * ratio.x, viewport.y * ratio.y); drawVeil(g, viewport.w * ratio.x, viewport.h * ratio.y); g.restore(); }
    effects.update(Math.max(0, clock.nowS - lastNow)); lastNow = clock.nowS;
    g.setTransform(ratio.x, 0, 0, ratio.y, 0, 0);
    if (!zoom.active) effects.draw(g, nextView.reducedMotion);
    g.setTransform(1, 0, 0, 1, 0, 0);
    // Payout pops go last (user): above the world art, labels, pipe tags, fault marks, the failure
    // beat and the purchase flash, clipped to the world. Only the DOM menus sit over them.
    if (!zoom.active && !paused) { drawPops(); g.setTransform(1, 0, 0, 1, 0, 0); }
  }
  const renderer: CanvasRendererDebug = {
    get bufferCount() { return buffers.size; },
    get transition() { return info; },
    resize(widthCss, heightCss, dpr, worldViewport, nextFraming = null) {
      if (disposed || widthCss <= 0 || heightCss <= 0 || dpr <= 0) return;
      if (widthCss === measured.w && heightCss === measured.h && dpr === measured.dpr && worldViewport.x === viewport.x &&
        worldViewport.y === viewport.y && worldViewport.w === viewport.w && worldViewport.h === viewport.h && nextFraming === framing) return;
      measured = { w: widthCss, h: heightCss, dpr };
      framing = nextFraming; form = nextFraming?.form ?? 'desktop';
      canvas.width = Math.round(widthCss * dpr); canvas.height = Math.round(heightCss * dpr);
      canvas.style.width = `${widthCss}px`; canvas.style.height = `${heightCss}px`; canvas.style.imageRendering = 'pixelated';
      ratio.x = canvas.width / widthCss; ratio.y = canvas.height / heightCss;
      copyRect(worldViewport, viewport); effects.resize(viewport); g.imageSmoothingEnabled = false;
      endZoom(lastNow); chain.reset();
    },
    draw(next, nextView, clock: FrameClock) {
      if (disposed) return;
      snapshot = next; view = nextView; setReducedMotion(nextView.reducedMotion);
      lastClock = clock;
      if (!fontReady) return;
      try { drawFrame(next, nextView, clock); } catch (error) {
        reportRenderError('frame', error);
        endZoom(clock.nowS); chain.reset();
        g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1;
      }
    },
    hit(xCss, yCss) {
      if (disposed || !fontReady || !snapshot || !view || zoom.active || !contains(viewport, xCss, yCss)) return null;
      const target = arbitrateHit(targets, fillTargets(snapshot.focus), xCss, yCss, cam, viewport, ratio);
      return target ? copyHitTarget(target, hitOut) : null;
    },
    anchor(id, out) {
      if (disposed || !fontReady || !snapshot || !view || zoom.active) return false;
      const count = fillTargets(snapshot.focus);
      for (let i = 0; i < count; i++) if (targets[i].id === id) { projectRect(cam, viewport, ratio, targets[i].rect, out); return true; }
      return false;
    },
    getTargets() {
      if (disposed || !fontReady || !snapshot || !view || zoom.active) return [];
      const count = fillTargets(snapshot.focus);
      return targets.slice(0, count).map(t => copyHitTarget(t, createHitTarget()));
    },
    hold(progress) { held = progress; zoom.hold(progress); },
    press(target) { pressedId = target ? target.id : null; },
    dispose() { disposed = true; buffers.clear(); effects.clear(); snapshot = null; view = null; canvas.width = 0; canvas.height = 0; },
  };
  return renderer;
}
