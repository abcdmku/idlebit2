import { expect, it } from 'vitest';
import { toScreen } from './camera';
import type { Camera } from './camera';
import { DESKTOP_TYPE, FrozenLabels, LabelBuffer, drawLabels } from './labels';
import { recordingContext } from './testCanvas';

const VP = { x: 24, y: 24, w: 1392, h: 708 }, RATIO = { x: 1, y: 1 };
it('rides a frozen label rigidly on its anchor through a zoom: whole pixels, a pure function of the camera, no relayout', () => {
  const b = new LabelBuffer();
  b.label('core', 40, 30, 'left').text('Core 1', 'name', true).text('1.02 kHz', 'value');
  b.label('clock', 90, 30, 'right', true).text('Clock', 'name', true);
  const rest: Camera = { cx: 100, cy: 80, s: 3 }, frozen = new FrozenLabels();
  frozen.freeze(b, 'chip', rest, VP, RATIO, DESKTOP_TYPE);
  b.clear(); // the live buffer may change after the freeze; the frozen copy must not
  const at = { x: 0, y: 0 };
  const sets: string[] = [];
  for (const cam of [{ cx: 100, cy: 80, s: 3 }, { cx: 104.3, cy: 77.1, s: 3.71 }, { cx: 111.9, cy: 70.2, s: 5.26 }]) {
    const rec = recordingContext();
    drawLabels(rec.g, frozen.buf, cam, VP, RATIO, DESKTOP_TYPE, 1, frozen);
    sets.push(rec.texts.map(t => t.text).join('|'));
    toScreen(cam, VP, RATIO, 40, 30, at);
    const first = rec.texts.find(t => t.text === 'Core 1')!;
    expect(first.x).toBe(Math.round(at.x + frozen.dx[0]!));
    expect(Number.isInteger(first.x) && Number.isInteger(first.y - DESKTOP_TYPE.line / 2)).toBe(true);
  }
  // the same labels and runs in every frame
  expect(new Set(sets).size).toBe(1);
  // at the rest camera it matches the rest layout exactly (no jump on the zoom's first frame)
  const restRec = recordingContext(), live = new LabelBuffer();
  live.copyFrom(frozen.buf);
  drawLabels(restRec.g, live, rest, VP, RATIO, DESKTOP_TYPE);
  const frozenRec = recordingContext();
  drawLabels(frozenRec.g, frozen.buf, rest, VP, RATIO, DESKTOP_TYPE, 1, frozen);
  expect(frozenRec.texts.map(t => [t.text, t.x, t.y])).toEqual(restRec.texts.map(t => [t.text, t.x, t.y]));
});
