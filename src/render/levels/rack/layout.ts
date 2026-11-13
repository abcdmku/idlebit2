// Rack world (mockup levels/rack/layout.js): one cabinet in 3/4 view, front face toward the player.
// Every unit is a full-width 1U face. Cooling is the roof (its thermostat is the roof display). The Switch
// takes the first U: it is the rack's load balancer too, one unit whose west end is the router (queue wells,
// routing light) and whose jacks are the ports. Twelve server slots follow, then D31's Power control in the
// last U, directly above the PDU: its head is on the plinth and its outlet strip runs up the right post.
//
// The cabinet is planned for the free world it rests in (`planFor`, called by the level's `focus()`):
//   tower: one bay of 12 px units, 126 × 206 art px. The tall view (a portrait phone at 2).
//   twin:  two bays side by side, 228 × 166. The wide, short view (a desktop at N = 3, a landscape phone). The
//          Switch heads the left bay and Power control closes it; a blank panel beside each carries its name
//          (labels.ts), and six sleds stand between them in each bay on a 16 px pitch: every display line is then
//          on the core's 8 CSS px text grid at 3 as well as at 2.
// The first plan that rests whole at the largest scale wins; a view too short for either keeps the tower and pans
// by whole units. Everything below that is not `const` is the live plan: read it at draw time, never at import.
import { RACK_SLOTS_PER_ROW } from '../../../game';
import { rect, setRect } from '../../core';
import type { Rect, RestArea } from '../../core';

export type RackPlan = 'tower' | 'twin';
/** The tower's unit pitch and first unit, and the units above the first sled (the room's rack mini reads the tower). U0 + 2 is a multiple of 4. */
export const U = 12, U0 = 30, SERVER_SLOTS = 12, SRV_U0 = 1;
/** The tower's units: the Switch, twelve sleds, Power control. */
export const TOWER_U = SRV_U0 + SERVER_SLOTS + 1;
/** A unit's display window starts 2 px under its face's top and is one 8 art px text line tall (16 CSS px at 2, 24 at 3). */
export const LCD_DY = 2, LCD_H = 8;
export const OPEN = { x: 13, w: 100 } as const;          // bay 0's opening: panels span it and cover the rails
export const CHAN = { x: 7, w: 5 } as const;             // vertical cable manager, left post
/** Twin: bay 1's opening starts 8 px right of bay 0's end (the divider: its cable channel). Six sleds a bay. */
export const BAY_PITCH = OPEN.w + 8, CHAN2 = { x: OPEN.x + OPEN.w + 1, w: 5 } as const, TWIN_SPLIT = 6;
export const UPLINK_X = OPEN.x + 90;                     // uplink drops into the switch's uplink cage
export const UP_X = 120;                                 // where the uplink comes down from the ceiling
/** The uplink and the patch cables run along the cabinet's header, the seam above the Switch. */
export const HEADER_Y = U0 - 1, PATCH_Y = HEADER_Y;
/** The PDU head's display and its usage bar, from the plinth's x. */
export const PDU_LCD = { dx: 3, w: 50 } as const, PDU_BAR = { dx: 55, n: 11, pitch: 4 } as const;
export const SAVE_AT = { x: 9, y: 9 } as const;
export const LAMP = { x: 9, y: 20, w: 7 } as const;
/** Art px the phone rest adds left of the cabinet for the pipe tags (core/pipe.ts stacks them there). */
export const PHONE_TAG_GUTTER = 48;
export const ROW_COLS = RACK_SLOTS_PER_ROW;

