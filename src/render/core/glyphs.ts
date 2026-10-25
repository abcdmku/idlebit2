import { P } from './palette';
import { CANVAS_FONT } from './fonts';

// Preserve existing world geometry and LCD scroll spacing after the D11 typeface change.
export const GLYPH_WIDTH = 3, GLYPH_HEIGHT = 5, GLYPH_ADVANCE = 4;
function characterCount(value: string): number {
  let count = 0;
  for (let i = 0; i < value.length; i++, count++) if (value.codePointAt(i)! > 0xffff) i++;
  return count;
}
function integerDigits(value: number): number {
  const abs = Math.abs(value);
  let count = 1, threshold = 10;
  while (abs >= threshold) { count++; threshold *= 10; }
  return count;
}
export function silkWidth(text: string | number): number {
  const count = typeof text === 'number' && Number.isSafeInteger(text) ? integerDigits(text) + (text < 0 ? 1 : 0) : characterCount(String(text));
  return Math.max(0, count * GLYPH_ADVANCE - 1);
}

/** In-art text keeps its five-pixel height and four-pixel advance, using the loaded typeface. */
export function silk(g: CanvasRenderingContext2D, x: number, y: number, text: string | number, color = P.silk): number {
  const width = silkWidth(text);
  if (width === 0) return 0;
  g.save();
  g.fillStyle = color; g.font = CANVAS_FONT;
  g.textAlign = 'left'; g.textBaseline = 'alphabetic';
  g.beginPath(); g.rect(x | 0, y | 0, width, GLYPH_HEIGHT); g.clip();
  g.fillText(String(text).toUpperCase(), x | 0, (y | 0) + GLYPH_HEIGHT, width);
  g.restore();
  return width;
}
