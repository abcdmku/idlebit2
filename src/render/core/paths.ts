// The zoom path between the snapshot's focus and partner. v3 publishes only those two
// level snapshots, so a zoom spans one level. Multi-level jumps are chained by the UI
// view store, one level per transition (see README).
import { depth } from './registry';
import { copyRect, rect } from './geom';
import type { Point } from './geom';
import type { PathNode } from './transition';
import { isRef, refKey, refOf } from './types';
import type { RestFraming } from './camera';
import type { ChildView, LevelRegistry, LevelRenderer, LevelSnapshot, Rect, RestArea, WorldForm } from './types';

/** A level's rest on the zoom path: its free world and, when it is not the zoom's own, its framing. */
export type RestOf = (level: LevelRenderer) => { readonly area?: RestArea; readonly framing?: RestFraming | null };

/** True when `a` and `b` are one level apart. */
export function adjacent(a: LevelSnapshot, b: LevelSnapshot): boolean {
  return Math.abs(depth(a.level) - depth(b.level)) === 1;
}
/** Parent first. Allocates; call at navigation time only. Null if not one level apart. `rest` is the free world at rest, as `focus()` takes it, or each level's own. */
export function zoomPath(registry: LevelRegistry, a: LevelSnapshot, b: LevelSnapshot, viewport: Rect,
  scratch: ChildView[], form: WorldForm = 'desktop', rest?: RestArea | RestOf): PathNode[] | null {
  if (!adjacent(a, b)) return null;
  const restOf: RestOf = typeof rest === 'function' ? rest : () => ({ area: rest });
  const parent = depth(a.level) > depth(b.level) ? a : b, child = parent === a ? b : a;
  const parentLevel = registry.level(parent.level), childLevel = registry.level(child.level);
  const up = restOf(parentLevel), down = restOf(childLevel);
  // (a level that plans at rest lays out in focus(), so it is asked first)
  const parentFocus = parentLevel.focus(parent, viewport, rect(), form, up.area), childFocus = childLevel.focus(child, viewport, rect(), form, down.area);
  const parentSize = parentLevel.size(parent, rect(), form);
  const childRect = rect(parentSize.x + parentSize.w / 2 - 4, parentSize.y + parentSize.h / 2 - 4, 8, 8);
  for (const c of scratch) c.world = null;
  const childRef = refOf(child), count = parentLevel.children(parent, scratch, form);
  for (let i = 0; i < count; i++) if (isRef(child, scratch[i].ref)) { copyRect(scratch[i].world ?? scratch[i].rect, childRect); break; }
  return [
    { key: refKey(refOf(parent)), size: parentSize, rect: rect(), focus: parentFocus, framing: up.framing,
      scaleStep: parentLevel.cameraScaleStep?.(parent), entry: parentLevel.entry?.(parent, { x: 0, y: 0 } as Point, form) },
    { key: refKey(childRef), size: childLevel.size(child, rect(), form), rect: childRect, focus: childFocus, framing: down.framing,
      scaleStep: childLevel.cameraScaleStep?.(child), mini: childLevel.miniRect?.(child, rect(), form),
      entry: childLevel.entry?.(child, { x: 0, y: 0 } as Point, form) },
  ];
}
