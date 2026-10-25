import { describe, expect, it } from 'vitest';
import { ZoomTransition, transitionAlpha } from './transition';
import type { PathNode } from './transition';
import { rect } from './geom';

const SLOT = rect(52, 55, 76, 76);
const path: PathNode[] = [
  { key: 'system:0', size: rect(0, 0, 200, 256), rect: rect(), focus: rect(4, 4, 192, 248) },
  { key: 'chip:0', size: rect(0, 0, 192, 192), rect: SLOT, focus: rect(24, 10, 144, 178) },
];
function fixture(out = false, reduced = false) {
  const zoom = new ZoomTransition();
  zoom.begin(path, out ? 'chip:0' : 'system:0', out ? 'system:0' : 'chip:0', rect(0, 138, 390, 492), { x: 2, y: 2 }, 10, reduced);
  return zoom;
}
describe('semantic transition', () => {
  it('fades the child world in over its parent slot and lands on its rest camera', () => {
    const zoom = fixture();
    expect(zoom.alphas[1]).toBe(0); expect(zoom.state.direction).toBe('in');
    const storage = zoom.state.alphas;
    zoom.sampleProgress(0.5, false); expect(zoom.alphas[1]).toBeGreaterThan(0); expect(zoom.alphas[1]).toBeLessThan(1);
    zoom.sampleProgress(1, false); expect(zoom.alphas[1]).toBe(1); expect(zoom.fills[1]).toBe(1);
    expect(zoom.state.alphas).toBe(storage);
    expect(zoom.camera.s * zoom.maps[1].k).toBeCloseTo(zoom.rests[1].s);
    expect(transitionAlpha(zoom.state, 'chip:0')).toBe(1); expect(transitionAlpha(zoom.state, 'rack:0')).toBe(0);
    expect(transitionAlpha(null, 'chip:0')).toBe(0);
  });
  it('reverses the same envelope when zooming out', () => {
    const zoom = fixture(true); expect(zoom.alphas[1]).toBe(1);
    zoom.sampleProgress(1, false); expect(zoom.alphas[1]).toBe(0); expect(zoom.state.direction).toBe('out');
  });
  it('holds without skipping held time, and finishes only when released', () => {
    const zoom = fixture(); zoom.hold(0.5); zoom.sample(11, false);
    const before = { ...zoom.camera }, alpha = zoom.alphas[1]; zoom.sample(400, false);
    expect(zoom.camera).toEqual(before); expect(zoom.alphas[1]).toBe(alpha); expect(zoom.finished).toBe(false);
    zoom.hold(null); zoom.sample(400, false); expect(zoom.state.progress).toBeCloseTo(0.5);
    zoom.sample(401, false); expect(zoom.finished).toBe(true);
  });
  it('crossfades in 0.26 s under reduced motion', () => {
    const zoom = fixture(false, true); zoom.sample(10.13, true);
    expect(zoom.alphas[1]).toBeCloseTo(0.5); zoom.sample(10.26, true); expect(zoom.finished).toBe(true);
  });
  it('rejects paths without both endpoints', () => {
    expect(() => new ZoomTransition().begin(path, 'system:0', 'rack:1', rect(0, 0, 390, 492), { x: 1, y: 1 }, 0, false)).toThrow();
  });
});
