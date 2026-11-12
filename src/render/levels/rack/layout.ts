// Rack world (mockup levels/rack/layout.js): one cabinet in 3/4 view, front face toward the player.
// Cooling is the roof; D31's Power control takes the U directly under it, then the Switch and Load
// balancer; Power is the PDU strip on the right post with its head on the plinth. Twelve server slots
// fill the rest.
//
// The cabinet is planned for the free world it rests in (`planFor`, called by the level's `focus()`):
//   tower: one bay of 12 px units, 126 × 218 art px. The tall view (a portrait phone at 2).
//   twin:  two bays side by side, 228 × 174. The wide, short view (a desktop at N = 3, a landscape phone). Power
//          control, Switch and Balancer head the left bay, a blank panel beside them carries their names
//          (labels.ts), and six sleds stand under each on a 16 px pitch: every display line is then on the core's
//          8 CSS px text grid at 3 as well as at 2.
//   half:  one bay, 142 × 162, each server row holding two half-width sleds. The small phone, with no room beside
//          the cabinet for name tags: the Switch and the Balancer are 20 px tall and carry theirs on the faceplate.
// The first plan that rests whole at the largest scale wins. Everything below that is not `const` is the live
// plan: read it at draw time, never at import.
import { RACK_SLOTS_PER_ROW } from '../../../game';
import { rect, setRect } from '../../core';
import type { Rect, RestArea } from '../../core';

export type RackPlan = 'tower' | 'twin' | 'half';
/** The tower's unit pitch and first unit (the room's rack mini reads the tower at 1/8). U0 + 2 is a multiple of 4. */
export const U = 12, U0 = 30, SERVER_SLOTS = 12, SRV_U0 = 3;
/** A unit's display window starts 2 px under its face's top and is one 8 art px text line tall (16 CSS px at 2, 24 at 3). */
export const LCD_DY = 2, LCD_H = 8;
export const OPEN = { x: 13, w: 100 } as const;          // bay 0's opening: panels span it and cover the rails
export const CHAN = { x: 7, w: 5 } as const;             // vertical cable manager, left post
/** Twin: bay 1's opening starts 8 px right of bay 0's end (the divider: its cable channel). Six sleds a bay. */
export const BAY_PITCH = OPEN.w + 8, CHAN2 = { x: OPEN.x + OPEN.w + 1, w: 5 } as const, TWIN_SPLIT = 6;
/** Half: a server row holds two sleds this wide. */
export const HALF_W = OPEN.w / 2;
export const UPLINK_X = 104;                             // uplink drops into the switch's uplink cage
export const UP_X = 120;                                 // where the uplink comes down from the ceiling
/** The uplink runs along the seam between Power control and the switch. */
export const HEADER_Y = U0 + U - 1;
/** The PDU head's display and its usage bar, from the plinth's x. */
export const PDU_LCD = { dx: 3, w: 50 } as const, PDU_BAR = { dx: 55, n: 11, pitch: 4 } as const;
/** The LB's routed-per-second display, from its x. */
export const LB_LCD = { dx: 7, w: 30 } as const;
export const SAVE_AT = { x: 9, y: 9 } as const;
export const LAMP = { x: 9, y: 20, w: 7 } as const;
/** Art px the phone rest adds left of the cabinet for the pipe tags (core/pipe.ts stacks them there). */
export const PHONE_TAG_GUTTER = 48;
export const ROW_COLS = RACK_SLOTS_PER_ROW;

