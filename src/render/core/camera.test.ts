import { describe, expect, it } from 'vitest';
import { camera, camFromTop, camToTop, compose, contain, containMap, lerpCam, projectRect, restCam, toScreen, toWorld } from './camera';
import { arbitrateHit } from './hit';
import { rect } from './geom';

const createHitTarget = () => ({ id: '', rect: rect() });

describe.each([1, 2, 3])('camera at DPR %i', dpr => {
  const vp = rect(13, 74, 390, 556), ratio = { x: dpr, y: dpr };
  it('round trips CSS points and snaps the backing-store origin', () => {
    const cam = restCam(rect(20, 11, 148, 170), vp, ratio, camera()), screen = { x: 0, y: 0 }, world = { x: 0, y: 0 };
    expect(Number.isInteger(cam.s)).toBe(true);
    toScreen(cam, vp, ratio, 0, 0, screen);
    expect(screen.x * dpr).toBeCloseTo(Math.round(screen.x * dpr), 12);
    expect(screen.y * dpr).toBeCloseTo(Math.round(screen.y * dpr), 12);
    for (const x of [0, 12.5, 144]) for (const y of [0, 28.75, 172]) {
      toScreen(cam, vp, ratio, x, y, screen); toWorld(cam, vp, ratio, screen.x, screen.y, world);
      expect(world.x).toBeCloseTo(x, 12); expect(world.y).toBeCloseTo(y, 12);
    }
  });
  it('contains a child uniformly and composes nested maps and cameras', () => {
    const child = rect(0, 0, 192, 192), slot = rect(30, 40, 80, 50);
    const m = containMap(slot, child, contain());
    expect(m.k).toBe(50 / 192); expect(m.ox).toBe(45); expect(m.oy).toBe(40);
    const nested = compose(m, { ox: 3, oy: 9, k: 0.4 }, contain());
    const cam = restCam(child, vp, ratio, camera()), top = camToTop(cam, nested, camera()), back = camFromTop(top, nested, camera());
    expect(back.cx).toBeCloseTo(cam.cx, 12); expect(back.cy).toBeCloseTo(cam.cy, 12); expect(back.s).toBeCloseTo(cam.s, 12);
    const a = toScreen(cam, vp, ratio, 28, 47, { x: 0, y: 0 });
    const b = toScreen(top, vp, ratio, nested.ox + 28 * nested.k, nested.oy + 47 * nested.k, { x: 0, y: 0 });
    expect(b.x).toBeCloseTo(a.x, 12); expect(b.y).toBeCloseTo(a.y, 12);
  });
  it('hits and anchors use the identical transform, with 44 CSS pixel arbitration', () => {
    const cam = restCam(rect(0, 0, 192, 192), vp, ratio, camera());
    const targets = [createHitTarget(), createHitTarget()];
    Object.assign(targets[0], { id: 'back', rect: rect(60, 50, 2, 2) });
    Object.assign(targets[1], { id: 'front', rect: rect(60, 55, 2, 2) });
    const anchor = projectRect(cam, vp, ratio, targets[1].rect, rect());
    const x = anchor.x + anchor.w / 2, y = anchor.y + anchor.h / 2;
    expect(arbitrateHit(targets, 2, x, y, cam, vp, ratio)?.id).toBe('front');
    expect(arbitrateHit(targets, 2, x + 20, y, cam, vp, ratio)?.id).toBe('front');
    expect(arbitrateHit(targets, 2, x + 30, y, cam, vp, ratio)).toBeNull();
  });
});
it('uses the measured backing/CSS ratio at fractional CSS sizes and DPR', () => {
  const vp = rect(0, 74, 390.3, 555.7), ratio = { x: Math.round(390.3 * 1.25) / 390.3, y: Math.round(779.7 * 1.25) / 779.7 };
  const cam = restCam(rect(0, 0, 192, 192), vp, ratio, camera());
  const screen = toScreen(cam, vp, ratio, 123, 95, { x: 0, y: 0 });
  const world = toWorld(cam, vp, ratio, screen.x, screen.y, { x: 0, y: 0 });
  expect(world.x).toBeCloseTo(123); expect(world.y).toBeCloseTo(95);
});
it('zooms logarithmically and settles to the exact integer endpoint', () => {
  const a = { cx: 20, cy: 30, s: 2 }, b = { cx: 80, cy: 60, s: 8 }, out = camera();
  lerpCam(a, b, 0.5, out); expect(out.s).toBeCloseTo(4); expect(out.cx).toBeCloseTo(60);
  lerpCam(a, b, 1, out); expect(out).toEqual(b); expect(Number.isInteger(out.s)).toBe(true);
});
it('breaks overlapping front-face ties in stable drawing order', () => {
  const targets = [createHitTarget(), createHitTarget()];
  targets[0].id = 'back'; targets[1].id = 'front'; targets[0].rect = targets[1].rect = rect(0, 0, 10, 10);
  expect(arbitrateHit(targets, 2, 5, 5, { cx: 5, cy: 5, s: 1 }, rect(0, 0, 10, 10), { x: 1, y: 1 })?.id).toBe('front');
});
