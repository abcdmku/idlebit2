import { expect, it } from 'vitest';
import { arbitrateHit } from './hit';

it('gives a tap inside nested targets to the smallest one (a "+" inside its block), whichever comes first', () => {
  const cam = { cx: 50, cy: 50, s: 1 }, vp = { x: 0, y: 0, w: 100, h: 100 }, ratio = { x: 1, y: 1 };
  const block = { id: 'cores', rect: { x: 10, y: 10, w: 80, h: 80 } }, add = { id: 'add:core', rect: { x: 60, y: 30, w: 20, h: 20 } };
  // the add site's centre is farther from the tap row than the block's: area still decides
  expect(arbitrateHit([block, add], 2, 70, 48, cam, vp, ratio)?.id).toBe('add:core');
  expect(arbitrateHit([add, block], 2, 70, 48, cam, vp, ratio)?.id).toBe('add:core');
  expect(arbitrateHit([block, add], 2, 20, 80, cam, vp, ratio)?.id).toBe('cores');
});
