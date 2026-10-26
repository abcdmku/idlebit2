import type { CanvasRendererDebug, HitTarget } from '../../render/core';
export interface GestureHandlers {
  renderer(): CanvasRendererDebug | null;
  tap(hit: HitTarget | null): void;
  zoom(direction: 'in' | 'out', hit: HitTarget | null): void;
  /** A pan of the resting view (the rack row, D17.2; a level larger than the view, A05/A09/A20), when it has one. */
  pan?: PanHandler;
  /** Desktop hover: the target under the mouse, or null (the renderer brackets it faintly). */
  hover?(hit: HitTarget | null): void;
}
export interface PanHandler {
  /** True while the resting level pans. */
  active(): boolean;
  /** CSS px since the drag began. At 'end', the finger's last velocity in CSS px/s. */
  drag(dxCss: number, dyCss: number, phase: 'start' | 'move' | 'end', vxCss?: number, vyCss?: number): void;
  /** One wheel step's delta, CSS px. False when this wheel isn't a pan, so it zooms (QA-12). */
  wheel(dxCss: number, dyCss: number): boolean;
}
/** A drag longer than this many CSS px is a pan, not a tap (L2). */
export const PAN_SLOP = 6;
export function wheelUnits(event: Pick<WheelEvent, 'deltaY' | 'deltaMode'>, height: number): number {
  return event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? height : 1);
}
/** One captured pointer stream. No React state changes for pointer moves. */
export function bindGestures(canvas: HTMLCanvasElement, handlers: GestureHandlers): () => void {
  const pointers = new Map<number, { x: number; y: number; startX: number; startY: number }>();
  let pinched = false, baseline = 0, wheel = 0, panning = false;
  // The pan's recent samples (event ms, CSS px): the finger's velocity at release carries a flick.
  let samples: { t: number; x: number; y: number }[] = [];
  const velocity = (): [number, number] => {
    const last = samples[samples.length - 1], first = samples.find(s => last && last.t - s.t <= 100);
    if (!last || !first || last.t <= first.t) return [0, 0];
    const dt = (last.t - first.t) / 1000;
    return [(last.x - first.x) / dt, (last.y - first.y) / dt];
  };
  const local = (x: number, y: number) => { const r = canvas.getBoundingClientRect(); return { x: x - r.left, y: y - r.top }; };
  const hit = (x: number, y: number) => { const p = local(x, y); return handlers.renderer()?.hit(p.x, p.y) ?? null; };
  const down = (event: PointerEvent) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    canvas.focus({ preventScroll: true });
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY });
    canvas.setPointerCapture?.(event.pointerId);
    // Phone: the renderer flashes the pressed part, when it draws presses.
    if (event.pointerType !== 'mouse') handlers.renderer()?.press?.(hit(event.clientX, event.clientY));
    if (pointers.size === 2) { const [a, b] = [...pointers.values()]; baseline = Math.hypot(a.x - b.x, a.y - b.y); pinched = true; }
    event.preventDefault();
  };
  const move = (event: PointerEvent) => {
    // Desktop: the pointer cursor only over something you can tap (user, 26 Oct).
    if (event.pointerType === 'mouse' && pointers.size === 0) {
      const over = hit(event.clientX, event.clientY);
      canvas.style.cursor = over ? 'pointer' : ''; handlers.hover?.(over); return;
    }
    const pointer = pointers.get(event.pointerId); if (!pointer) return;
    pointer.x = event.clientX; pointer.y = event.clientY;
    const pan = handlers.pan;
    if (pointers.size === 1 && pan && (panning || (pan.active() && !handlers.renderer()?.transition))) {
      const dx = event.clientX - pointer.startX, dy = event.clientY - pointer.startY;
      if (!panning && Math.hypot(dx, dy) > PAN_SLOP) { panning = true; samples = []; pan.drag(0, 0, 'start'); }
      if (panning) {
        samples.push({ t: event.timeStamp, x: event.clientX, y: event.clientY });
        if (samples.length > 8) samples.shift();
        pan.drag(dx, dy, 'move'); event.preventDefault();
      }
      return;
    }
    if (pointers.size !== 2 || !baseline) return;
    const [a, b] = [...pointers.values()], distance = Math.hypot(a.x - b.x, a.y - b.y);
    const ratio = distance / baseline;
    if (ratio > 1.4 || ratio < 0.72) {
      handlers.zoom(ratio > 1.4 ? 'in' : 'out', hit((a.x + b.x) / 2, (a.y + b.y) / 2));
      baseline = distance;
    }
    event.preventDefault();
  };
  const leave = () => { canvas.style.cursor = ''; handlers.hover?.(null); };
  const end = (event: PointerEvent) => {
    handlers.renderer()?.press?.(null);
    const pointer = pointers.get(event.pointerId);
    if (event.type === 'pointerup' && pointer && !pinched && !panning
      && Math.hypot(event.clientX - pointer.startX, event.clientY - pointer.startY) < 8
      && !handlers.renderer()?.transition) handlers.tap(hit(event.clientX, event.clientY));
    pointers.delete(event.pointerId);
    if (canvas.hasPointerCapture?.(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    if (!pointers.size) {
      if (panning) handlers.pan?.drag(0, 0, 'end', ...velocity());
      pinched = false; baseline = 0; panning = false;
    }
  };
  const onWheel = (event: WheelEvent) => {
    event.preventDefault();
    if (handlers.pan?.active() && !handlers.renderer()?.transition && handlers.pan.wheel(event.deltaX, wheelUnits(event, canvas.clientHeight))) return;
    wheel += wheelUnits(event, canvas.clientHeight);
    // One step per threshold; a large wheel gesture can cross the entire reachable hierarchy.
    let steps = Math.min(4, Math.floor(Math.abs(wheel) / 120));
    const direction = wheel < 0 ? 'in' : 'out';
    while (steps-- > 0) { handlers.zoom(direction, hit(event.clientX, event.clientY)); wheel += direction === 'in' ? 120 : -120; }
    if (Math.abs(wheel) >= 120) wheel = 0;
  };
  canvas.addEventListener('pointerdown', down); canvas.addEventListener('pointermove', move); canvas.addEventListener('pointerleave', leave);
  canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('lostpointercapture', end); canvas.addEventListener('wheel', onWheel, { passive: false });
  return () => {
    for (const id of pointers.keys()) if (canvas.hasPointerCapture?.(id)) canvas.releasePointerCapture(id);
    pointers.clear(); canvas.removeEventListener('pointerdown', down); canvas.removeEventListener('pointermove', move); canvas.removeEventListener('pointerleave', leave);
    canvas.removeEventListener('pointerup', end); canvas.removeEventListener('pointercancel', end);
    canvas.removeEventListener('lostpointercapture', end); canvas.removeEventListener('wheel', onWheel);
  };
}
