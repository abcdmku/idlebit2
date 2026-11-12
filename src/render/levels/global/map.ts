// The static World map for a plan, one colour per pixel: open sea, shelf and coast, cliffs, and
// each region's ground in its outside-air climate. Cached per plan; nothing here moves.
import { REGIONS } from '../../../game';
import { P, hash, mix } from '../../core';
import type { Plan } from './layout';

export const CLIMATE = {
  cold: { top: '#7d87a6', hi: '#9aa3bf', lo: '#68718f', mark: P.coolHi },
  cool: { top: '#335a48', hi: '#40705a', lo: '#2a4a3c', mark: P.cool },
  mild: { top: '#3f6340', hi: '#4f7a4e', lo: '#335235', mark: P.led },
  hot: { top: '#7e6a45', hi: '#988257', lo: '#685739', mark: P.heatHi },
} as const;
export const climateOf = (f: number): keyof typeof CLIMATE => (f <= 46 ? 'cold' : f <= 60 ? 'cool' : f <= 79 ? 'mild' : 'hot');
export const SEA = mix(P.seaDeep, P.ink, 0.35);
const SEA_LO = mix(P.seaDeep, P.ink, 0.55), SHELF = mix(P.seaShelf, P.ink, 0.35), CLIFF_LO = mix(P.cliff, P.ink, 0.4);
const GROUND = REGIONS.map(r => CLIMATE[climateOf(r.outsideF)]);

interface Mask { readonly w: number; readonly h: number; readonly land: Uint8Array; readonly cell: Uint8Array }
const masks = new Map<string, Mask>();
/** Land (1) and the region each land pixel belongs to. A region's ground is its cell and a 2 px apron; cells on one landmass join. */
function maskOf(p: Plan): Mask {
  let m = masks.get(p.key);
  if (m) return m;
  // (a few px past the map's east edge, so the last column keeps its coast)
  const w = p.focus.w + 8, h = p.focus.h, land = new Uint8Array(w * h), cell = new Uint8Array(w * h);
  const put = (x: number, y: number, i: number) => { if (x >= 0 && y >= 0 && x < w && y < h && !land[y * w + x]) { land[y * w + x] = 1; cell[y * w + x] = i; } };
  // the closed regions' plate (list): its head line stands on the ground of the region under it
  if (p.lock) for (let i = 0; i < p.cells.length; i++) {
    const b = p.cells[i]!, L = p.lock;
    if (b.y < L.y || b.y + b.h > L.y + L.h) continue;
    for (let y = L.y - 2; y < b.y - 2; y++) for (let x = b.x - 1; x < b.x + b.w + 1; x++) put(x, y, i);
  }
  for (let i = 0; i < p.cells.length; i++) {
    const b = p.cells[i]!;
    for (let y = b.y - 2; y < b.y + b.h + 2; y++) for (let x = b.x - 1; x < b.x + b.w + 1; x++) put(x, y, i);
    // the ground between two cells of one landmass in a column
    for (let j = 0; j < p.cells.length; j++) {
      const o = p.cells[j]!;
      if (j === i || p.land[j] !== p.land[i] || o.x !== b.x || o.y !== b.y + p.pitchY) continue;
      for (let y = b.y + b.h + 2; y < o.y - 2; y++) for (let x = b.x - 1; x < b.x + b.w + 1; x++) put(x, y, i);
    }
    // and between two cells of one landmass in a row
    for (let j = 0; j < p.cells.length; j++) {
      const o = p.cells[j]!;
      if (j === i || p.land[j] !== p.land[i] || o.y !== b.y || o.x !== b.x + p.pitchX) continue;
      for (let y = b.y - 2; y < b.y + b.h + 2; y++) for (let x = b.x + b.w + 1; x < o.x - 1; x++) put(x, y, i);
    }
    // a ragged coast: a pixel out here and there on the east side and the open ends
    for (let y = b.y; y < b.y + b.h; y++) if (hash(y * 0.37 + i * 11) > 0.6) put(b.x + b.w + 1, y, i);
    for (let x = b.x + 3; x < b.x + b.w - 3; x++) {
      if (hash(x * 0.53 + i * 7) > 0.62) put(x, b.y - 3, i);
      if (hash(x * 0.71 + i * 5) > 0.7) put(x, b.y + b.h + 2, i);
    }
  }
  m = { w, h, land, cell }; masks.set(p.key, m);
  return m;
}

/** Draw the whole static map for `p` into its world buffer (art px, origin at the map's corner). */
export function drawMap(g: CanvasRenderingContext2D, p: Plan): void {
  const m = maskOf(p), S = p.size;
  const at = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < m.w && y < m.h && m.land[y * m.w + x] === 1;
  // swell marks thin out away from the map, so the sea meets the view's flat fill without an edge
  const far = (x: number, y: number): number => Math.max(-x, x - m.w, -y, y - m.h, 0);
  const pixel = (x: number, y: number): string => {
    if (at(x, y)) {
      const C = GROUND[m.cell[y * m.w + x]!]!, n = hash(x * 12.99 + y * 78.23);
      if (!at(x, y - 1) || !at(x - 1, y)) return C.hi;
      if (!at(x + 1, y) || n < 0.06) return C.lo;
      return n > 0.975 ? C.hi : C.top;
    }
    if (at(x, y - 1)) return P.cliff;
    if (at(x, y - 2)) return CLIFF_LO;
    if (at(x - 1, y) || at(x + 1, y) || at(x, y + 1) || at(x, y - 3)) return P.coast;
    if (at(x - 2, y) || at(x + 2, y) || at(x, y + 2) || at(x, y - 4)) return SHELF;
    const d = far(x, y);
    return y % 3 === 0 && (x * 7 + y) % 11 < 2 && hash(x * 3.1 + y * 0.7) > 0.5 + d / 160 ? SEA_LO : SEA;
  };
  for (let y = S.y; y < S.y + S.h; y++) {
    let x0 = S.x, c = pixel(S.x, y);
    for (let x = S.x + 1; x <= S.x + S.w; x++) {
      const n = x < S.x + S.w ? pixel(x, y) : '';
      if (n !== c) { g.fillStyle = c; g.fillRect(x0 - S.x, y - S.y, x - x0, 1); x0 = x; c = n; }
    }
  }
}