// ---------- the live plan ----------
export const plan: { id: RackPlan } = { id: 'tower' };
/** The bay opening's height, a sled's height and the first sled row's y. */
export let BAY_H = TOWER_U * U, SLED_H = U, SRV_Y = U0 + SRV_U0 * U;
/** One cabinet's world: 128 × 228 as a tower. */
export const WORLD = rect(0, 0, 128, U0 + TOWER_U * U + 30);
export const CAB = { x: 5, w: 118, roofY: 6, roofH: 22, frontY: 28, ground: U0 + TOWER_U * U + 14 };
export const STRIP = { x: 115, w: 6 };                   // PDU outlet strip, right post
export const PLINTH = rect(13, U0 + TOWER_U * U + 1, 100, 11);  // PDU head
/** The thermostat on the roof: the rack's °F over what the cooler holds it at (labels.ts). It is the cooler's own tap target. */
export const READOUT = rect(82, 7, 37, 19);
/** A twin's Cooling name plate on its roof, over the right bay (infra.ts draws its window, labels.ts fills it). */
export const ROOF_TAG = { y: 14, w: 76 } as const;
/** The server face's status display, from the sled's x: the core writes its crisp line there (labels.ts). */
export const SRV_LCD = { dx: 8, w: 68 } as const;
/** A sled's core LED columns, from its x: the first column, their pitch and width, and how many at most. */
export const SRV_LEDS = { dx: 79, pitch: 3, w: 2, max: 4 } as const;
/** The rest framing: roof to plinth (the floor tile and the sky above may fall outside). */
export const FOCUS = rect(1, CAB.roofY - 1, 126, PLINTH.y + PLINTH.h + 1 - (CAB.roofY - 1));
/** A cabinet's body in its own column, roof to floor: the neighbour tap and darkening rect. */
export const CAB_RECT = rect(CAB.x, CAB.roofY, CAB.w, CAB.ground - CAB.roofY);
export const ROOF_RECT = rect(CAB.x, CAB.roofY, CAB.w, CAB.roofH);
export const STRIP_RECT = rect(STRIP.x - 1, U0, STRIP.w + 2, BAY_H);
/** The Switch (bay 0's first U), and its west end: the load balancer's face and tap target. */
export const SWITCH_RECT = rect(OPEN.x, U0, OPEN.w, U), LB_RECT = rect(OPEN.x, U0, 25, U);
/** Power control (bay 0's last U, directly above the PDU head). */
export const POWER_CTL_RECT = rect(OPEN.x, U0 + (TOWER_U - 1) * U, OPEN.w, U);
/** Twin: the blank panels heading and closing the right bay, beside the Switch and Power control. */
export const NAME_PANEL = rect(OPEN.x + BAY_PITCH, U0, OPEN.w, U + 2), POWER_PANEL = rect(OPEN.x + BAY_PITCH, U0, OPEN.w, U + 2);
// The room row (D17.2). The rack world is the whole row: cabinet c stands at x = c × ROW_PITCH (a tower's
// 120 is the room's 15 px rack pitch at 1/8).
export let ROW_PITCH = 120, ROW_W = (ROW_COLS - 1) * ROW_PITCH + WORLD.w;
export const colX = (c: number): number => c * ROW_PITCH;

// Patch routes: jack → seam → cable channel → the server's NIC on the left ear.
export type Route = [number, number][];
export const UPLINK_ROUTE: Route = [[UP_X, -4], [UP_X, HEADER_Y], [UPLINK_X, HEADER_Y], [UPLINK_X, SWITCH_RECT.y + 3]];

