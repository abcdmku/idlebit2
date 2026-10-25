// Seven world pixels give the existing silkscreen its five-pixel capital height.
export const CANVAS_FONT = '600 7px "Chakra Petch"';
/** The label faces (labels.ts): body 500 and name 700, at any size. */
export const LABEL_FONTS = ['500 16px "Chakra Petch"', '700 16px "Chakra Petch"'] as const;

/** Each document loads once, including when several renderers share a canvas font. */
const loading = new WeakMap<FontFaceSet, Promise<void>>();
/** Canvas text waits for Chakra Petch (D11.4), so labels never flash in a fallback face. */
export function loadCanvasFont(doc: Document): Promise<void> {
  const fonts = doc.fonts;
  // Non-browser canvas adapters may have no Font Loading API.
  if (!fonts) return Promise.resolve();
  let pending = loading.get(fonts);
  if (!pending) {
    pending = Promise.all([fonts.load(CANVAS_FONT, 'BR-1'), ...LABEL_FONTS.map(f => fonts.load(f, 'Core 1,024 Hz'))]).then(sets => {
      if (sets[0].length === 0) throw new Error('Chakra Petch canvas font is not registered');
    });
    loading.set(fonts, pending);
  }
  return pending;
}
