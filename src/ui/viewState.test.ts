import { describe, expect, it } from 'vitest';
import { rackId, roomId, systemId } from '../game';
import type { LevelSnapshot, NodeRef, RenderSnapshot } from '../game';
import { LEVEL_FIXTURES } from '../game/fixtures';
import { baseSnapshot, editSnapshot } from './hooks/testShell';
import { createViewStore, initialView } from './viewState';

const chip: NodeRef = { level: 'chip', id: systemId(3) }, system: NodeRef = { level: 'system', id: systemId(3) };
const rack: NodeRef = { level: 'rack', id: rackId(1) }, room: NodeRef = { level: 'room', id: roomId(0) };

/** A snapshot whose focus follows the view's scope, as the platform store does. */
function world() {
  let focus: NodeRef = chip;
  const levels: Record<string, LevelSnapshot> = {
    chip: { ...LEVEL_FIXTURES.chip, systemId: systemId(3), parent: system },
    system: { ...LEVEL_FIXTURES.system, systemId: systemId(3), parent: rack },
    rack: { ...LEVEL_FIXTURES.rack, rackId: rackId(1), parent: room },
    room: { ...LEVEL_FIXTURES.room, roomId: roomId(0), parent: { level: 'global', id: 0 } },
  };
  const base = editSnapshot(baseSnapshot(), {
    unlocked: { chip: true, system: true, rack: true, room: true, global: false },
    home: { chip, system, rack: { level: 'rack', id: rackId(0) }, room },
  });
  const read = (): RenderSnapshot => ({ ...base, focus: levels[focus.level]! });
  const view = createViewStore(read, initialView(read()));
  view.subscribe(() => { focus = view.getState().focus; });
  return view;
}

describe('view state zooms', () => {
  it('starts on the home chip', () => {
    expect(world().getState().focus).toEqual(chip);
  });
  it('chains a multi-level zoom one level per transition, through real parents', () => {
    const view = world();
    view.dispatch({ type: 'zoomTo', level: 'room' });
    expect(view.getScope()).toEqual({ focus: system, partner: chip });
    view.settle(true);
    expect(view.getState().partner).toEqual(chip);
    view.settle(false);
    expect(view.getScope()).toEqual({ focus: rack, partner: system });
    view.settle(false);
    expect(view.getScope()).toEqual({ focus: room, partner: rack });
    view.settle(false);
    expect(view.getState()).toMatchObject({ focus: room, partner: null, goal: null });
  });
  it('drills into a tapped child and refuses locked levels', () => {
    const view = world();
    view.dispatch({ type: 'zoomTo', level: 'global' });
    expect(view.getState().focus).toEqual(chip);
    view.dispatch({ type: 'zoomStep', direction: 'out' });
    view.settle(false);
    view.dispatch({ type: 'drill', ref: chip });
    expect(view.getScope()).toEqual({ focus: chip, partner: system });
  });
  it('selects, opens the plate on request, and cancels without moving the camera', () => {
    const view = world();
    const target = { id: 'core0', kind: 'part', owner: chip, drill: null, part: null, unit: null, sw: null, port: null, slot: null,
      rect: { x: 1, y: 2, w: 3, h: 4 } } as const;
    view.dispatch({ type: 'select', target });
    expect(view.getState()).toMatchObject({ selectedId: 'core0', plate: false });
    view.dispatch({ type: 'openPlate' });
    expect(view.getState().plate).toBe(true);
    view.dispatch({ type: 'cancel' });
    expect(view.getState()).toMatchObject({ selected: null, plate: false, focus: chip });
  });
  it('the research sheet toggles, and selecting closes it', () => {
    const view = world();
    view.dispatch({ type: 'toggleSheet', sheet: 'research' });
    expect(view.getState().sheet).toBe('research');
    view.dispatch({ type: 'toggleSheet', sheet: 'research' });
    expect(view.getState().sheet).toBeNull();
    view.dispatch({ type: 'openResearch' });
    view.dispatch({ type: 'select', target: { id: 'x', kind: 'part', owner: chip, drill: null, part: null, unit: null, sw: null, port: null, slot: null, rect: { x: 0, y: 0, w: 1, h: 1 } } });
    expect(view.getState().sheet).toBeNull();
  });
});
