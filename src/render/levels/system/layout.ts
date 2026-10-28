// System world (mockup v3 levels/system/layout.js): one motherboard in 3/4 view. Every part has a
// fixed site on its board, so the layout never shifts when a part is added. Two boards (D7):
//   general:     1-4 CPU sockets in a 2x2 block, 4 horizontal DIMMs, 4 GPU slots, 4 drive bays;
//   accelerator: 2 CPU sockets, 8 vertical DIMMs, an 8-GPU baseboard, 4 M.2 drives.
// Nothing on a board cools; cooling starts at the rack.
import type { BoardKind } from '../../../game';
import type { Rect, WorldForm } from '../../core';

/** The board world: what a parent's mini of the System shows (miniRect). */
export const WORLD: Readonly<Rect> = { x: 0, y: 0, w: 168, h: 236 };
/** Desktop adds 16 art px each side for the label leaders (Control deck systemLabels). */
export const MARGIN = 16;
/** Slab footprint; its top face is z px higher and its front face ends at 200. */
export const BOARD = { x: 8, y: 34, w: 152, h: 166, z: 6 } as const;
/** The board and its separate resource rows below, within the existing view footprint. */
export const FOCUS: Readonly<Rect> = { x: 6, y: 28, w: 156, h: 192 };

/** Integrated network link at the rear edge; its cable comes down from the world's top edge. */
/** D35: the pipe from the switch enters the board at a plain connector on its rear edge (no port). */
export const CABLE_X = 33;
export const CONNECTOR = { x: CABLE_X - 3, y: BOARD.y - 2, w: 7, h: 4 } as const;
/** The board PSU in the rear strip (mockup core/power.js SUPPLIES.system). */
export const PSU: Readonly<Rect> = { x: 57, y: 47, w: 46, h: 10 };
/** The power supply's tile: its body and the 5 px top it stands up to (the hit rect and the outline). */
export const PSU_TILE: Readonly<Rect> = { x: PSU.x - 2, y: PSU.y - 7, w: PSU.w + 4, h: PSU.h + 9 };
/** Reserved spot for the save icon: rear right corner, clear of the PSU and the pipe's connector. */
export const SAVE = { x: 138, y: 37 } as const;
/** The system's online lamp, inline after the board silk. */
export const LAMP = { x: 77, y: 32, w: 12 } as const;
/** Brownout and dark states dim the board's top face. */
export const POWERED: Readonly<Rect> = { x: 8, y: 28, w: 152, h: 172 };
export const DIMM_Z = 10;

export type SiteType = 'cpu' | 'ram' | 'gpu' | 'drive';
export interface BoardLayout {
  readonly silk: string;
  /** 'h': horizontal DIMMs, cards and bays (general); 'v': vertical DIMMs, modules and M.2 (accelerator). */
  readonly dimm: 'h' | 'v';
  readonly sites: Readonly<Record<SiteType, readonly Rect[]>>;
}
const S = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h });
export const BOARDS: Readonly<Record<BoardKind, BoardLayout>> = {
  general: {
    silk: 'BR-1', dimm: 'h',
    sites: {
      cpu: [S(12, 61, 46, 46), S(60, 61, 46, 46), S(12, 109, 46, 46), S(60, 109, 46, 46)],
      ram: [73, 82, 91, 100].map(y => S(110, y, 46, 3)),
      drive: [S(110, 109, 22, 22), S(134, 109, 22, 22), S(110, 133, 22, 22), S(134, 133, 22, 22)],
      gpu: [S(12, 158, 71, 18), S(85, 158, 71, 18), S(12, 180, 71, 18), S(85, 180, 71, 18)], }, },
  accelerator: {
    silk: 'AX-8', dimm: 'v',
    sites: {
      cpu: [S(12, 61, 46, 46), S(86, 61, 46, 46)],
      ram: [61, 67, 73, 79, 135, 141, 147, 153].map(x => S(x, 66, 3, 40)),
      gpu: [117, 151].flatMap(y => [12, 49, 86, 123].map(x => S(x, y, 33, 28))),
      drive: [12, 48, 84, 120].map(x => S(x + 2, 185, 32, 5)), }, }, };
export const boardOf = (kind: BoardKind): BoardLayout => BOARDS[kind] ?? BOARDS.general;

/** Hit and highlight rect for a site: its footprint plus what stands above it. Writes `out`. */
export function siteRect(b: BoardLayout, type: SiteType, i: number, out: Rect = S(0, 0, 0, 0)): Rect {
  const f = b.sites[type][i]!;
  if (type === 'ram') {
    if (b.dimm === 'h') { out.x = f.x - 1; out.y = f.y - DIMM_Z - 1; out.w = f.w + 2; out.h = DIMM_Z + 4; }
    else { out.x = f.x - 2; out.y = f.y - 3; out.w = f.w + 3; out.h = f.h + 3; }
    return out;
  }
  const z = type === 'cpu' ? 2 : 6;
  out.x = f.x; out.y = f.y - z; out.w = f.w; out.h = f.h + z;
  return out;
}
/** CPU package top face inside socket i; the CPU world (its package) maps into this square. */
export function packageRect(b: BoardLayout, i: number, out: Rect = S(0, 0, 0, 0)): Rect {
  const f = b.sites.cpu[i]!;
  out.x = f.x + 5; out.y = f.y + 2; out.w = 36; out.h = 36;
  return out;
}
export function siteCentre(b: BoardLayout, type: SiteType, i: number, out: { x: number; y: number }): { x: number; y: number } {
  const f = b.sites[type][i]!;
  out.x = f.x + (f.w >> 1); out.y = f.y + (f.h >> 1);
  return out;
}

/** The world per layout form: the board, plus the leader margins on desktop. */
export function worldRect(form: WorldForm | undefined, out: Rect): Rect {
  const wide = form !== 'phone';
  out.x = wide ? -MARGIN : 0; out.y = 0; out.w = WORLD.w + (wide ? 2 * MARGIN : 0); out.h = WORLD.h;
  return out;
}
