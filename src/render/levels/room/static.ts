// Static hall layers, cached per row count (mockup datacenter/world.js backLayer, frontLayer).
// Back: the yard apron, floor tiles and the back wall with its door. Front: side and front walls.
import { BG, P, R, hash, mix, prism, px } from '../../core';
import { drawLayer } from '../rack/art';
import { DOOR, IY, WALL, WORLD_W, WORLD_X, hallOf, worldH } from './layout';

type G = CanvasRenderingContext2D;
export const APRON = mix(BG.room, P.wafer, 0.42);
const FLOOR = P.wafer, GROUT = mix(P.wafer, P.waferLo, 0.7);
export const WALL_FACE = mix(P.substrateHi, P.logicLo, 0.45);
const WALL_TOP = mix(P.steelLo, P.wafer, 0.3);
const scratch = { x: 0, y: 0, w: 0, h: 0 };

function back(g: G, rows: number): void {
  const G0 = hallOf(rows);
  R(g, G0.x - 6, IY - 34, G0.w + 12, G0.ib + 12 - (IY - 34), APRON);
  for (let y = IY - 33; y < G0.ib + 11; y += 3) for (let x = G0.x - 5; x < G0.x + G0.w + 6; x += 3) if (hash(x * 0.37 + y * 3.3) > 0.86) px(g, x, y, mix(APRON, P.waferHi, 0.22));
  R(g, G0.ix, IY, G0.iw, G0.ib - IY, FLOOR);
  for (let y = IY; y < G0.ib; y += 8) R(g, G0.ix, y, G0.iw, 1, GROUT);
  for (let x = G0.ix + 4; x < G0.ix + G0.iw; x += 8) R(g, x, IY, 1, G0.ib - IY, GROUT);
  for (let y = IY + 1; y < G0.ib; y += 8) for (let x = G0.ix + 5; x < G0.ix + G0.iw; x += 8) if (hash(x * 1.3 + y * 7.1) > 0.7) px(g, x + 1, y + 1, mix(FLOOR, P.waferHi, 0.6));
  // back wall: panels and the door to the next zone's corridor
  const top = prism(g, G0.x, IY - 4, G0.w, 4, WALL.z, { top: WALL_TOP, front: WALL_FACE, shadow: false }, scratch);
  const fy = top.y + top.h;
  for (let x = G0.x + 12; x < G0.x + G0.w - 4; x += 16) R(g, x, fy + 2, 1, WALL.z - 4, mix(WALL_FACE, P.ink, 0.3));
  R(g, G0.x, fy + WALL.z - 3, G0.w, 2, mix(WALL_FACE, P.ink, 0.45));
  const dx = DOOR.x;
  R(g, dx, fy + 5, 9, WALL.z - 6, P.ink); R(g, dx + 1, fy + 6, 7, WALL.z - 8, P.steelLo); px(g, dx + 6, fy + 13, P.steelHi);
}
function front(g: G, rows: number): void {
  const G0 = hallOf(rows), len = G0.ib + WALL.t - (IY - 4);
  prism(g, G0.x, IY - 4, WALL.t, len, WALL.z, { top: WALL_TOP, front: WALL_FACE, shadow: false }, scratch);
  prism(g, G0.x + G0.w - WALL.t, IY - 4, WALL.t, len, WALL.z, { top: WALL_TOP, front: WALL_FACE, shadow: false }, scratch);
  const top = prism(g, G0.x, G0.ib, G0.w, WALL.t, 5, { top: WALL_TOP, front: WALL_FACE, sx: 2, sy: 2 }, scratch);
  for (let x = top.x + 6; x < top.x + top.w - 4; x += 10) px(g, x, top.y + top.h + 2, mix(WALL_FACE, P.ink, 0.4));
}
const backDraw = [1, 2, 3].map(rows => (g: G) => back(g, rows));
const frontDraw = [1, 2, 3].map(rows => (g: G) => front(g, rows));
const backKeys = ['room:back:1', 'room:back:2', 'room:back:3'], frontKeys = ['room:front:1', 'room:front:2', 'room:front:3'];
const clampRows = (rows: number): number => Math.max(1, Math.min(3, rows)) - 1;
export function drawBack(g: G, rows: number): void {
  const i = clampRows(rows); drawLayer(g, backKeys[i], WORLD_X + WORLD_W, worldH(i + 1), backDraw[i]);
}
export function drawFront(g: G, rows: number): void {
  const i = clampRows(rows); drawLayer(g, frontKeys[i], WORLD_X + WORLD_W, worldH(i + 1), frontDraw[i]);
}