// ---------- the live plan ----------
export const plan: { id: RackPlan } = { id: 'tower' };
/** The bay opening's height, a sled's height and the first sled row's y. */
export let BAY_H = 15 * U, SLED_H = U, SRV_Y = U0 + SRV_U0 * U;
/** Patch cables gather on this seam: above the switch, or under it where its faceplate carries its name (half). */
export let PATCH_Y = HEADER_Y;
/** One cabinet's world: 128 × 240 as a tower (the room's 16 × 30 rack rect at 1/8). */
export const WORLD = rect(0, 0, 128, 240);
export const CAB = { x: 5, w: 118, roofY: 6, roofH: 22, frontY: 28, ground: U0 + 15 * U + 14 };
export const STRIP = { x: 115, w: 6 };                   // PDU outlet strip, right post
export const PLINTH = rect(13, U0 + 15 * U + 1, 100, 11);  // PDU head
export const READOUT = rect(88, 7, 31, 19);                // cooler display on the roof: two text lines
/** The server face's status display, from the sled's x: the core writes its crisp line there (labels.ts). */
export const SRV_LCD = { dx: 8, w: 68 };
/** A sled's core LED columns, from its x: the first column, their pitch and width, and how many at most. */
export const SRV_LEDS = { dx: 79, pitch: 3, w: 2, max: 4 };
/** The rest framing: roof to plinth (the floor tile and the sky above may fall outside). */
export const FOCUS = rect(1, CAB.roofY - 1, 126, PLINTH.y + PLINTH.h + 1 - (CAB.roofY - 1));
/** A cabinet's body in its own column, roof to floor: the neighbour tap and darkening rect. */
export const CAB_RECT = rect(CAB.x, CAB.roofY, CAB.w, CAB.ground - CAB.roofY);
export const ROOF_RECT = rect(CAB.x, CAB.roofY, CAB.w, CAB.roofH);
export const STRIP_RECT = rect(STRIP.x - 1, U0, STRIP.w + 2, BAY_H);
/** Infrastructure units (bay 0). A `_RECT` is the whole unit; a `_FACE` its 12 px band of hardware (under a half cabinet's name line). */
export const POWER_CTL_RECT = rect(OPEN.x, U0, OPEN.w, U);
export const SWITCH_RECT = rect(OPEN.x, U0 + U, OPEN.w, U), SWITCH_FACE = rect(OPEN.x, U0 + U, OPEN.w, U);
export const LB_RECT = rect(OPEN.x, U0 + 2 * U, OPEN.w, U), LB_FACE = rect(OPEN.x, U0 + 2 * U, OPEN.w, U);
/** Twin: the blank panel beside the infrastructure, heading the right bay. */
export const NAME_PANEL = rect(OPEN.x + BAY_PITCH, U0, OPEN.w, 3 * U + 2);
// The room row (D17.2). The rack world is the whole row: cabinet c stands at x = c × ROW_PITCH (a tower's
// 120 is the room's 15 px rack pitch at 1/8).
export let ROW_PITCH = 120, ROW_W = (ROW_COLS - 1) * ROW_PITCH + WORLD.w;
export const colX = (c: number): number => c * ROW_PITCH;

// Patch routes: jack → seam → cable channel → the server's NIC on the left ear.
export type Route = [number, number][];
export const UPLINK_ROUTE: Route = [[UP_X, -4], [UP_X, HEADER_Y], [UPLINK_X, HEADER_Y], [UPLINK_X, SWITCH_FACE.y + 3]];

interface PlanSize { readonly x: number; readonly w: number; readonly h: number; readonly extra: number; readonly pitch: number; readonly sled: number; readonly rows: number; readonly name: number }
/** Per plan: the rest focus (x, w), the height a view needs for it, the cabinet's extra width, the row pitch, the sled height and rows, the name line. */
const SIZE: Readonly<Record<RackPlan, PlanSize>> = {
  tower: { x: 1, w: 126, h: 229, extra: 0, pitch: 120, sled: U, rows: 12, name: 0 },
  // a twin fills its view's width: 1 px beside the cabinet
  twin: { x: 4, w: 228, h: 174, extra: BAY_PITCH, pitch: 232, sled: 16, rows: 6, name: 0 },
  // a half cabinet keeps 16 px east of it for the payout pops on its PDU strip
  half: { x: 1, w: 142, h: 162, extra: 0, pitch: 120, sled: U, rows: 6, name: 8 },
};
/** Lay the cabinet out as `id`. */
export function setPlan(id: RackPlan): void {
  if (id === plan.id) return;
  const z = SIZE[id], twin = id === 'twin', half = id === 'half';
  plan.id = id; SLED_H = z.sled;
  setRect(SWITCH_RECT, OPEN.x, U0 + U, OPEN.w, U + z.name); setRect(SWITCH_FACE, OPEN.x, SWITCH_RECT.y + z.name, OPEN.w, U);
  setRect(LB_RECT, OPEN.x, SWITCH_RECT.y + SWITCH_RECT.h, OPEN.w, U + z.name); setRect(LB_FACE, OPEN.x, LB_RECT.y + z.name, OPEN.w, U);
  // a twin's sleds start 2 px under the balancer: their display line is then on a multiple of 8 art px
  SRV_Y = LB_RECT.y + LB_RECT.h + (twin ? 2 : 0); BAY_H = SRV_Y + z.rows * SLED_H - U0;
  PATCH_Y = half ? SWITCH_RECT.y + SWITCH_RECT.h - 1 : HEADER_Y; UPLINK_ROUTE[3]![1] = SWITCH_FACE.y + 3;
  PLINTH.y = U0 + BAY_H + (twin ? 3 : 1);
  WORLD.w = 128 + z.extra; WORLD.h = PLINTH.y + 29;
  CAB.w = 118 + z.extra; CAB.ground = PLINTH.y + 13;
  STRIP.x = 115 + z.extra; READOUT.x = 88 + z.extra;
  SRV_LCD.dx = half ? 4 : 8; SRV_LCD.w = half ? 33 : 68;
  SRV_LEDS.dx = half ? 39 : 79; SRV_LEDS.max = half ? 2 : 4;
  setRect(FOCUS, z.x, CAB.roofY - 1, z.w, PLINTH.y + PLINTH.h + 1 - (CAB.roofY - 1));
  setRect(CAB_RECT, CAB.x, CAB.roofY, CAB.w, CAB.ground - CAB.roofY); ROOF_RECT.w = CAB.w;
  setRect(STRIP_RECT, STRIP.x - 1, U0, STRIP.w + 2, BAY_H);
  ROW_PITCH = z.pitch; ROW_W = (ROW_COLS - 1) * ROW_PITCH + WORLD.w;
}
/** The largest scale, at most the shell's N, at which a `w × h` art px focus rests whole in `area` (0: not even at 1). */
const fit = (z: PlanSize, area: RestArea): number => Math.max(0, Math.min(area.scale, Math.floor(area.w / z.w), Math.floor(area.h / z.h)));
/**
 * The plan for a free world: the one that rests whole at the largest scale; none at 2 or more keeps the tower (it pans).
 * At a tie the tower wins at 2, and the twin at 3, where the tower's 12 px units fall off the 8 CSS px text grid.
 */
