// Rack world (mockup levels/rack/layout.js): one 14U cabinet in 3/4 view, front face toward
// the player. Cooling is the roof, the Switch and Load balancer take the top two U, Power is
// the PDU strip on the right post with its head on the plinth. Twelve server slots fill the rest.
import { RACK_SLOTS_PER_ROW } from '../../../game';
import { rect, setRect } from '../../core';
import type { Rect } from '../../core';

export const WORLD = rect(0, 0, 128, 232);
export const U = 12, NU = 14, U0 = 31, SERVER_SLOTS = 12, SRV_U0 = 2;
export const CAB = { x: 5, w: 118, roofY: 6, roofH: 22, frontY: 28, ground: U0 + NU * U + 14 } as const;
export const OPEN = { x: 13, w: 100 } as const;          // panels span the opening and cover the rails
export const CHAN = { x: 7, w: 5 } as const;             // vertical cable manager, left post
export const STRIP = { x: 115, w: 6 } as const;          // PDU outlet strip, right post
export const UPLINK_X = 104;                             // uplink drops into the switch's uplink cage
export const UP_X = 120;                                 // where the uplink comes down from the ceiling
export const HEADER_Y = 29;                              // patch cables run along the cabinet header
export const PLINTH = rect(13, U0 + NU * U + 1, 100, 11);  // PDU head
export const READOUT = rect(90, 9, 29, 15);                // cooler display on the roof
export const SAVE_AT = { x: 9, y: 9 } as const;
export const LAMP = { x: 9, y: 20, w: 7 } as const;
export const FOCUS = rect(1, 0, 126, CAB.ground + 8);

// The room row (D17.2). The rack world is the whole row: cabinet c stands at x = 120c, the
// room's 15 px rack pitch at 1/8 (a room rack rect is this 128 × 232 world at 1/8).
export const ROW_COLS = RACK_SLOTS_PER_ROW, ROW_PITCH = 120;
export const ROW_W = (ROW_COLS - 1) * ROW_PITCH + WORLD.w;
export const colX = (c: number): number => c * ROW_PITCH;
/** A cabinet's body in its own column, roof to floor: the neighbour tap and darkening rect. */
export const CAB_RECT = rect(CAB.x, CAB.roofY, CAB.w, CAB.ground - CAB.roofY);

export const slotY = (u: number): number => U0 + u * U;
export const serverRow = (slot: number): number => SRV_U0 + slot;
export function unitRect(u: number, out: Rect = rect()): Rect { return setRect(out, OPEN.x, slotY(u), OPEN.w, U); }
export function serverRect(slot: number, out: Rect = rect()): Rect { return unitRect(serverRow(slot), out); }
export const SWITCH_RECT = unitRect(0);
export const LB_RECT = unitRect(1);
/** The LB's queue wells (D25.7): right of the twelve routing lights, left of the status LED and ear. */
export const LB_WELLS = { x: OPEN.x + 81, dy: 2, w: 12, h: 8 } as const;
export const ROOF_RECT = rect(CAB.x, CAB.roofY, CAB.w, CAB.roofH);
export const STRIP_RECT = rect(STRIP.x - 1, U0, STRIP.w + 2, NU * U);
/** Server rows are 12 art px: the hit rect spans the whole cabinet width (generous rows). */
export function rowHit(u: number, out: Rect): Rect { return setRect(out, CAB.x, slotY(u), STRIP.x - CAB.x, U); }

// Switch face: up to 12 port jacks on a pitch of 6, then the uplink cage.
export const PORT_PITCH = 6, PORT_X0 = OPEN.x + 16;
export const portX = (i: number): number => PORT_X0 + i * PORT_PITCH;
export const portCx = (i: number): number => portX(i) + 2;
export const UPLINK_JACK = { x: OPEN.x + 88, w: 7 } as const;

// A server sled pulled out on its rails, seen from above. Its board area takes the system world.
export const SLED = { x: 17, w: 92, d: 85 } as const;
export const CHILD = { x: 16, w: 75, h: 96, dy: -16 } as const;
export function liftOf(y: number): number { const max = WORLD.h - SLED.d - U - 3; return Math.max(0, y - max); }
/** The system world's rect: the board area of the fully pulled-out sled of the server at row y. */
export function childRect(slot: number, out: Rect): Rect {
  const y = slotY(serverRow(slot)), top = y - liftOf(y);
  return setRect(out, CHILD.x, top + CHILD.dy, CHILD.w, CHILD.h);
}

// Patch routes: jack → header → cable channel → the server's NIC on the left ear.
export type Route = [number, number][];
export const strandX = (i: number): number => CHAN.x + (i % CHAN.w);
/** Fill `out` (5 points, reused) with port i's route to server slot `slot`. */
export function patchRoute(port: number, slot: number, out: Route): Route {
  const x0 = portCx(port), hy = HEADER_Y + (port & 1), cx = strandX(port), ny = slotY(serverRow(slot)) + 4;
  out[0][0] = x0; out[0][1] = U0 + 4; out[1][0] = x0; out[1][1] = hy; out[2][0] = cx; out[2][1] = hy;
  out[3][0] = cx; out[3][1] = ny; out[4][0] = OPEN.x + 3; out[4][1] = ny;
  return out;
}
export const createRoute = (): Route => [[0, 0], [0, 0], [0, 0], [0, 0], [0, 0]];
export const UPLINK_ROUTE: Route = [[UP_X, -4], [UP_X, HEADER_Y], [UPLINK_X, HEADER_Y], [UPLINK_X, U0 + 3]];
