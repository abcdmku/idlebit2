// Control deck shell art in art px (control-deck/art.js partIcon, deck-art.js mini, flask). The deck draws these
// at the art scale N, one canvas per icon. Level art and the zoom-rung icons belong to the renderer.
import type { FamilyId } from '../../game';
import { P, R, drawFamilyIcon, mix, px } from '../../render/core';

type G = CanvasRenderingContext2D;
const FILL = '#1b1437';

/** Part icon kinds the deck shows; every build row and callout maps to one. */
export type PartIconKind = 'core' | 'clock' | 'cache' | 'queue' | 'pipe' | 'cpu' | 'ram' | 'gpu' | 'stor'
  | 'cool' | 'power' | 'lb' | 'switch' | 'rack' | 'site';

/** 16 × 16. `dim` greys a locked or unaffordable part. */
export function drawPartIcon(g: G, kind: PartIconKind, dim = false): void {
  g.clearRect(0, 0, 16, 16);
  switch (kind) {
    case 'core':
      R(g, 2, 2, 12, 12, P.ink); R(g, 3, 3, 10, 9, P.logicHi); R(g, 3, 3, 10, 1, '#8a74d8'); R(g, 3, 12, 10, 1, P.logicLo); R(g, 5, 9, 6, 1, P.op); break;
    case 'clock':
      R(g, 1, 4, 14, 9, P.ink); R(g, 2, 5, 12, 7, P.steel); R(g, 2, 5, 12, 1, P.steelHi); R(g, 2, 11, 12, 1, P.steelLo);
      R(g, 4, 7, 8, 3, mix(P.steel, P.steelHi, 0.4)); R(g, 12, 2, 2, 2, P.amber); break;
    case 'cache':
      R(g, 1, 3, 14, 10, P.ink); R(g, 2, 4, 12, 8, P.sram); R(g, 2, 4, 12, 1, mix(P.sram, '#ffffff', 0.2));
      for (let i = 0; i < 4; i++) R(g, 3 + i * 3, 7, 2, 3, i < 2 ? P.cacheOn : P.sramLo);
      break;
    case 'queue':
      R(g, 1, 3, 14, 10, P.ink); R(g, 2, 4, 12, 8, P.logicLo); R(g, 2, 4, 12, 1, P.logic);
      for (let i = 0; i < 3; i++) { R(g, 3 + i * 4, 7, 3, 4, P.ink); R(g, 4 + i * 4, 8, 1, 2, i < 2 ? P.bit : P.logicLo); }
      break;
    case 'pipe':
      R(g, 0, 7, 16, 4, P.ink); R(g, 1, 8, 14, 2, P.net); R(g, 1, 9, 14, 1, '#3f8f54');
      R(g, 10, 4, 6, 10, P.ink); R(g, 11, 5, 4, 8, P.steel); R(g, 12, 7, 2, 1, P.led); break;
    case 'cpu':
      R(g, 2, 2, 12, 12, P.ink); R(g, 3, 3, 10, 10, '#1d3a2e'); R(g, 5, 5, 6, 6, P.wafer); R(g, 6, 6, 4, 4, P.logicHi); break;
    case 'ram':
      R(g, 0, 5, 16, 7, P.ink); R(g, 1, 6, 14, 5, '#3a3256'); for (let i = 0; i < 4; i++) R(g, 2 + i * 3, 7, 2, 3, P.ram); break;
    case 'gpu':
      R(g, 0, 3, 16, 10, P.ink); R(g, 1, 4, 14, 8, P.steelLo); R(g, 3, 5, 6, 6, P.ink); R(g, 4, 6, 4, 4, P.steel); R(g, 11, 5, 3, 6, P.gpu); break;
    case 'stor':
      R(g, 2, 2, 12, 12, P.ink); R(g, 3, 3, 10, 10, P.steel); R(g, 5, 5, 6, 6, P.steelLo); R(g, 7, 7, 2, 2, P.steelHi); break;
    case 'switch':
      R(g, 0, 5, 16, 7, P.ink); R(g, 1, 6, 14, 5, P.steelLo); for (let i = 0; i < 6; i++) R(g, 2 + i * 2, 8, 1, 2, i % 2 ? P.led : P.net); break;
    case 'lb':
      R(g, 0, 5, 16, 7, P.ink); R(g, 1, 6, 14, 5, '#2b2550'); R(g, 3, 7, 5, 3, P.bit); for (let i = 0; i < 3; i++) R(g, 10 + i * 2, 8, 1, 2, P.led); break;
    case 'cool':
      R(g, 1, 1, 14, 14, P.ink); R(g, 2, 2, 12, 12, P.steel); R(g, 4, 4, 8, 8, P.coolLo); R(g, 7, 4, 2, 8, P.coolHi); R(g, 4, 7, 8, 2, P.coolHi); break;
    case 'power':
      R(g, 0, 5, 16, 7, P.ink); R(g, 1, 6, 14, 5, '#2b2550'); R(g, 2, 7, 4, 3, P.led); for (let i = 0; i < 4; i++) R(g, 8 + i * 2, 8, 1, 2, P.amber); break;
    case 'rack':
      R(g, 3, 0, 10, 16, P.ink); R(g, 4, 1, 8, 14, '#2b2550'); for (let i = 0; i < 4; i++) { R(g, 5, 2 + i * 3, 6, 2, P.steelLo); px(g, 6, 2 + i * 3, P.led); } break;
    case 'site':
      R(g, 1, 2, 14, 12, P.ink); R(g, 2, 3, 12, 10, P.landLo); R(g, 5, 5, 6, 6, P.ink); R(g, 6, 6, 4, 4, P.steelLo); px(g, 7, 7, P.led); px(g, 8, 8, P.led); break;
  }
  if (dim) { g.globalAlpha = 0.55; R(g, 0, 0, 16, 16, FILL); g.globalAlpha = 1; }
}

