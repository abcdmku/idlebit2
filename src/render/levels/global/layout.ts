// World geometry (mockup levels/global/look-c.js "Continents", cleaned for the game's regions):
// the eight regions as cells of blocky continents laid out roughly as they sit on the globe,
// Americas west, Europe and Africa centre, Asia-Pacific east, north up. A cell's ground is its
// outside air. Built cells carry their site's AZ halls; the backbone runs through the oceans
// from the scheduler hub beside the gateway. Everything here is computed once at import.
import { REGIONS, REGION_IDS } from '../../../game';
import type { RegionId } from '../../../game';
import { P, hash, mix, rect } from '../../core';
import type { Rect } from '../../core';
import { MINI_SIZE } from '../room/mini';

export const SIZE = rect(0, 0, 288, 156);
export const FOCUS = rect(0, 0, 288, 156);
const PW = 84, PH = 46, COLX = [6, 102, 198], ROWY = [6, 55, 104];
/** Region → [column, row]. */
const CELL: Readonly<Record<RegionId, readonly [number, number]>> = {
  'us-west': [0, 0], 'us-east': [0, 1], 'sa-east': [0, 2],
  'eu-north': [1, 0], 'eu-west': [1, 1], 'af-south': [1, 2],
  'ap-northeast': [2, 0], 'ap-southeast': [2, 2],
};
/** Continents as runs of rows in a column: N America, S America, Europe, Africa, Asia, South-East Asia. */
const LANDS: readonly (readonly [number, number, number])[] = [[0, 0, 1], [0, 2, 2], [1, 0, 1], [1, 2, 2], [2, 0, 0], [2, 2, 2]];
/** Sign names: silkscreen markings on the map. */
export const REGION_SIGNS: Readonly<Record<RegionId, string>> = {
  'us-east': 'US EAST', 'us-west': 'US WEST', 'eu-west': 'EU WEST', 'eu-north': 'EU NORTH',
  'sa-east': 'SA EAST', 'af-south': 'AF SOUTH', 'ap-southeast': 'AP SOUTH', 'ap-northeast': 'AP NORTH',
};
export const CLIMATE = {
  cold: { top: '#7d87a6', hi: '#9aa3bf', lo: '#68718f', mark: P.coolHi },
  cool: { top: '#335a48', hi: '#40705a', lo: '#2a4a3c', mark: P.cool },
  mild: { top: '#3f6340', hi: '#4f7a4e', lo: '#335235', mark: P.led },
  hot: { top: '#7e6a45', hi: '#988257', lo: '#685739', mark: P.heatHi },
} as const;
export const climateOf = (f: number): keyof typeof CLIMATE => (f <= 46 ? 'cold' : f <= 60 ? 'cool' : f <= 79 ? 'mild' : 'hot');
export const SEA = mix(P.seaDeep, P.ink, 0.35), SEA_LO = mix(P.seaDeep, P.ink, 0.55);

/** Region cell i (REGION_IDS order). */
export const CELLS: readonly Rect[] = REGION_IDS.map(id => { const [c, j] = CELL[id]; return rect(COLX[c], ROWY[j], PW, PH); });
export const SIGN_H = 14;
/** Zone tile z of the site in cell i: the room's whole world contained, so a room zoom lands on it. */
export const TILE = { w: 24, h: Math.round(24 * MINI_SIZE.h / MINI_SIZE.w), gap: 3 } as const;
export const TILES: readonly (readonly Rect[])[] = CELLS.map(b =>
  [0, 1, 2].map(z => rect(b.x + 3 + z * (TILE.w + TILE.gap), b.y + PH - 3 - TILE.h, TILE.w, TILE.h)));
/** Where the backbone comes ashore: the cell's ocean-side edge, low. */
export function landing(i: number): { x: number; y: number } {
  const b = CELLS[i], c = CELL[REGION_IDS[i]][0];
  return { x: c === 0 ? b.x + b.w - 2 : b.x + 1, y: b.y + SIGN_H + 6 };
}
/** The global scheduler hub, in the ocean east of the gateway's cell. The pipe enters at its top. */
export function hubRect(gateway: number, out: Rect): Rect {
  const b = CELLS[gateway], x = b.x + b.w + 2;
  out.x = x; out.y = b.y + SIGN_H + 2; out.w = 10; out.h = 10;
  return out;
}

const climateOfRegion = REGIONS.map(r => CLIMATE[climateOf(r.outsideF)]);
/** Nearest region cell to a land pixel. */
function cellAt(x: number, y: number): number {
  let best = 0, bd = 1e9;
  for (let r = 0; r < CELLS.length; r++) {
    const b = CELLS[r], dx = Math.max(b.x - x, 0, x - (b.x + b.w - 1)), dy = Math.max(b.y - y, 0, y - (b.y + b.h - 1));
    if (dx + dy < bd) { bd = dx + dy; best = r; }
  }
  return best;
}
/** Land mask (1 = land), with a ragged coast a pixel or two deep, never under a cell's content. */
export const LAND: Uint8Array = (() => {
  const W = SIZE.w, H = SIZE.h, land = new Uint8Array(W * H);
  for (const [c, j0, j1] of LANDS) {
    const x0 = COLX[c], x1 = x0 + PW, y0 = ROWY[j0], y1 = ROWY[j1] + PH;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) land[y * W + x] = 1;
    for (let y = y0 + 2; y < y1 - 2; y++) {
      for (const [edge, dir] of [[x0 - 1, -1], [x1, 1]] as const) {
        const n = hash(y * 0.37 + c * 11 + dir), d = n > 0.8 ? 2 : n > 0.55 ? 1 : 0;
        for (let k = 0; k < d; k++) { const x = edge + dir * k; if (x >= 0 && x < W) land[y * W + x] = 1; }
      }
    }
    for (let x = x0 + 3; x < x1 - 3; x++) {
      const n = hash(x * 0.53 + j0 * 7 + c), d = n > 0.82 ? 2 : n > 0.6 ? 1 : 0;
      for (let k = 1; k <= d; k++) if (y0 - k >= 0) land[(y0 - k) * W + x] = 1;
    }
  }
  return land;
})();
const at = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < SIZE.w && y < SIZE.h && LAND[y * SIZE.w + x] === 1;

/** The static map, one colour per pixel: ocean, coast, cliffs, region ground by climate. */
export function mapPixel(x: number, y: number): string {
  if (at(x, y)) {
    const r = cellAt(x, y), C = climateOfRegion[r], n = hash(x * 12.99 + y * 78.23), b = CELLS[r];
    if ((y === b.y - 2 || y === b.y + b.h + 1) && (x >> 1) % 2 === 0 && at(x, y - 3) && at(x, y + 3)) return mix(C.lo, P.ink, 0.35);
    if (!at(x, y - 1) || !at(x - 1, y)) return C.hi;
    if (!at(x + 1, y) || n < 0.06) return C.lo;
    return n > 0.975 ? C.hi : C.top;
  }
  if (at(x, y - 1)) return P.cliff;
  if (at(x, y - 2)) return mix(P.cliff, P.ink, 0.4);
  if (at(x - 1, y) || at(x + 1, y) || at(x, y + 1) || at(x, y - 3)) return P.coast;
  if (at(x - 2, y) || at(x + 2, y) || at(x, y + 2) || at(x, y - 4)) return mix(P.seaShelf, P.ink, 0.35);
  return y % 3 === 0 && (x * 7 + y) % 11 < 2 && hash(x * 3.1 + y * 0.7) > 0.5 ? SEA_LO : SEA;
}
