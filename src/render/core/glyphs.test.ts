import { expect, it, vi } from 'vitest';
import { GLYPH_ADVANCE, GLYPH_HEIGHT, GLYPH_WIDTH, silk, silkWidth } from './glyphs';
import { recordingContext } from './testCanvas';
import { lcdText } from '../levels/rack/art';

it('draws silkscreen and LCD labels with Chakra Petch at the existing world size', () => {
  const { g, texts } = recordingContext();
  const clip = vi.spyOn(g, 'rect');
  expect(silk(g, 2, 3, 'Gpu')).toBe(11);
  expect(texts).toEqual([{ text: 'GPU', x: 2, y: 8, maxWidth: 11, font: '600 7px "Chakra Petch"' }]);
  expect(clip).toHaveBeenCalledWith(2, 3, 11, 5);
  expect(lcdText(g, -4, 3, 'FIFO', '#fff', 0, 8)).toBe(15);
  expect(clip).toHaveBeenCalledWith(0, 3, 8, 5);
  expect(texts.at(-1)?.font).toBe('600 7px "Chakra Petch"');
});
it('draws numbers and preformatted strings identically', () => {
  const a = recordingContext(), b = recordingContext();
  silk(a.g, 2, 3, -150); silk(b.g, 2, 3, '-150');
  expect(a.texts).toEqual(b.texts);
});
it.each([
  ['18.49T', 23], ['+4.62T a min', 47], ['1,240', 19], ['0.385 W', 27],
  ['11m 31s', 27], ['Fetch 1 b', 35], ['Core \u00b7 1 Hz', 43],
] as const)('preserves formatter layout for %s at width %i', (text, width) => {
  const { g } = recordingContext();
  expect(GLYPH_WIDTH).toBe(3); expect(GLYPH_HEIGHT).toBe(5); expect(GLYPH_ADVANCE).toBe(4);
  expect(silkWidth(text)).toBe(width); expect(silk(g, 2, 3, text)).toBe(width);
});
it('keeps empty labels empty and counts Unicode code points once', () => {
  const { g, texts } = recordingContext();
  expect(silk(g, 0, 0, '')).toBe(0); expect(texts).toHaveLength(0);
  expect(silkWidth('\u{1f984}')).toBe(3);
});
it('matches numeric and string advance widths near floating point logarithm boundaries', () => {
  for (const value of [0, -15, 999, 1000, 999999999999999, Number.MAX_SAFE_INTEGER]) expect(silkWidth(value)).toBe(silkWidth(String(value)));
});