/** 8 × 8 row icon for the desktop build rows. */
export function drawMiniIcon(g: G, kind: PartIconKind, dim = false): void {
  g.clearRect(0, 0, 8, 8);
  const k = P.ink;
  switch (kind) {
    case 'core': R(g, 1, 1, 6, 6, k); R(g, 2, 2, 4, 4, P.logicHi); R(g, 2, 2, 4, 1, '#8a74d8'); R(g, 3, 4, 2, 1, P.op); R(g, 2, 7, 1, 1, P.pad); R(g, 5, 7, 1, 1, P.pad); break;
    case 'clock': R(g, 0, 3, 8, 4, k); R(g, 1, 4, 6, 2, P.steel); R(g, 1, 4, 6, 1, P.steelHi); R(g, 5, 1, 2, 2, P.amber); break;
    case 'cache': R(g, 0, 2, 8, 5, k); R(g, 1, 3, 6, 3, P.sram); px(g, 2, 4, P.cacheOn); px(g, 4, 4, P.cacheOn); px(g, 6, 4, P.sramLo); break;
    case 'queue': R(g, 0, 2, 8, 5, k); R(g, 1, 3, 6, 3, P.logicLo); px(g, 2, 4, P.bit); px(g, 4, 4, P.bit); px(g, 6, 4, P.logic); break;
    case 'pipe': R(g, 0, 3, 8, 3, '#1f4a2c'); R(g, 0, 4, 5, 1, P.net); R(g, 5, 1, 3, 7, k); R(g, 6, 2, 1, 5, P.steel); px(g, 6, 3, P.led); break;
    case 'cpu': R(g, 1, 1, 6, 6, k); R(g, 2, 2, 4, 4, '#1d3a2e'); R(g, 3, 3, 2, 2, P.logicHi); break;
    case 'ram': R(g, 0, 3, 8, 4, k); R(g, 1, 4, 6, 2, '#3a3256'); px(g, 2, 4, P.ram); px(g, 4, 4, P.ram); px(g, 6, 4, P.ram); break;
    case 'gpu': R(g, 0, 2, 8, 5, k); R(g, 1, 3, 6, 3, P.steelLo); R(g, 2, 3, 2, 2, P.steel); R(g, 5, 3, 1, 3, P.gpu); break;
    case 'stor': R(g, 1, 1, 6, 6, k); R(g, 2, 2, 4, 4, P.steel); R(g, 3, 3, 2, 2, P.steelLo); break;
    case 'switch': R(g, 0, 3, 8, 4, k); R(g, 1, 4, 6, 2, P.steelLo); px(g, 2, 4, P.led); px(g, 4, 4, P.net); px(g, 6, 4, P.led); break;
    case 'lb': R(g, 0, 3, 8, 4, k); R(g, 1, 4, 6, 2, '#2b2550'); R(g, 2, 4, 2, 1, P.bit); px(g, 5, 4, P.led); break;
    case 'cool': R(g, 1, 1, 6, 6, k); R(g, 2, 2, 4, 4, P.coolLo); R(g, 3, 2, 2, 4, P.coolHi); R(g, 2, 3, 4, 2, P.coolHi); break;
    case 'power': R(g, 0, 3, 8, 4, k); R(g, 1, 4, 6, 2, '#2b2550'); px(g, 2, 4, P.led); px(g, 4, 4, P.amber); px(g, 6, 4, P.amber); break;
    case 'rack': R(g, 2, 1, 4, 7, k); R(g, 3, 2, 2, 5, '#2b2550'); px(g, 3, 3, P.led); px(g, 3, 5, P.led); break;
    case 'site': R(g, 0, 1, 8, 6, k); R(g, 1, 2, 6, 4, P.landLo); R(g, 3, 3, 2, 2, P.steelLo); break;
  }
  if (dim) { g.globalAlpha = 0.6; R(g, 0, 0, 8, 8, FILL); g.globalAlpha = 1; }
}