export function planFor(area: RestArea): RackPlan {
  const tower = fit(SIZE.tower, area), twin = fit(SIZE.twin, area), half = fit(SIZE.half, area), n = Math.max(tower, twin, half);
  if (n < 2) return 'tower';
  if (n >= 3 && twin === n) return 'twin';
  return tower === n ? 'tower' : twin === n ? 'twin' : 'half';
}

/** Art px a sled's 12 px face sits under its top: a 16 px sled centres it. */
export const sledDy = (): number => (SLED_H - U) >> 1;
/** Server slot `slot`'s face. */
export function serverRect(slot: number, out: Rect = rect()): Rect {
  if (plan.id === 'twin') {
    const b = slot < TWIN_SPLIT ? 0 : 1;
    return setRect(out, OPEN.x + b * BAY_PITCH, SRV_Y + (b ? slot - TWIN_SPLIT : slot) * SLED_H, OPEN.w, SLED_H);
  }
  if (plan.id === 'half') return setRect(out, OPEN.x + (slot & 1) * HALF_W, SRV_Y + (slot >> 1) * SLED_H, HALF_W, SLED_H);
  return setRect(out, OPEN.x, SRV_Y + slot * SLED_H, OPEN.w, SLED_H);
}
/** Bays of the plan, and bay b's opening x. */
export const bays = (): number => (plan.id === 'twin' ? 2 : 1);
export const bayX = (b: number): number => OPEN.x + b * BAY_PITCH;
/** The LB's queue wells (D25.7): right of the twelve routing lights, left of the status LED and ear. */
export const LB_WELLS = { x: OPEN.x + 81, dy: 2, w: 12, h: 8 } as const;

// Switch face: up to 12 port jacks on a pitch of 6, then the uplink cage.
export const PORT_PITCH = 6, PORT_X0 = OPEN.x + 16;
export const portX = (i: number): number => PORT_X0 + i * PORT_PITCH;
export const portCx = (i: number): number => portX(i) + 2;
export const UPLINK_JACK = { x: OPEN.x + 88, w: 7 } as const;

// A server sled pulled out on its rails, seen from above. Its board area takes the system world.
export const SLED = { x: 17, w: 92, d: 85 } as const;
export const CHILD = { x: 16, w: 75, h: 96, dy: -16 } as const;
export function liftOf(y: number): number { const max = WORLD.h - SLED.d - U - 3; return Math.max(0, y - max); }
const face = rect();
/** Art px the pulled-out sled of `slot` stands right of bay 0 (a twin's right bay). */
export const sledDx = (slot: number): number => (plan.id === 'twin' && slot >= TWIN_SPLIT ? BAY_PITCH : 0);
/** The system world's rect: the board area of the fully pulled-out sled of server `slot`. */
export function childRect(slot: number, out: Rect): Rect {
  const y = serverRect(slot, face).y, top = y - liftOf(y);
  return setRect(out, CHILD.x + sledDx(slot), top + CHILD.dy, CHILD.w, CHILD.h);
}

export const strandX = (i: number): number => CHAN.x + (i % CHAN.w);
/**
 * Fill `out` (5 points, reused) with port i's route to server slot `slot`. A twin's right bay is reached
 * along the seam under the switch and down the divider's channel; a half row's right sled along its row's top seam.
 */
export function patchRoute(port: number, slot: number, out: Route): Route {
  const r = serverRect(slot, face), x0 = portCx(port), far = plan.id === 'twin' && slot >= TWIN_SPLIT, half = plan.id === 'half', right = half && (slot & 1) === 1;
  const hy = far ? SWITCH_RECT.y + U - 1 + (port & 1) : PATCH_Y + (port & 1), cx = far ? CHAN2.x + (port % CHAN2.w) : strandX(port), ny = right ? r.y : r.y + 4 + sledDy();
  out[0]![0] = x0; out[0]![1] = SWITCH_FACE.y + (half ? 8 : 4); out[1]![0] = x0; out[1]![1] = hy; out[2]![0] = cx; out[2]![1] = hy;
  out[3]![0] = cx; out[3]![1] = ny; out[4]![0] = r.x + (right ? 2 : 3); out[4]![1] = ny;
  return out;
}
export const createRoute = (): Route => [[0, 0], [0, 0], [0, 0], [0, 0], [0, 0]];
