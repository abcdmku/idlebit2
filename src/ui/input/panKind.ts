import type { LevelSnapshot } from '../../game';

/**
 * What a drag or wheel moves at rest: the rack row while it has a neighbour; else the level's rest pan
 * whenever the renderer has one (Room, World, a CPU whose many cores make the die taller than the view,
 * and a rack cabinet taller than a short phone's view); else nothing, so the wheel zooms (QA-12). A rack
 * row whose cabinet is also taller than the view pans both: the row sideways, the cabinet up and down
 * ('rackRest'), so its lowest server is reachable by touch. Never during a zoom.
 */
export function panKind(focus: LevelSnapshot, restActive: boolean, zooming: boolean): 'rack' | 'rest' | 'rackRest' | null {
  if (zooming) return null;
  if (focus.level === 'rack' && focus.row.filter(r => r.rackId !== null).length > 1) return restActive ? 'rackRest' : 'rack';
  return restActive ? 'rest' : null;
}