/** 16 × 16 research flask. */
export function drawFlask(g: G): void {
  g.clearRect(0, 0, 16, 16);
  R(g, 5, 0, 6, 3, P.ink); R(g, 6, 3, 4, 3, P.ink);
  R(g, 5, 6, 6, 1, P.ink); R(g, 4, 7, 8, 1, P.ink); R(g, 3, 8, 10, 6, P.ink); R(g, 4, 14, 8, 1, P.ink);
  R(g, 6, 1, 4, 1, '#dbb587'); R(g, 7, 2, 2, 1, '#95664f');
  R(g, 7, 3, 2, 4, '#91b9d6'); R(g, 6, 6, 4, 2, '#91b9d6');
  R(g, 5, 7, 6, 2, '#91b9d6'); R(g, 4, 8, 8, 5, '#b5dceb'); R(g, 5, 13, 6, 1, '#6e91ba');
  R(g, 5, 9, 6, 4, '#e969cb'); R(g, 4, 10, 8, 2, '#dc4cb6'); R(g, 5, 12, 6, 1, '#9c398e');
  R(g, 4, 9, 1, 3, '#edfbff'); px(g, 5, 8, '#ffffff'); px(g, 6, 10, '#ffd8f7'); px(g, 9, 11, '#ffb8ea');
}

/** A 14 × 14 toothed gear centered in its 16 px cell, with a round bore and shaded metal rim. */
export function drawGear(g: G): void {
  g.clearRect(0, 0, 16, 16);
  const mask = ['00000111100000', '00000111100000', '00110111101100', '00111111111100',
    '00011111111000', '11111111111111', '11111100111111', '11111100111111',
    '11111111111111', '00011111111000', '00111111111100', '00110111101100',
    '00000111100000', '00000111100000'];
  const solid = (x: number, y: number) => mask[y]?.[x] === '1';
  for (let y = 0; y < 14; y++) for (let x = 0; x < 14; x++) if (solid(x, y)) {
    const boreEdge = (x === 5 || x === 8) && (y === 6 || y === 7)
      || (y === 5 || y === 8) && (x === 6 || x === 7);
    const lit = !solid(x - 1, y) || !solid(x, y - 1);
    const shaded = !solid(x + 1, y) || !solid(x, y + 1);
    px(g, x + 1, y + 1, boreEdge ? '#51466f' : lit ? '#dfdcff' : shaded ? '#776caa' : '#b2a9df');
  }
}

/** 16 × 16 task icon: the family's Control deck icon (14 × 14 in its 16 px cell), in its band colour. */
export function drawTaskIcon(g: G, family: FamilyId): void {
  g.clearRect(0, 0, 16, 16);
  drawFamilyIcon(g, family, 0, 0);
}
