import type { CanvasRendererDebug, HitTarget } from '../../render/core';
export interface GestureHandlers {
  renderer(): CanvasRendererDebug | null;
  tap(hit: HitTarget | null): void;
  zoom(direction: 'in' | 'out', hit: HitTarget | null): void;
  /** A horizontal pan of the view (the rack row, D17.2), when the level at rest has one. */
  pan?: PanHandler;
}
export interface PanHandler {
  /** True while the resting level pans (the Rack level). */
  active(): boolean;
  /** CSS px since the drag began (drag), or one wheel step's delta (wheel). */
  drag(dxCss: number, phase: 'start' | 'move' | 'end'): void;
  wheel(dCss: number): void;
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
  const local = (x: number, y: number) => { const r = canvas.getBoundingClientRect(); return { x: x - r.left, y: y - r.top }; };
  const hit = (x: number, y: number) => { const p = local(x, y); return handlers.renderer()?.hit(p.x, p.y) ?? null; };
  const down = (event: PointerEvent) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    canvas.focus({ preventScroll: true });
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY });
    canvas.setPointerCapture?.(event.pointerId);
    if (pointers.size === 2) { const [a, b] = [...pointers.values()]; baseline = Math.hypot(a.x - b.x, a.y - b.y); pinched = true; }
    event.preventDefault();
  };
  const move = (event: PointerEvent) => {
    const pointer = pointers.get(event.pointerId); if (!pointer) return;
    pointer.x = event.clientX; pointer.y = event.clientY;
    const pan = handlers.pan;
    if (pointers.size === 1 && pan && (panning || (pan.active() && !handlers.renderer()?.transition))) {
      const dx = event.clientX - pointer.startX;
      if (!panning && Math.abs(dx) > PAN_SLOP) { panning = true; pan.drag(0, 'start'); }
      if (panning) { pan.drag(dx, 'move'); event.preventDefault(); }
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
  const end = (event: PointerEvent) => {
    const pointer = pointers.get(event.pointerId);
    if (event.type === 'pointerup' && pointer && !pinched && !panning
      && Math.hypot(event.clientX - pointer.startX, event.clientY - pointer.startY) < 8
      && !handlers.renderer()?.transition) handlers.tap(hit(event.clientX, event.clientY));
    pointers.delete(event.pointerId);
    if (canvas.hasPointerCapture?.(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    if (!pointers.size) {
      if (panning) handlers.pan?.drag(0, 'end');
      pinched = false; baseline = 0; panning = false;
    }
  };
  const onWheel = (event: WheelEvent) => {
    event.preventDefault();
    if (handlers.pan?.active() && !handlers.renderer()?.transition) { handlers.pan.wheel(event.deltaX || wheelUnits(event, canvas.clientHeight)); return; }
    wheel += wheelUnits(event, canvas.clientHeight);
    // One step per threshold; a large wheel gesture can cross the entire reachable hierarchy.
    let steps = Math.min(4, Math.floor(Math.abs(wheel) / 120));
    const direction = wheel < 0 ? 'in' : 'out';
    while (steps-- > 0) { handlers.zoom(direction, hit(event.clientX, event.clientY)); wheel += direction === 'in' ? 120 : -120; }
    if (Math.abs(wheel) >= 120) wheel = 0;
  };
  canvas.addEventListener('pointerdown', down); canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('lostpointercapture', end); canvas.addEventListener('wheel', onWheel, { passive: false });
  return () => {
    for (const id of pointers.keys()) if (canvas.hasPointerCapture?.(id)) canvas.releasePointerCapture(id);
    pointers.clear(); canvas.removeEventListener('pointerdown', down); canvas.removeEventListener('pointermove', move);
    canvas.removeEventListener('pointerup', end); canvas.removeEventListener('pointercancel', end);
    canvas.removeEventListener('lostpointercapture', end); canvas.removeEventListener('wheel', onWheel);
  };
}
