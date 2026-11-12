// A World plan: where every region's cell, halls, pads and cables sit, in art px. The desktop map is
// a grid of equal cells (layout.ts); the phone map is a list with the built sites first (list.ts).
import type { Rect } from '../../core';

export type Cols = 1 | 2 | 3 | 4;
export type Lines = 1 | 2 | 3;
export type Path = readonly (readonly [number, number])[];

/** Art px. The west channel (hub and trunk), the channel between columns, the header strip, the gaps. */
export const WEST = 16, CHANNEL = 8, HEAD = 22, ROW_GAP = 4, EAST = 0, SOUTH = 4;
/** The closed regions' plate (list.ts): its head line, a region's line, and where a line's climate starts. */
export const LOCK_HEAD = 12, LOCK_LINE = 8, LOCK_TAB = 56;
/** A cell's header: two text lines on a plate. */
export const SIGN_H = 19;
/** Sea drawn around the map so the view is never bare. */
export const SEA_X = 240, SEA_TOP = 80, SEA_BOTTOM = 120;
/** The scheduler hub, the cables' start under it and the header lane's row. */
export const HUB: Readonly<Rect> = { x: 1, y: 8, w: 14, h: 10 }, TRUNK_X = 8, HUB_FOOT = 18, LANE_Y = 20;

export interface Plan {
  readonly key: string;
  /** The phone list (list.ts): cells differ in size, the built sites come first. */
  readonly list: boolean;
  /** Footer lines under a built site's halls: its state, then its links (on one line, or one each). */
  readonly lines: Lines;
  /** Pan snap pitch (multiples of 8). */
  readonly pitchX: number; readonly pitchY: number;
  /** The world buffer: the map and the sea around it. */
  readonly size: Rect;
  /** The map: what the rest frames. */
  readonly focus: Rect;
  /** Region cell i (REGION_IDS order), its landmass and its cable column (an index into `trunkX`). */
  readonly cells: readonly Rect[]; readonly land: readonly number[]; readonly col: readonly number[];
  /** Zone tile z of the site in cell i: the room's whole world contained, so a room zoom lands on it. */
  readonly tiles: readonly (readonly Rect[])[];
  /**
   * The tiles of a site whose third zone alone is empty: its two halls stand closer and narrower where the pad
   * after them would otherwise be too narrow for the UI's name and price (the third rect is that pad's slot).
   */
  readonly tight: readonly (readonly Rect[])[];
  /**
   * The phone list's closed regions, as one plate: a head line (`LOCK_HEAD`: the UI prints the research that opens
   * them there, once) over a line per region, which is that region's cell. Null where every region is open, and on
   * the desktop grid.
   */
  readonly lock: Rect | null;
  /** Where a build pad sits in an empty cell (the UI prints its name and price on it). */
  readonly pads: readonly Rect[];
  /** The widest a site's zone add pad gets (art px). */
  readonly padMax: number;
  /** Top of the first footer line in a built cell, from the cell's top. */
  readonly footY: number;
  /** The scheduler hub; the pipe enters at its top. */
  readonly hub: Rect;
  /** The header lane's row, and where each cable column leaves it. */
  readonly laneY: number; readonly trunkX: readonly number[];
  /** The data plane's row in cell i, under its halls. */
  readonly planeY: readonly number[];
  /** Cable route i: hub, lane, trunk, then ashore at the cell's landing station. */
  readonly routes: readonly Path[];
}
