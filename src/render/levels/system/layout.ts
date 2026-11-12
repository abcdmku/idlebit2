// System world (mockup v3 levels/system/layout.js): one motherboard in 3/4 view. Every part has a
// fixed site on its board, so the layout never shifts when a part is added. Two boards (D7):
//   general:     1-4 CPU sockets in a 2x2 block, 4 horizontal DIMMs, 4 GPU slots, 4 drive bays;
//   accelerator: 2 CPU sockets, 8 vertical DIMMs, an 8-GPU baseboard, 4 M.2 drives.
// Each board has three floorplans, and rests on the first that fits the free world whole (D15.2):
//   portrait:  the original board (156 × 188 art px with its memory rows);
//   landscape: the GPUs beside the sockets (228 × 146), for a wide, short world (desktop at N = 3);
//   compact:   a narrower board (144 wide) for 320 px phones: smaller bays, and its two GPU slots in one row.
// Nothing on a board cools; cooling starts at the rack.
import type { BoardKind } from '../../../game';
import type { Point, Rect, RestArea, WorldForm } from '../../core';

/** Desktop adds 16 art px each side for the label leaders (Control deck systemLabels). */
export const MARGIN = 16;
/** Every plan's slab starts here: its top face is BOARD_Z px higher, and the rest frames from that edge. */
export const BOARD_X = 8, BOARD_Y = 34, BOARD_Z = 6;
/** D35: the pipe from the switch enters the board at a plain connector on its rear edge (no port). */
export const CABLE_X = 33;
export const CONNECTOR = { x: CABLE_X - 3, y: BOARD_Y - 2, w: 7, h: 4 } as const;
/** The board silk, and the system's online lamp inline after it. */
export const SILK = { x: 58, y: 31 } as const;
export const LAMP = { x: 77, y: 32, w: 12 } as const;
export const DIMM_Z = 10;

export type SiteType = 'cpu' | 'ram' | 'gpu' | 'drive';
export interface BoardLayout {
  /** Board and floorplan: the key of everything cached per plan. */
  readonly key: string;
  readonly silk: string;
  /** 'h': horizontal DIMMs, cards and bays (general); 'v': vertical DIMMs, modules and M.2 (accelerator). */
  readonly dimm: 'h' | 'v';
  readonly sites: Readonly<Record<SiteType, readonly Rect[]>>;
  /** Slab footprint; its top face is z px higher and its front face ends at y + h. */
  readonly board: { readonly x: number; readonly y: number; readonly w: number; readonly h: number; readonly z: number };
  /** The board world: what a parent's mini of the System shows (miniRect). */
  readonly world: Rect;
  /** The board and its two resource rows (8 art px each) directly below it: what the rest frames, whole. */
  readonly focus: Rect;
  /** Reserved spot for the save icon: rear right corner, clear of the pipe's connector. */
  readonly save: Point;
  /** Brownout and dark states dim the board's top face. */
  readonly powered: Rect;
  /** Set dressing: the first of three chokes (null: no room), and the capacitors. */
  readonly chokes: Point | null;
  readonly caps: readonly Point[];
  /** Desktop: the margin the GPU label and its leader take (the side its cards sit on). */
  readonly gpuSide: 'L' | 'R';
}
const S = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h });
type Sites = BoardLayout['sites'];
function plan(key: string, silk: string, dimm: 'h' | 'v', w: number, h: number, sites: Sites, chokes: Point | null,
  caps: readonly (readonly [number, number])[], gpuSide: 'L' | 'R' = 'L'): BoardLayout {
  return {
    key, silk, dimm, sites, chokes, gpuSide, caps: caps.map(([x, y]) => ({ x, y })),
    board: { x: BOARD_X, y: BOARD_Y, w, h, z: BOARD_Z },
    world: S(0, 0, w + 2 * BOARD_X, h + 70),
    focus: S(BOARD_X - 2, BOARD_Y - BOARD_Z, w + 4, h + BOARD_Z + 16),
    save: { x: BOARD_X + w - 22, y: 37 },
    powered: S(BOARD_X, BOARD_Y - BOARD_Z, w, h + BOARD_Z),
  };
}
const quad = (x: number, y: number, w: number, h: number, dx: number, dy: number): Rect[] => [S(x, y, w, h), S(x + dx, y, w, h), S(x, y + dy, w, h), S(x + dx, y + dy, w, h)];
const row4 = (xs: readonly number[], y: number, w: number, h: number): Rect[] => xs.map(x => S(x, y, w, h));
const CHOKES: Point = { x: 108, y: 56 };

