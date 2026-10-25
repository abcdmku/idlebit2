// D25 shard flows in the active rack. A task's shards cross the rack uplink one after another
// (one travelling at its real progress, the rest waiting in a stack at the uplink's mouth),
// enter the switch, and fan out over the ports in parallel along the patch cables to their
// servers. The fork is drawn over the switch's header, from the uplink jack to each port a task's
// shards take. Colour = the task type's. No flows (before the sim sends them): nothing drawn here.
import { drawFlow, drawFork, drawWaiting, flowColor, flowsOf } from '../../core';
import type { FlowView, WorldFrame } from '../../core';
import type { RackSnapshot } from '../../../game';
import { firstOfTask, shardsOf } from './flowkit';
import { HEADER_Y, UPLINK_ROUTE, UPLINK_X, UP_X, createRoute, patchRoute, portCx } from './layout';

type G = CanvasRenderingContext2D;
/** The rack's top link: its uplinks ('rack' before the sim named them). */
export const isUplink = (f: FlowView): boolean => f.link === 'uplink' || f.link === 'rack';
/** The fork bar runs along the cabinet header, just above the switch the patch cables rise to. */
export const FORK_Y = HEADER_Y - 1;
/** The waiting stack hangs beside the uplink where it drops from the ceiling. */
export const WAIT_AT = { x: UP_X - 5, y: 1 } as const, WAIT_MAX = 6;
const route = createRoute(), xs: number[] = [];

/** Server slot of a flow's target system, or -1 when it isn't in this rack. */
export function slotOfFlow(s: RackSnapshot, f: FlowView): number {
  const id = f.to && f.to.level === 'system' ? f.to.id : f.systemId;
  for (let i = 0; i < s.servers.length; i++) if (s.servers[i].systemId === id) return i;
  return -1;
}
/** The switch port patched to server slot `slot`, or -1. */
export function portOfSlot(s: RackSnapshot, slot: number): number {
  const ports = s.switch.ports;
  for (let i = 0; i < ports.length && i < 12; i++) if (ports[i].peer === slot) return i;
  return -1;
}
/** The port a server-link flow rides, or -1. */
export function portOfFlow(s: RackSnapshot, f: FlowView): number {
  const slot = slotOfFlow(s, f);
  return slot < 0 ? -1 : portOfSlot(s, slot);
}

/**
 * Fill `out` with the fork's branch xs for the task of flows[i]: the uplink jack, then each port
 * its shards ride. Returns the count; a fork needs a split task with a shard on a port.
 */
export function forkXs(s: RackSnapshot, flows: readonly FlowView[], i: number, out: number[]): number {
  out.length = 0;
  const id = flows[i]!.taskId;
  if (shardsOf(flows[i]!) < 2) return 0;
  out.push(UPLINK_X);
  for (let j = i; j < flows.length; j++) {
    const f = flows[j]!;
    if (f.taskId !== id || f.link !== 'server') continue;
    const p = portOfFlow(s, f);
    if (p >= 0 && !out.includes(portCx(p))) out.push(portCx(p));
  }
  if (out.length < 2) out.length = 0;
  return out.length;
}

/** Draw the rack's flows: forks under the packets, then each shard at its real progress. True when any were given. */
export function drawRackFlows(g: G, s: RackSnapshot, frame: WorldFrame): boolean {
  const flows = flowsOf(s);
  if (flows.length === 0) return false;
  for (let i = 0; i < flows.length; i++) {
    if (!firstOfTask(flows, i) || forkXs(s, flows, i, xs) < 2) continue;
    drawFork(g, xs, FORK_Y, flowColor(flows[i]!));
  }
  let waiting = 0;
  for (let i = 0; i < flows.length; i++) {
    const f = flows[i]!;
    if (isUplink(f)) {
      if (drawFlow(g, f, UPLINK_ROUTE, frame.snapshot, frame.timeMs) === 'waiting' && waiting < WAIT_MAX) {
        drawWaiting(g, WAIT_AT.x, WAIT_AT.y + waiting * 3, 1, flowColor(f)); waiting++;
      }
    } else if (f.link === 'server') {
      const slot = slotOfFlow(s, f), p = slot < 0 ? -1 : portOfSlot(s, slot);
      if (p >= 0) drawFlow(g, f, patchRoute(p, slot, route), frame.snapshot, frame.timeMs);
    }
  }
  return true;
}
