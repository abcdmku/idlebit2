// D25 shard flows on the World map. A task's shards leave the scheduler hub on the backbone, one
// link per site (a site's shards cross its link one after another; the rest wait in a stack beside
// the hub), come ashore at the site's landing station and cross the site's data plane to their zone
// tiles in parallel. Forks: under the hub, one branch per site the task leaves it for, and along
// each site's data plane where its zone drops part. Colour = task type.
import { drawFlow, drawFork, drawWaiting, flowColor, flowPhase, flowsOf } from '../../core';
import type { FlowView, Rect, WorldFrame } from '../../core';
import type { GlobalSnapshot } from '../../../game';
import { firstOfTask, shardsOf } from '../rack/flowkit';
import { CELLS, TILES, hubRect, landing } from './layout';
import { gatewayIndex, linkRoute } from './world';

type G = CanvasRenderingContext2D;
type Pt = [number, number];
const hub: Rect = { x: 0, y: 0, w: 0, h: 0 }, at = { site: -1, zone: -1 }, route: number[] = [0, 0, 0, 0, 0, 0], xs: number[] = [];
const BACKBONE: Pt[] = [[0, 0], [0, 0], [0, 0]], ZONE: Pt[] = [[0, 0], [0, 0], [0, 0], [0, 0]];
export const WAIT_MAX = 6;
const LANDINGS = CELLS.map((_, i) => landing(i));

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
/** Data plane row of site i: under its zone tiles. */
export const dataPlaneY = (i: number): number => TILES[i][0].y + TILES[i][0].h + 1;
/** Where site i's data plane is fed: the hub for the gateway site, else its landing station. */
export function siteEntry(s: GlobalSnapshot, i: number, out: Pt): Pt {
  if (i === gatewayIndex(s)) { hubRect(i, hub); out[0] = hub.x + (hub.w >> 1); out[1] = hub.y + hub.h; return out; }
  const a = LANDINGS[i]; out[0] = a.x; out[1] = a.y; return out;
}
/** Backbone path for site i: hub → along the hub row → ashore (world.ts linkRoute). */
export function backbonePath(s: GlobalSnapshot, i: number): readonly Pt[] {
  linkRoute(s, i, route);
  for (let k = 0; k < 3; k++) { BACKBONE[k][0] = route[k * 2]; BACKBONE[k][1] = route[k * 2 + 1]; }
  return BACKBONE;
}
/** Zone link path in site i: from its entry down to the data plane, along it, up into zone tile z. */
export function zonePath(s: GlobalSnapshot, i: number, z: number): readonly Pt[] {
  const e = siteEntry(s, i, ZONE[0]), y = dataPlaneY(i), t = TILES[i][z];
  ZONE[1][0] = e[0]; ZONE[1][1] = y; ZONE[2][0] = t.x + 2; ZONE[2][1] = y; ZONE[3][0] = t.x + 2; ZONE[3][1] = t.y + t.h;
  return ZONE;
}

/**
 * The hub fork for the task of flows[i]: one branch per site its shards leave the hub for (backbone
 * links, and the gateway site's own data plane), spread under the hub. Returns the count (0 below 2).
 */
export function hubFork(s: GlobalSnapshot, flows: readonly FlowView[], i: number, out: number[]): number {
  out.length = 0;
  const id = flows[i]!.taskId, gw = gatewayIndex(s);
  let sites = 0;
  for (let j = i; j < flows.length; j++) {
    const f = flows[j]!;
    if (f.taskId !== id || (f.link !== 'backbone' && f.link !== 'zone') || zoneOfFlow(s, f).site < 0) continue;
    if (f.link === 'backbone' || at.site === gw) sites |= 1 << at.site;
  }
  let k = 0;
  for (let b = sites; b; b &= b - 1) k++;
  if (k < 2) return 0;
  hubRect(gw, hub);
  const pitch = k <= 4 ? 3 : 2, x0 = hub.x + (hub.w >> 1) - ((pitch * (k - 1)) >> 1);
  for (let n = 0; n < k; n++) out.push(x0 + n * pitch);
  return k;
}
/** The data-plane fork xs for the task of flows[i] in site `site`: each zone drop its shards take. */
function zoneFork(s: GlobalSnapshot, flows: readonly FlowView[], i: number, site: number, out: number[]): number {
  out.length = 0;
  const id = flows[i]!.taskId;
  for (let j = i; j < flows.length; j++) {
    const f = flows[j]!;
    if (f.taskId !== id || f.link !== 'zone' || zoneOfFlow(s, f).site !== site) continue;
    const x = TILES[site][at.zone].x + 2;
    if (!out.includes(x)) out.push(x);
  }
  if (out.length < 2) out.length = 0;
  return out.length;
}

/** The forks of split tasks, drawn before the hub so its link lights stay on top. */
export function drawGlobalForks(g: G, s: GlobalSnapshot): void {
  const flows = flowsOf(s);
  for (let i = 0; i < flows.length; i++) {
    if (!firstOfTask(flows, i) || shardsOf(flows[i]!) < 2) continue;
    const c = flowColor(flows[i]!);
    if (hubFork(s, flows, i, xs) >= 2) { hubRect(gatewayIndex(s), hub); drawFork(g, xs, hub.y + hub.h + 2, c); }
    for (let r = 0; r < s.sites.length && r < CELLS.length; r++) if (zoneFork(s, flows, i, r, xs) >= 2) drawFork(g, xs, dataPlaneY(r), c);
  }
}
/** Each shard at its real progress, and the waiting stacks. True when any flows were given. */
export function drawGlobalFlows(g: G, s: GlobalSnapshot, frame: WorldFrame): boolean {
  const flows = flowsOf(s);
  if (flows.length === 0) return false;
  hubRect(gatewayIndex(s), hub);
  let atHub = 0;
  for (let i = 0; i < flows.length; i++) {
    const f = flows[i]!;
    if (f.link !== 'backbone' && f.link !== 'zone') continue;
    const z = zoneOfFlow(s, f);
    if (z.site < 0) continue;
    const site = z.site, zone = z.zone;
    const path = f.link === 'backbone' ? backbonePath(s, site) : zonePath(s, site, zone);
    if (drawFlow(g, f, path, frame.snapshot, frame.timeMs) !== 'waiting') continue;
    if (f.link === 'backbone') { if (atHub < WAIT_MAX) drawWaiting(g, hub.x - 4, hub.y + 1 + 3 * atHub++, 1, flowColor(f)); continue; }
    // a site's waiting zone shards stack down from its entry, in flow order
    let k = 0;
    for (let j = 0; j < i; j++) {
      const o = flows[j]!;
      if (o.link === 'zone' && flowPhase(o) === 'waiting' && zoneOfFlow(s, o).site === site) k++;
    }
    const e = siteEntry(s, site, ZONE[0]);
    if (k < WAIT_MAX) drawWaiting(g, e[0], e[1] + 3 + 3 * k, 1, flowColor(f));
  }
  return true;
}