/** Floorplans per board, in the order they are tried. */
export const PLANS: Readonly<Record<BoardKind, readonly BoardLayout[]>> = {
  general: [
    // (the sockets, DIMMs and bays sit 3 px up the rear strip, so the drives' tiles clear the GPU slots')
    plan('general:portrait', 'BR-1', 'h', 152, 166, {
      cpu: quad(12, 58, 46, 46, 48, 48),
      ram: [70, 79, 88, 97].map(y => S(110, y, 46, 3)),
      drive: quad(110, 106, 22, 22, 24, 24),
      gpu: quad(12, 158, 71, 18, 73, 22),
    }, { x: 108, y: 53 }, [[155, 166], [155, 194]]),
    // the GPU slots stand in a column at the right, so the board is as tall as its sockets
    plan('general:landscape', 'BR-1', 'h', 224, 124, {
      cpu: quad(12, 61, 46, 46, 48, 48),
      ram: [73, 82, 91, 100].map(y => S(110, y, 46, 3)),
      drive: quad(110, 109, 22, 22, 24, 24),
      gpu: [66, 90, 114, 138].map(y => S(160, y, 68, 18)),
    }, CHOKES, [[168, 54], [178, 54]], 'R'),
    // a 20 px rear strip, a 40 px memory column, and under the sockets one row with the two GPU slots a general
    // board can fill (game-spec §8.3), each wide enough for the UI's name over its price with room to spare at 2
    plan('general:compact', 'BR-1', 'h', 140, 136, {
      cpu: quad(10, 48, 46, 46, 48, 48),
      ram: [60, 69, 78, 87].map(y => S(107, y, 38, 3)),
      drive: quad(106, 100, 19, 18, 21, 24),
      gpu: [S(10, 150, 67, 18), S(79, 150, 67, 18)],
    }, null, []),
  ],
  accelerator: [
    plan('accelerator:portrait', 'AX-8', 'v', 152, 166, {
      cpu: [S(12, 61, 46, 46), S(86, 61, 46, 46)],
      ram: [61, 67, 73, 79, 135, 141, 147, 153].map(x => S(x, 66, 3, 40)),
      gpu: [117, 151].flatMap(y => row4([12, 49, 86, 123], y, 33, 28)),
      drive: row4([14, 50, 86, 122], 185, 32, 5),
    }, CHOKES, [[155, 120], [155, 166]]),
    // the sockets stacked at the left with their DIMMs, the baseboard beside them, the M.2 row under it
    plan('accelerator:landscape', 'AX-8', 'v', 224, 124, {
      cpu: [S(12, 61, 46, 46), S(12, 109, 46, 46)],
      ram: [66, 114].flatMap(y => row4([62, 68, 74, 80], y, 3, 40)),
      gpu: [69, 103].flatMap(y => row4([90, 125, 160, 195], y, 33, 28)),
      drive: row4([91, 126, 161, 196], 146, 32, 5),
    }, CHOKES, [], 'R'),
    // an 18 px rear strip, the DIMMs between the sockets, narrower modules
    plan('accelerator:compact', 'AX-8', 'v', 140, 142, {
      cpu: [S(10, 46, 46, 46), S(100, 46, 46, 46)],
      ram: [60, 65, 70, 75, 80, 85, 90, 95].map(x => S(x, 50, 3, 40)),
      gpu: [100, 134].flatMap(y => row4([11, 45, 79, 113], y, 32, 28)),
      drive: row4([11, 45, 79, 113], 168, 32, 5),
    }, null, []),
  ],
};

/** The free world at rest (CSS px and the shell's N), set by the level's `focus()`; null before the first rest. */
let rest: RestArea | null = null;
export function setRestArea(area: RestArea | undefined): void { rest = area ?? null; }
/** CSS px a plan keeps free above or below it where another plan can: a board flush with both the strip and the view's foot reads as cut. */
const SLACK = 16;
const fits = (p: BoardLayout, n: number, slack = 0): boolean => !!rest && p.focus.w * n <= rest.w && p.focus.h * n + slack <= rest.h;
/**
 * The floorplan a board rests on: the first that fits the free world whole at the shell's N with SLACK
 * to spare (844 × 390: the landscape board, not the portrait one edge to edge), else the first that
 * fits at all, else the same at each lower scale down to 2 (D15.2). Where none fits at 2, the first
 * whose width does (it pans down). Before the first rest (previews, the harness): the portrait board.
 */
export function boardOf(kind: BoardKind): BoardLayout {
  const list = PLANS[kind] ?? PLANS.general;
  if (!rest) return list[0]!;
  for (let n = rest.scale; n >= 2; n--) {
    for (const p of list) if (fits(p, n, SLACK)) return p;
    for (const p of list) if (fits(p, n)) return p;
  }
  for (const p of list) if (p.focus.w * 2 <= rest.w) return p;
  return list[list.length - 1]!;
}

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
export function worldRect(b: BoardLayout, form: WorldForm | undefined, out: Rect): Rect {
  const wide = form !== 'phone';
  out.x = wide ? -MARGIN : 0; out.y = 0; out.w = b.world.w + (wide ? 2 * MARGIN : 0); out.h = b.world.h;
  return out;
}
