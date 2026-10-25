// D25 shard flows in a room. A task's shards come down the zone link (the gateway fibre from the
// top) one after another, the rest waiting in a stack at the fibre's mouth; then each crosses its
// rack's uplink in parallel: down the trunk and along its row's tray to the rack. The paths part
// in the trays, so the fork is drawn along each row's tray, from the trunk to each rack the task's
// shards take. Colour = the task type's. One packet per flow given; nothing synthetic.
import { drawFlow, drawFork, drawWaiting, flowColor, flowsOf } from '../../core';
import type { FlowView, PixelPath, WorldFrame } from '../../core';
import type { RoomSnapshot } from '../../../game';
import { firstOfTask, shardsOf } from '../rack/flowkit';
import { COLS, GATEWAY, IY, RACK_RECTS, hallOf, trayY } from './layout';

type G = CanvasRenderingContext2D;
const H0 = hallOf(1), TX = H0.trunk + 1, GW_FOOT = GATEWAY.y + GATEWAY.h;
/** The zone link: the gateway fibre from the top of the world into the gateway. */
export const ZONE_PATH: PixelPath = [[H0.gwx, 0], [H0.gwx, GATEWAY.y + (GATEWAY.h >> 1)]];
/** Rack slot s's uplink: from the gateway down to the trunk, down the trunk, along the row tray, into the rack. */
export const UPLINK_PATHS: readonly PixelPath[] = RACK_RECTS.map((r, s) => {
  const ty = trayY(Math.floor(s / COLS)), cx = r.x + 8;
  return [[H0.gwx, GW_FOOT], [H0.gwx, IY - 14], [TX, IY - 14], [TX, ty], [cx, ty], [cx, ty + 4]] as const;
});
/** Waiting shards stack beside the fibre where it meets the gateway, between it and the thermostat (inside the rest focus). */
export const WAIT_AT = { x: GATEWAY.x + GATEWAY.w + 4, y: GATEWAY.y - 9 } as const, WAIT_MAX = 6;
/** A rack uplink flow ('rack'; 'uplink' is accepted for a rack's own links). */
export const isRackLink = (f: FlowView): boolean => f.link === 'rack' || f.link === 'uplink';
const xs: number[] = [];

/** Room slot of the rack a flow enters, or -1. */
export function slotOfFlow(s: RoomSnapshot, f: FlowView): number {
  if (!f.to || f.to.level !== 'rack') return -1;
  const n = Math.min(s.racks.length, s.rows * COLS);
  for (let i = 0; i < n; i++) if (s.racks[i].rackId === f.to.id) return i;
  return -1;
}
/**
 * Fill `out` with the fork's xs for the task of flows[i] in row `row`: the trunk, then each rack
 * of that row its shards ride to. Returns the count (0 unless a split task has a shard there).
 */
export function forkXs(s: RoomSnapshot, flows: readonly FlowView[], i: number, row: number, out: number[]): number {
  out.length = 0;
  if (shardsOf(flows[i]!) < 2) return 0;
  const id = flows[i]!.taskId;
  out.push(TX);
  for (let j = i; j < flows.length; j++) {
    const f = flows[j]!;
    if (f.taskId !== id || !isRackLink(f)) continue;
    const slot = slotOfFlow(s, f);
    if (slot < 0 || Math.floor(slot / COLS) !== row) continue;
    const x = RACK_RECTS[slot].x + 8;
    if (!out.includes(x)) out.push(x);
  }
  if (out.length < 2) out.length = 0;
  return out.length;
}

/** Draw the room's flows: forks under the packets, then each shard. True when any were given. */
export function drawRoomFlows(g: G, s: RoomSnapshot, frame: WorldFrame): boolean {
  const flows = flowsOf(s);
  if (flows.length === 0) return false;
  for (let i = 0; i < flows.length; i++) {
    if (!firstOfTask(flows, i)) continue;
    for (let r = 0; r < s.rows; r++) if (forkXs(s, flows, i, r, xs) >= 2) drawFork(g, xs, trayY(r), flowColor(flows[i]!));
  }
  let waiting = 0;
  for (let i = 0; i < flows.length; i++) {
    const f = flows[i]!;
    if (f.link === 'zone') {
      if (drawFlow(g, f, ZONE_PATH, frame.snapshot, frame.timeMs) === 'waiting' && waiting < WAIT_MAX) {
        drawWaiting(g, WAIT_AT.x, WAIT_AT.y + waiting * 3, 1, flowColor(f)); waiting++;
      }
    } else if (isRackLink(f)) {
      const slot = slotOfFlow(s, f);
      if (slot >= 0) drawFlow(g, f, UPLINK_PATHS[slot], frame.snapshot, frame.timeMs);
    }
  }
  return true;
}
