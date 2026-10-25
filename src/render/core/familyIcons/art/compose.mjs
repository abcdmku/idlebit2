// Drafting helpers and the composer for the task icons. Pure Node, no deps.
// A glyph is a 10-row string array or a function that draws into a 10×10 grid with these helpers.
// compose() stamps a glyph into its type frame (14×14), checks every glyph pixel lands on the
// frame's plate, pads to the 16×16 cell and bakes a 1 px ink outline ('o') around the silhouette.
export const CELL = 16, ART = 14, GLYPH = 10;
export const INK = '#0e0b1c';
const COLOURS = new Set('ladwk');

export const grid = (w = GLYPH, h = GLYPH) => Array.from({ length: h }, () => Array(w).fill('.'));
export const put = (G, x, y, c) => { if (y >= 0 && y < G.length && x >= 0 && x < G[0].length) G[y][x] = c; };
export const rect = (G, x, y, w, h, c) => { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) put(G, x + i, y + j, c); };
export function line(G, x0, y0, x1, y1, c) {
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let e = dx + dy;
  for (;;) {
    put(G, x0, y0, c);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * e;
    if (e2 >= dy) { e += dy; x0 += sx; }
    if (e2 <= dx) { e += dx; y0 += sy; }
  }
}
/** Stamp `rows` (strings, '.' transparent) with its top-left at (x, y). */
export function stamp(G, rows, x = 0, y = 0) {
  rows.forEach((r, j) => [...r].forEach((c, i) => { if (c !== '.') put(G, x + i, y + j, c); }));
}
const rows = (G) => G.map((r) => r.join(''));

/** Resolve a glyph (rows or draw function) to 10 rows of 10 chars. */
export function glyphRows(glyph) {
  if (typeof glyph === 'function') { const G = grid(); glyph(G); return rows(G); }
  return glyph;
}

/** Compose `glyph` into `frame` ({ rows, box }) and return 16 rows with the baked outline. */
export function compose(frame, glyph, id = '?') {
  const errors = [];
  const F = frame.rows.map((r) => [...r]);
  if (F.length !== ART || F.some((r) => r.length !== ART)) errors.push(`${id}: frame is not ${ART}×${ART}`);
  const g = glyphRows(glyph);
  if (g.length !== GLYPH || g.some((r) => r.length !== GLYPH)) errors.push(`${id}: glyph is not ${GLYPH}×${GLYPH}`);
  g.forEach((r, j) => [...r].forEach((c, i) => {
    if (c === '.') return;
    if (!COLOURS.has(c)) { errors.push(`${id}: bad glyph char '${c}' at ${i},${j}`); return; }
    const x = frame.box.x + i, y = frame.box.y + j;
    if (F[y]?.[x] !== 'k') { errors.push(`${id}: glyph pixel ${i},${j} lands on frame '${F[y]?.[x]}'`); return; }
    F[y][x] = c;
  }));
  const C = Array.from({ length: CELL }, (_, y) => Array.from({ length: CELL }, (_, x) => F[y - 1]?.[x - 1] ?? '.'));
  const filled = (x, y) => C[y]?.[x] !== undefined && C[y][x] !== '.' && C[y][x] !== 'o';
  for (let y = 0; y < CELL; y++) for (let x = 0; x < CELL; x++) {
    if (C[y][x] !== '.') continue;
    if (filled(x - 1, y) || filled(x + 1, y) || filled(x, y - 1) || filled(x, y + 1)) C[y][x] = 'o';
  }
  return { rows: rows(C), errors };
}

/** '#rrggbb' mix, t = 0 → a, 1 → b. */
export function mix(a, b, t) {
  let out = '#';
  for (let i = 1; i <= 5; i += 2) {
    const av = parseInt(a.slice(i, i + 2), 16), bv = parseInt(b.slice(i, i + 2), 16);
    out += Math.round(av + (bv - av) * t).toString(16).padStart(2, '0');
  }
  return out;
}
