import { describe, expect, it, vi } from 'vitest';
import { panKind } from './panKind';
import { bindGestures, wheelUnits } from './gestures';
describe('world viewport and gestures', () => {
  it('normalizes wheel units and crosses several semantic levels', () => {
    expect(wheelUnits({ deltaY: 3, deltaMode: 1 }, 400)).toBe(48);
    expect(wheelUnits({ deltaY: 1, deltaMode: 2 }, 400)).toBe(400);
    const canvas = document.createElement('canvas'), zoom = vi.fn();
    const dispose = bindGestures(canvas, { renderer: () => null, tap: vi.fn(), zoom });
    canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: 360, cancelable: true }));
    expect(zoom).toHaveBeenCalledTimes(3); expect(zoom.mock.calls[0][0]).toBe('out');
    dispose(); canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: 120 }));
    expect(zoom).toHaveBeenCalledTimes(3);
  });
  it('captures pointers, suppresses pinch taps and releases on cancel', () => {
    const canvas = document.createElement('canvas'), tap = vi.fn(), zoom = vi.fn(), captured = new Set<number>();
    canvas.setPointerCapture = vi.fn(id => { captured.add(id); }); canvas.hasPointerCapture = id => captured.has(id);
    canvas.releasePointerCapture = vi.fn(id => { captured.delete(id); });
    const dispose = bindGestures(canvas, { renderer: () => null, tap, zoom });
    const send = (type: string, id: number, x: number) => {
      const event = new Event(type, { cancelable: true });
      Object.assign(event, { pointerId: id, clientX: x, clientY: 50, pointerType: 'touch' }); canvas.dispatchEvent(event);
    };
    send('pointerdown', 1, 0); send('pointerdown', 2, 100); send('pointermove', 2, 150);
    expect(zoom).toHaveBeenCalledWith('in', null);
    send('pointerup', 2, 150); send('pointercancel', 1, 0);
    expect(tap).not.toHaveBeenCalled(); expect(captured.size).toBe(0);
    send('pointerdown', 3, 40); send('pointerup', 3, 40); expect(tap).toHaveBeenCalledOnce(); dispose();
  });
  it('pans the rack row: a drag past 6 px scrolls instead of tapping; the wheel scrolls instead of zooming', () => {
    const canvas = document.createElement('canvas'), tap = vi.fn(), zoom = vi.fn(), drag = vi.fn(), wheel = vi.fn(() => true);
    const dispose = bindGestures(canvas, { renderer: () => null, tap, zoom, pan: { active: () => true, drag, wheel } });
    const send = (type: string, x: number) => {
      const event = new Event(type, { cancelable: true });
      Object.assign(event, { pointerId: 1, clientX: x, clientY: 50, pointerType: 'touch' }); canvas.dispatchEvent(event);
    };
    send('pointerdown', 100); send('pointermove', 104); send('pointermove', 70); send('pointerup', 70);
    expect(drag.mock.calls).toEqual([[0, 0, 'start'], [-30, 0, 'move'], [0, 0, 'end', 0, 0]]);
    expect(tap).not.toHaveBeenCalled();
    send('pointerdown', 100); send('pointerup', 102);
    expect(tap).toHaveBeenCalledOnce();
    canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: 120, cancelable: true }));
    expect(wheel).toHaveBeenCalledWith(0, 120); expect(zoom).not.toHaveBeenCalled();
    dispose();
  });
  it('a wheel the pan declines zooms instead (QA-12: nothing to pan, or a vertical wheel on the rack row)', () => {
    const canvas = document.createElement('canvas'), zoom = vi.fn();
    const dispose = bindGestures(canvas, { renderer: () => null, tap: vi.fn(), zoom, pan: { active: () => true, drag: vi.fn(), wheel: () => false } });
    canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: -120, cancelable: true }));
    expect(zoom).toHaveBeenCalledWith('in', null);
    dispose();
  });
});

describe('pan release', () => {
  it('reports the finger\'s last velocity, so a flick carries on (A06)', () => {
    const canvas = document.createElement('canvas'), drag = vi.fn();
    const dispose = bindGestures(canvas, { renderer: () => null, tap: vi.fn(), zoom: vi.fn(), pan: { active: () => true, drag, wheel: vi.fn() } });
    const send = (type: string, x: number, t: number) => {
      const event = new Event(type, { cancelable: true });
      Object.defineProperty(event, 'timeStamp', { value: t });
      Object.assign(event, { pointerId: 1, clientX: x, clientY: 50, pointerType: 'touch' }); canvas.dispatchEvent(event);
    };
    send('pointerdown', 100, 0); send('pointermove', 90, 10); send('pointermove', 60, 40); send('pointermove', 40, 60); send('pointerup', 40, 60);
    expect(drag.mock.calls.at(-1)).toEqual([0, 0, 'end', -1000, 0]);
    dispose();
  });
});

describe('what a drag or wheel pans at rest (panKind)', () => {
  it('a CPU taller than the view pans like Room and World; with nothing to pan the wheel zooms', () => {
    const chip = { level: 'chip' } as never, room = { level: 'room' } as never;
    expect([panKind(chip, true, false), panKind(chip, false, false), panKind(room, true, false), panKind(chip, true, true)]).toEqual(['rest', null, 'rest', null]);
    const rack = (n: number) => ({ level: 'rack', row: Array.from({ length: 3 }, (_, i) => ({ rackId: i < n ? i : null })) }) as never;
    expect([panKind(rack(1), true, false), panKind(rack(2), false, false)]).toEqual([null, 'rack']);
  });
});
