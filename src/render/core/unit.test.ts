import { expect, it } from 'vitest';
import { P } from './palette';
import { CART, drawCart, drawCartWell } from './feed';
import type { CartArt } from './feed';
import { drawSaveIcon, drawUnitLamp, drawVeil, saveIconRect, VEIL_ALPHA } from './unit';
import type { LampState } from './unit';
import { rect } from './geom';
import { colorAt, recordingContext } from './testCanvas';

it('draws the unit lamp from real state, draining one px per second over a 10 s switch', () => {
  const lamp = (state: LampState, left = 0, paused = false) => {
    const { g, fills } = recordingContext(); drawUnitLamp(g, 0, 0, 10, state, left, 10_000, paused); return fills;
  };
  expect(colorAt(lamp('online'), 9, 0)).toBe(P.led);
  expect(colorAt(lamp('online', 0, true), 9, 0)).toBe(P.ledOff);
  expect(colorAt(lamp('offline'), 0, 0)).toBe(P.lampOff);
  expect(colorAt(lamp('fault'), 5, 1)).toBe(P.fault);
  const switching = lamp('switching', 3_000);
  expect(colorAt(switching, 2, 0)).toBe(P.amber); expect(colorAt(switching, 3, 0)).toBe(P.lampWell);
  expect(colorAt(lamp('switching', 2_100), 2, 0)).toBe(P.amber);
});
it('draws a 7×7 save icon whose hit rect is the icon', () => {
  const { g, fills } = recordingContext(); drawSaveIcon(g, 4, 5);
  expect(colorAt(fills, 4, 5)).toBe(P.ink); expect(colorAt(fills, 7, 9)).toBe(P.paper);
  expect(saveIconRect(4, 5, rect())).toEqual({ x: 4, y: 5, w: 7, h: 7 });
});
it('veils the whole canvas at the mockup alpha', () => {
  const { g, fills } = recordingContext(); drawVeil(g, 390, 780);
  expect(fills).toEqual([{ x: 0, y: 0, w: 390, h: 780, c: P.veil, a: VEIL_ALPHA }]); expect(g.globalAlpha).toBe(1);
});
it('draws cartridge countdowns from the real deadline and marks failures with their cause', () => {
  const art: CartArt = { family: 'json', color: P.op, reqs: ['compute', 'mem'], state: 'wait', cause: null, leftS: 10, totalS: 10, group: false };
  const bar = (leftS: number) => { const { g, fills } = recordingContext(); drawCart(g, 0, 0, { ...art, leftS }); return fills; };
  expect(colorAt(bar(10), CART - 3, 14)).toBe(P.bit);
  expect(colorAt(bar(5), 8, 14)).toBe(P.bit); expect(colorAt(bar(5), 9, 14)).toBe(P.ink);
  expect(colorAt(bar(3), 2, 14)).toBe(P.amber); expect(colorAt(bar(1), 2, 14)).toBe(P.fault);
  const failed = recordingContext(); drawCart(failed.g, 0, 0, { ...art, state: 'failed', cause: 'timeout' });
  expect(colorAt(failed.fills, 1, 1)).toBe(P.fault); expect(colorAt(failed.fills, 3, 4)).toBe(P.fault);
  expect(colorAt(failed.fills, 2, 14)).toBe(P.ink);
  const well = recordingContext(); drawCartWell(well.g, 0, 0); expect(colorAt(well.fills, 5, 5)).toBe(P.well);
});
it('marks a late failure (D26.5) with its own clock-face cause mark', async () => {
  const { drawCause } = await import('./feed');
  const a = recordingContext(), b = recordingContext();
  drawCause(a.g, 'late', 0, 0); drawCause(b.g, 'timeout', 0, 0);
  expect(a.fills.length).toBeGreaterThan(8); expect(a.fills).not.toEqual(b.fills);
});
