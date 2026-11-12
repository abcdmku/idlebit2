// D25 shard flows in a room. A task's shards come down the zone link (the gateway fibre from the
// top) one after another, the rest waiting in a stack at the fibre's mouth; then each crosses its
// rack's uplink in parallel: down the trunk and along its row's tray to the rack. The paths part
// in the trays, so the fork is drawn along each row's tray, from the trunk to each rack the task's
// shards take. Colour = the task type's. One packet per flow given; nothing synthetic.
import { drawFlow, drawFork, drawWaiting, flowColor, flowsOf } from '../../core';
import type { FlowView, PixelPath, WorldFrame } from '../../core';
import type { RoomSnapshot } from '../../../game';
import { firstOfTask, shardsOf } from '../rack/flowkit';
import { COLS, G, trayY } from './layout';
import type { Geom } from './layout';

type G = CanvasRenderingContext2D;
/** A hall's flow paths, built once per hall geometry. */
interface Paths { readonly zone: PixelPath; readonly uplinks: readonly PixelPath[] }
const built = new Map<Geom, Paths>();
function pathsOf(g: Geom): Paths {
  let p = built.get(g);
  if (!p) {
    const foot = g.gateway.y + g.gateway.h;
    p = {
      // the zone link: the gateway fibre from the top of the world into the gateway
      zone: [[g.gwx, 0], [g.gwx, g.gateway.y + (g.gateway.h >> 1)]],
      // rack slot s's uplink: the job path from the gateway's foot (down the trunk, along the row tray, into the rack)
      uplinks: g.jobPaths.map(j => [[g.gwx, foot], j[1]!, j[2]!, j[3]!, j[4]!, j[5]!] as const),
    };
    built.set(g, p);
  }
  return p;
}
/** The zone link and rack slot `slot`'s uplink in the live hall. */
export const zonePath = (): PixelPath => pathsOf(G).zone;
export const uplinkPath = (slot: number): PixelPath => pathsOf(G).uplinks[slot]!;
/** At most this many waiting shards stack beside the fibre where it meets the gateway (`G.wait`). */
export const WAIT_MAX = 6;
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
  out.push(G.trunk + 1);
  for (let j = i; j < flows.length; j++) {
    const f = flows[j]!;
    if (f.taskId !== id || !isRackLink(f)) continue;
    const slot = slotOfFlow(s, f);
    if (slot < 0 || Math.floor(slot / COLS) !== row) continue;
    const x = G.racks[slot]!.x + 8;
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
      if (drawFlow(g, f, zonePath(), frame.snapshot, frame.timeMs) === 'waiting' && waiting < WAIT_MAX) {
        drawWaiting(g, G.wait.x, G.wait.y + waiting * 3, 1, flowColor(f)); waiting++;
      }
    } else if (isRackLink(f)) {
      const slot = slotOfFlow(s, f);
      if (slot >= 0) drawFlow(g, f, uplinkPath(slot), frame.snapshot, frame.timeMs);
    }
  }
  return true;
}
