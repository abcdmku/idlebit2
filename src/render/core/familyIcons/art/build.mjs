// Builds every task icon from the art sources: frame + glyph → 16×16 rows with a baked outline.
// Shared by generate.mjs (writes the TS data) and the QA draft sheet.
import { FAMILY } from './catalog.mjs';
import { INK, compose, mix } from './compose.mjs';
import { GLYPHS as GA, TYPE_GLYPHS as TA } from './glyphs-a.mjs';
import { GLYPHS as GB, TYPE_GLYPHS as TB } from './glyphs-b.mjs';
import { FRAMES, TYPES, TYPE_ORDER } from './types.mjs';

export { FAMILY, TYPES, TYPE_ORDER };
const GLYPHS = { ...GA, ...GB }, TYPE_GLYPHS = { ...TA, ...TB };

export const BAND_TYPE = Object.fromEntries(TYPE_ORDER.flatMap((t) => TYPES[t].bands.map((b) => [b, t])));
/** The plate: the type colour sunk most of the way to ink. */
export const plateOf = (t) => mix(TYPES[t].a, INK, 0.8);
/** Failed tone: the same art in the fault ramp. */
export const FAIL = { a: '#ff3b3b', d: '#8a2430', l: '#ff8a7a', w: '#ffc9c0', k: '#3a1420', o: INK };

export function paletteFor(type, tone = 'type') {
  if (tone === 'fail') return FAIL;
  const t = TYPES[type];
  return { a: t.a, d: t.d, l: t.l, w: '#f6f3ff', k: plateOf(type), o: INK };
}

export function buildIcons() {
  const errors = [];
  const types = TYPE_ORDER.map((key) => {
    const c = compose(FRAMES[key], TYPE_GLYPHS[key], `type:${key}`);
    errors.push(...c.errors);
    return { key, type: key, name: TYPES[key].name, rows: c.rows };
  });
  const families = Object.entries(FAMILY).map(([key, [name, band]]) => {
    const type = BAND_TYPE[band];
    if (!type) { errors.push(`${key}: band ${band} has no type`); return null; }
    if (!GLYPHS[key]) { errors.push(`${key}: no glyph`); return null; }
    const c = compose(FRAMES[type], GLYPHS[key], key);
    errors.push(...c.errors);
    return { key, name, band, type, rows: c.rows };
  }).filter(Boolean);
  for (const k of Object.keys(GLYPHS)) if (!FAMILY[k]) errors.push(`${k}: glyph for unknown family`);
  const seen = new Map();
  for (const f of [...types, ...families]) { const s = f.rows.join(''); if (seen.has(s)) errors.push(`${f.key} duplicates ${seen.get(s)}`); seen.set(s, f.key); }
  return { types, families, errors };
}
