// Zoom choreography for level art (mockup levels read `vc.zoom` the same way). During a zoom the
// core hands every level `frame.zoom`; a level finds itself on the path with `zoomLink` and plays
// its own part of the move while the camera flies:
//   Room ↔ Rack:    the hall dims as the camera pushes in   (hallDim, datacenter/world.js transInfo)
//   Rack ↔ System:  the server's sled slides out and back   (sledOut, rack/world.js drillOf)
//   System ↔ CPU:   the camera dives into the socket        (camera only: chip miniRect = package)
//   World ↔ Room:   the site sinks, the hall comes up       (siteSink, global.js diveOf)
import { clamp01, smooth } from './camera';
import type { ZoomState } from './transition';
import type { LevelId, LevelSnapshot } from './types';
import { idOf } from './types';

const KEYS: Record<LevelId, string[]> = { chip: [], system: [], rack: [], room: [], global: [] };
/** The zoom path key of a level snapshot (`level:id`), cached so per-frame lookups never allocate. */
export function keyOf(s: LevelSnapshot): string {
  const id = idOf(s), row = KEYS[s.level], index = s.level === 'chip' ? id * 4 + s.socket : id;
  return row[index] ??= `${s.level}:${id}${s.level === 'chip' ? `:${s.socket}` : ''}`;
}

/** Where a level sits on the zoom in progress, relative to its child on the path. */
export interface ZoomLink {
  /** This world's index on the path (0 = the top world). */
  index: number;
  /** The path key of the child this world zooms into or out of, or null for the deepest world. */
  child: string | null;
  /** How far the child's full world has faded in over this world's mini of it. */
  childAlpha: number;
  /** How far this world has faded in over its parent's mini (1 for the top world). */
  alpha: number;
  /** Camera travel from this world's rest (0) to its child's rest (1). */
  travel: number;
  /** Eased step progress: 0 at the step's start, 1 at its end, whatever the direction. */
  eased: number;
  direction: 'in' | 'out';
}
export function createZoomLink(): ZoomLink {
  return { index: -1, child: null, childAlpha: 0, alpha: 0, travel: 0, eased: 0, direction: 'in' };
}
/** Fill `out` for the world `key`, or return null when there is no zoom or the world is not on it. */
export function zoomLink(zoom: ZoomState | null, key: string, out: ZoomLink): ZoomLink | null {
  if (!zoom) return null;
  const path = zoom.path;
  let i = -1;
  for (let k = 0; k < path.length; k++) if (path[k].key === key) { i = k; break; }
  if (i < 0) return null;
  out.index = i; out.direction = zoom.direction; out.eased = zoom.eased;
  out.child = i + 1 < path.length ? path[i + 1].key : null;
  out.childAlpha = out.child ? zoom.alphas[i + 1] : 0;
  out.alpha = zoom.alphas[i];
  out.travel = clamp01(zoom.fromIndex + (zoom.toIndex - zoom.fromIndex) * zoom.eased - i);
  return out;
}

/** Rack ↔ System: how far the drilled server's sled is out, 0..1. Fully out once the board shows. */
export function sledOut(link: ZoomLink, reducedMotion: boolean): number {
  if (!link.child) return 0;
  if (reducedMotion || link.childAlpha > 0) return 1;
  return smooth(0.02, 0.28, link.travel);
}
/** Room ↔ Rack: how far the hall dims toward the rack. Leads the rack's fade so the hall dims as the camera starts. */
export function hallDim(link: ZoomLink, reducedMotion: boolean): number {
  if (!link.child || reducedMotion) return 0;
  const lead = link.direction === 'in' ? smooth(0, 0.35, link.eased) : 1 - smooth(0.6, 1, link.eased);
  return Math.max(link.childAlpha, lead);
}
/** World ↔ Room: how far the site has sunk into the map (0 on the map, 1 inside the room). */
export function siteSink(link: ZoomLink, reducedMotion: boolean): number {
  if (!link.child || reducedMotion) return 0;
  return link.direction === 'in' ? link.eased : 1 - link.eased;
}
