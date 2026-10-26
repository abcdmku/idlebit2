import type { LevelSnapshot } from '../../game';

/**
 * What a drag or wheel moves at rest: the rack row while it has a neighbour; else the level's rest pan
 * whenever the renderer has one (Room, World, and a CPU whose many cores make the die taller than the
 * view); else nothing, so the wheel zooms (QA-12). Never during a zoom.
 */
export function panKind(focus: LevelSnapshot, restActive: boolean, zooming: boolean): 'rack' | 'rest' | null {
  if (zooming) return null;
  if (focus.level === 'rack') return focus.row.filter(r => r.rackId !== null).length > 1 ? 'rack' : null;
  return restActive ? 'rest' : null;
}
