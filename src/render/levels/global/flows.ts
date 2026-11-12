// D25 shard flows on the World map. A task's shards leave the scheduler hub on the backbone, one
// link per site (a site's shards cross its link one after another; the rest wait in a stack beside
// the hub), come ashore at the site's landing station and cross the site's data plane to their zone
// tiles in parallel. Forks: on the header lane, one branch per column the task leaves the hub for,
// and along each site's data plane where its zone drops part. Colour = task type.
import { drawFlow, drawFork, drawWaiting, flowColor, flowPhase, flowsOf } from '../../core';
import type { FlowView, Rect, WorldFrame } from '../../core';
import type { GlobalSnapshot } from '../../../game';
import { firstOfTask, shardsOf } from '../rack/flowkit';
import { plan, tilesOf } from './layout';
import type { Path, Plan } from './layout';
import { gatewayIndex } from './world';

type G = CanvasRenderingContext2D;
const at = { site: -1, zone: -1 }, xs: number[] = [];
export const WAIT_MAX = 6;

/** The site (region index) and zone a flow enters, from its `to` room; site -1 when it isn't on the map. */
export function zoneOfFlow(s: GlobalSnapshot, f: FlowView): typeof at {
  at.site = -1; at.zone = -1;
  if (!f.to || f.to.level !== 'room') return at;
  for (let i = 0; i < s.sites.length; i++) {
    const zs = s.sites[i].zones;
    for (let z = 0; z < zs.length && z < 3; z++) if (zs[z].roomId === f.to.id) { at.site = i; at.zone = z; return at; }
  }
  return at;
}
const zonePaths = new Map<string, Path>();
/**
 * Zone link path in site i: along its data plane from the landing station, then up into zone tile z.
 * The gateway site's data plane is fed from the hub, so its path starts there.
 */
export function zonePath(p: Plan, i: number, z: number, gateway: boolean, tiles: readonly Rect[] = p.tiles[i]!): Path {
  const key = `${p.key}:${i}:${z}:${gateway ? 1 : 0}:${tiles === p.tiles[i] ? 0 : 1}`;
  let path = zonePaths.get(key);
  if (!path) {
    const t = tiles[z]!, y = p.planeY[i]!, b = p.cells[i]!;
    path = [...(gateway ? p.routes[i]! : [[b.x, y] as const]), [t.x + 2, y], [t.x + 2, t.y + t.h]];
    zonePaths.set(key, path);
  }
  return path;
}

/**
 * The hub fork for the task of flows[i]: one branch per column its shards leave the hub for (backbone
 * links, and the gateway site's own data plane), at the trunks on the header lane. Returns the count (0 below 2).
 */
export function hubFork(s: GlobalSnapshot, flows: readonly FlowView[], i: number, out: number[]): number {
  out.length = 0;
  const id = flows[i]!.taskId, gw = gatewayIndex(s), p = plan();
  for (let j = i; j < flows.length; j++) {
    const f = flows[j]!;
    if (f.taskId !== id || (f.link !== 'backbone' && f.link !== 'zone') || zoneOfFlow(s, f).site < 0) continue;
    if (f.link !== 'backbone' && at.site !== gw) continue;
    const x = p.trunkX[p.col[at.site]!]!;
    if (!out.includes(x)) out.push(x);
  }
  if (out.length < 2) out.length = 0;
  return out.length;
}
/** The data-plane fork xs for the task of flows[i] in site `site`: each zone drop its shards take. */
function zoneFork(s: GlobalSnapshot, flows: readonly FlowView[], i: number, site: number, out: number[]): number {
  out.length = 0;
  const id = flows[i]!.taskId, p = plan();
  for (let j = i; j < flows.length; j++) {
    const f = flows[j]!;
    if (f.taskId !== id || f.link !== 'zone' || zoneOfFlow(s, f).site !== site) continue;
    const x = tilesOf(p, site, s.sites[site]!)[at.zone]!.x + 2;
    if (!out.includes(x)) out.push(x);
  }
  if (out.length < 2) out.length = 0;
  return out.length;
}

/** The forks of split tasks, drawn before the hub so its link lights stay on top. */
export function drawGlobalForks(g: G, s: GlobalSnapshot): void {
  const flows = flowsOf(s), p = plan();
  for (let i = 0; i < flows.length; i++) {
    if (!firstOfTask(flows, i) || shardsOf(flows[i]!) < 2) continue;
    const c = flowColor(flows[i]!);
    if (hubFork(s, flows, i, xs) >= 2) drawFork(g, xs, p.laneY, c);
    for (let r = 0; r < s.sites.length && r < p.cells.length; r++) if (zoneFork(s, flows, i, r, xs) >= 2) drawFork(g, xs, p.planeY[r]!, c);
  }
}
/** Each shard at its real progress, and the waiting stacks. True when any flows were given. */
export function drawGlobalFlows(g: G, s: GlobalSnapshot, frame: WorldFrame): boolean {
  const flows = flowsOf(s);
  if (flows.length === 0) return false;
  const p = plan(), hub = p.hub, gw = gatewayIndex(s);
  let atHub = 0;
  for (let i = 0; i < flows.length; i++) {
    const f = flows[i]!;
    if (f.link !== 'backbone' && f.link !== 'zone') continue;
    const z = zoneOfFlow(s, f);
    if (z.site < 0) continue;
    const site = z.site, zone = z.zone;
    const path = f.link === 'backbone' ? p.routes[site]! : zonePath(p, site, zone, site === gw, tilesOf(p, site, s.sites[site]!));
    if (drawFlow(g, f, path, frame.snapshot, frame.timeMs) !== 'waiting') continue;
    if (f.link === 'backbone') { if (atHub < WAIT_MAX) drawWaiting(g, hub.x - 4, hub.y + 1 + 3 * atHub++, 1, flowColor(f)); continue; }
    // a site's waiting zone shards stack up from its landing station, in flow order
    let k = 0;
    for (let j = 0; j < i; j++) {
      const o = flows[j]!;
      if (o.link === 'zone' && flowPhase(o) === 'waiting' && zoneOfFlow(s, o).site === site) k++;
    }
    const b = p.cells[site]!;
    if (k < WAIT_MAX) drawWaiting(g, b.x - 4, p.planeY[site]! - 5 - 3 * k, 1, flowColor(f));
  }
  return true;
}
