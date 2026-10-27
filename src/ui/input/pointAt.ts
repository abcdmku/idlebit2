// A fix that is a part to look at, not a row to buy (lead, 26 Oct): a down power supply opens the Power
// supply plate, an overheated rack its cooler. Where the part isn't in view, the camera zooms there first.
import type { FailDetail, LevelId, NodeRef, PartRef, RackId } from '../../game';
import type { HitTarget } from '../../render/core';
import type { ShellContextValue } from '../storeHooks';

export type PointKind = 'psu' | 'rackCooler' | 'pdu' | 'ups' | 'rackUnit' | 'routing';
export interface PointFix { readonly kind: PointKind; readonly name: string; readonly rack?: RackId }

/** The block details whose fix is a plate. */
export const POINT_AT: Readonly<Partial<Record<FailDetail, PointFix>>> = {
  psu: { kind: 'psu', name: 'Power supply' },
  rack: { kind: 'rackCooler', name: 'Rack cooler' },
};
export const pointFix = (detail: FailDetail | null | undefined): PointFix | null => (detail ? POINT_AT[detail] ?? null : null);

type Shell = Pick<ShellContextValue, 'view' | 'store'>;
const LEVEL: Readonly<Record<PointKind, LevelId>> = { psu: 'system', rackCooler: 'rack', pdu: 'rack', ups: 'room', rackUnit: 'rack', routing: 'room' };
/** How long a zoom may take before the plate gives up opening (a transition is well under this). */
const ZOOM_DEADLINE_MS = 4000;

/** The plate's target in the current focus, or null when the part isn't in this view. */
function targetIn(shell: Shell, kind: PointKind, rack?: RackId): HitTarget | null {
  // The owner is the world the snapshot shows, which is what the plate layer matches against.
  const f = shell.store.getSnapshot().focus;
  let id: string, part: PartRef, owner: NodeRef;
  if (kind === 'rackUnit' && f.level === 'rack' && (rack === undefined || f.rackId === rack))
    return { id: 'unit', kind: 'unit', owner: { level: 'rack', id: f.rackId }, unit: { kind: 'rack', id: f.rackId }, part: null, slot: null, drill: null, sw: null, port: null, rect: { x: 0, y: 0, w: 0, h: 0 } };
  if (kind === 'psu' && (f.level === 'chip' || f.level === 'system')) {
    id = 'psu'; owner = { level: f.level, id: f.systemId }; part = { unit: { kind: 'system', id: f.systemId }, slot: { kind: 'psu' } };
  } else if ((kind === 'rackCooler' || kind === 'pdu') && f.level === 'rack') {
    id = kind === 'pdu' ? 'pdu' : 'cooler'; owner = { level: 'rack', id: f.rackId }; part = { unit: { kind: 'rack', id: f.rackId }, slot: { kind } };
  } else if (kind === 'ups' && f.level === 'room') {
    id = 'ups0'; owner = { level: 'room', id: f.roomId }; part = { unit: { kind: 'room', id: f.roomId }, slot: { kind: 'ups', index: 0 } };
  } else if (kind === 'routing' && f.level === 'rack') {
    id = 'lb'; owner = { level: 'rack', id: f.rackId }; part = { unit: { kind: 'rack', id: f.rackId }, slot: { kind: 'lb' } };
  } else if (kind === 'routing' && f.level === 'room') {
    id = 'roomLb'; owner = { level: 'room', id: f.roomId }; part = { unit: { kind: 'room', id: f.roomId }, slot: { kind: 'roomLb' } };
  } else return null;
  return { id, kind: 'part', owner, part, unit: null, slot: null, drill: null, sw: null, port: null, rect: { x: 0, y: 0, w: 0, h: 0 } };
}

/** Opens the part's plate; from another level, zooms to it and opens the plate when the camera lands. */
export function pointAt(shell: Shell, kind: PointKind, rack?: RackId): void {
  const level = kind === 'routing' && !shell.store.getSnapshot().unlocked.room ? 'rack' : LEVEL[kind];
  const now = targetIn(shell, kind, rack);
  if (now) { shell.view.dispatch({ type: 'select', target: now, plate: true }); return; }
  shell.view.dispatch({ type: 'zoomTo', level });
  // The camera and the snapshot both have to land; watch either, until the plate opens or the player moves on.
  const check = () => {
    const v = shell.view.getState();
    if (v.selected || v.sheet || v.task) { stop(); return; }
    if (v.partner || v.goal || v.focus.level !== level) return;
    if (kind === 'rackUnit' && rack !== undefined && v.focus.id !== rack) { shell.view.dispatch({ type: 'drill', ref: { level: 'rack', id: rack } }); return; }
    const t = targetIn(shell, kind, rack);
    if (!t) return;
    stop();
    shell.view.dispatch({ type: 'select', target: t, plate: true });
  };
  const offView = shell.view.subscribe(check), offStore = shell.store.subscribe(check);
  const stop = () => { clearTimeout(timer); offView(); offStore(); };
  const timer = setTimeout(stop, ZOOM_DEADLINE_MS);
  check();
}