interface PlanSize { readonly x: number; readonly w: number; readonly h: number; readonly extra: number; readonly pitch: number; readonly sled: number; readonly rows: number }
/** Per plan: the rest focus (x, w), the height a view needs for it, the cabinet's extra width, the row pitch, the sled height and rows. */
const SIZE: Readonly<Record<RackPlan, PlanSize>> = {
  tower: { x: 1, w: 126, h: 206, extra: 0, pitch: 120, sled: U, rows: 12 },
  // a twin fills its view's width: 1 px beside the cabinet
  twin: { x: 4, w: 228, h: 166, extra: BAY_PITCH, pitch: 232, sled: 16, rows: 6 },
};
/** Lay the cabinet out as `id`. */
export function setPlan(id: RackPlan): void {
  if (id === plan.id) return;
  // a twin's sleds start 2 px under the Switch and Power control 2 px under them: every display line is then on a multiple of 8 art px
  const z = SIZE[id], twin = id === 'twin', gap = twin ? 2 : 0;
  plan.id = id; SLED_H = z.sled;
  SRV_Y = U0 + SRV_U0 * U + gap;
  const powerY = SRV_Y + z.rows * SLED_H + gap;
  setRect(POWER_CTL_RECT, OPEN.x, powerY, OPEN.w, U); setRect(POWER_PANEL, OPEN.x + BAY_PITCH, powerY - gap, OPEN.w, U + gap);
  BAY_H = powerY + U - U0;
  PLINTH.y = U0 + BAY_H + (twin ? 5 : 1);
  WORLD.w = 128 + z.extra; WORLD.h = PLINTH.y + 29;
  CAB.w = 118 + z.extra; CAB.ground = PLINTH.y + 13;
  STRIP.x = 115 + z.extra; READOUT.x = 82 + z.extra;
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
  const tower = fit(SIZE.tower, area), twin = fit(SIZE.twin, area), n = Math.max(tower, twin);
  if (n < 2) return 'tower';
  if (n >= 3 && twin === n) return 'twin';
  return tower === n ? 'tower' : 'twin';
}

/** Art px a sled's 12 px face sits under its top: a 16 px sled centres it. */
export const sledDy = (): number => (SLED_H - U) >> 1;
/** Server slot `slot`'s face. */
export function serverRect(slot: number, out: Rect = rect()): Rect {
  if (plan.id === 'twin') {
    const b = slot < TWIN_SPLIT ? 0 : 1;
    return setRect(out, OPEN.x + b * BAY_PITCH, SRV_Y + (b ? slot - TWIN_SPLIT : slot) * SLED_H, OPEN.w, SLED_H);
  }
  return setRect(out, OPEN.x, SRV_Y + slot * SLED_H, OPEN.w, SLED_H);
}
/** Bays of the plan, and bay b's opening x. */
export const bays = (): number => (plan.id === 'twin' ? 2 : 1);
export const bayX = (b: number): number => OPEN.x + b * BAY_PITCH;
/** The balancer's end of the Switch face, from its x: the queue wells (D25.7) and the routing light east of them. */
export const LB_WELLS = { x: OPEN.x + 7, dy: 2, w: 12, h: 8 } as const, LB_LIGHT = { x: OPEN.x + 21, dy: 4 } as const;

// The Switch's ports: up to 12 jacks on a pitch of 5, then the uplink cage.
export const PORT_PITCH = 5, PORT_X0 = OPEN.x + 26;
export const portX = (i: number): number => PORT_X0 + i * PORT_PITCH;
export const portCx = (i: number): number => portX(i) + 2;
export const UPLINK_JACK = { x: OPEN.x + 87, w: 7 } as const;

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
 * along the seam under the switch and down the divider's channel.
 */
export function patchRoute(port: number, slot: number, out: Route): Route {
  const r = serverRect(slot, face), x0 = portCx(port), far = plan.id === 'twin' && slot >= TWIN_SPLIT;
  const hy = far ? SWITCH_RECT.y + U - 1 + (port & 1) : PATCH_Y + (port & 1), cx = far ? CHAN2.x + (port % CHAN2.w) : strandX(port), ny = r.y + 4 + sledDy();
  out[0]![0] = x0; out[0]![1] = SWITCH_RECT.y + 4; out[1]![0] = x0; out[1]![1] = hy; out[2]![0] = cx; out[2]![1] = hy;
  out[3]![0] = cx; out[3]![1] = ny; out[4]![0] = r.x + 3; out[4]![1] = ny;
  return out;
}
export const createRoute = (): Route => [[0, 0], [0, 0], [0, 0], [0, 0], [0, 0]];
