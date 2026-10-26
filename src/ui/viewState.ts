// UI view state: what is on screen and what is selected. Navigation never reaches the sim
// (architecture §4). The store's SnapshotScope is derived from `focus` and `partner`.
//
// Zooms move one level per renderer transition (src/render/README.md "Zooms"). A jump of
// several levels sets `goal` and steps: each step makes the old focus the partner, and
// `settle` takes the next step once the renderer reports no transition after a draw.
import { ORDER, depth, isRef } from '../render/core';
import type { HitTarget } from '../render/core';
import type { LevelId, LevelSnapshot, NodeRef, RenderSnapshot, ResearchId, SnapshotScope } from '../game';

export { LEVEL_NAMES } from '../game';

/** A sheet over the world: the research screen. */
export type Sheet = 'research';

export interface ViewState {
  readonly focus: NodeRef;
  /** The other end of the zoom in progress; dropped when the renderer settles. */
  readonly partner: NodeRef | null;
  /** A multi-level zoom's destination level, or null at rest. */
  readonly goal: LevelId | null;
  readonly selectedId: string | null;
  /** A copy of the tapped target; its callout (and, on request, its plate) resolve it. */
  readonly selected: HitTarget | null;
  /** The selected target's full plate is open (the callout's More). */
  readonly plate: boolean;
  readonly sheet: Sheet | null;
  readonly researchProject: ResearchId | null;
  /** A queue card's task detail is open: its task key (`epoch:round:taskId`, never shown). */
  readonly task: string | null;
  readonly reducedMotion: boolean;
}

export type ViewCommand =
  | { readonly type: 'zoomTo'; readonly level: LevelId }
  | { readonly type: 'zoomStep'; readonly direction: 'in' | 'out'; readonly drill?: NodeRef | null }
  | { readonly type: 'drill'; readonly ref: NodeRef }
  /** `plate`: open its full plate at once (one tap shows the detail and its keys, user 26 Oct). */
  | { readonly type: 'select'; readonly target: HitTarget; readonly plate?: boolean }
  | { readonly type: 'openPlate' }
  | { readonly type: 'openResearch'; readonly project?: ResearchId | null }
  | { readonly type: 'toggleSheet'; readonly sheet: Sheet }
  | { readonly type: 'openTask'; readonly task: string }
  /** Phone back, browser Back and Escape: close the topmost menu only (task detail, plate, callout, sheet). */
  | { readonly type: 'back' }
  | { readonly type: 'cancel' };

export interface ViewStore {
  getState(): ViewState;
  getScope(): SnapshotScope;
  subscribe(listener: () => void): () => void;
  dispatch(command: ViewCommand): void;
  /** After each draw: `transitioning` is renderer.transition !== null. Drops the partner, chains the next step. */
  settle(transitioning: boolean): void;
  setReducedMotion(on: boolean): void;
  /** Back to a fresh view (new game, epoch change). */
  reset(next: ViewState): void;
}

const CLEAR = { selectedId: null, selected: null, plate: false, task: null } as const;
const same = (a: NodeRef | null, b: NodeRef | null) => a === b || (!!a && !!b && a.level === b.level && a.id === b.id);

export function initialView(snapshot: RenderSnapshot, level: LevelId = 'chip', reducedMotion = false): ViewState {
  const home = snapshot.home;
  const focus = (snapshot.unlocked[level] ? home[level] : null) ?? home.chip ?? { level: 'chip', id: 0 } as NodeRef;
  return { focus, partner: null, goal: null, ...CLEAR, sheet: null, researchProject: null, reducedMotion };
}

/** The adjacent node one step from `focus` toward `goal`, or null if there is none. */
export function stepToward(focus: LevelSnapshot, goal: LevelId, snapshot: RenderSnapshot): NodeRef | null {
  const from = depth(focus.level), to = depth(goal);
  if (from === to) return null;
  if (to > from) {
    if (focus.level === 'global') return null;
    return focus.parent ?? snapshot.home[ORDER[from + 1]!] ?? null;
  }
  if (focus.level === 'system') return { level: 'chip', id: focus.systemId };
  return snapshot.home[ORDER[from - 1]!] ?? null;
}

export function createViewStore(read: () => RenderSnapshot, initial: ViewState): ViewStore {
  let state = initial;
  let scope: SnapshotScope = { focus: state.focus, partner: state.partner };
  const listeners = new Set<() => void>();
  const publish = (next: ViewState) => {
    if (next === state) return;
    state = next;
    if (!same(scope.focus, next.focus) || !same(scope.partner, next.partner)) scope = { focus: next.focus, partner: next.partner };
    for (const listener of [...listeners]) listener();
  };
  /** One zoom step: the old focus becomes the partner. A step mid-transition cuts instead. */
  const move = (to: NodeRef, goal: LevelId | null): ViewState => {
    if (same(to, state.focus)) return goal === state.goal ? state : { ...state, goal: null };
    const adjacent = Math.abs(depth(to.level) - depth(state.focus.level)) === 1 && !state.partner;
    return { ...state, ...CLEAR, focus: to, partner: adjacent ? state.focus : null, goal, sheet: null };
  };
  const apply = (command: ViewCommand): ViewState => {
    const snapshot = read();
    switch (command.type) {
      case 'zoomTo': {
        if (!snapshot.unlocked[command.level] && command.level !== state.focus.level) return state;
        if (state.partner) return { ...state, goal: command.level };
        const next = stepToward(snapshot.focus, command.level, snapshot);
        if (!next) return state.goal ? { ...state, goal: null } : state;
        return move(next, next.level === command.level ? null : command.level);
      }
      case 'zoomStep': {
        if (state.partner) return state;
        const level = ORDER[depth(state.focus.level) + (command.direction === 'in' ? -1 : 1)];
        if (!level || !snapshot.unlocked[level]) return state;
        const drill = command.direction === 'in' && command.drill?.level === level ? command.drill : null;
        const next = drill ?? stepToward(snapshot.focus, level, snapshot);
        return next ? move(next, null) : state;
      }
      case 'drill':
        if (state.partner || !snapshot.unlocked[command.ref.level]) return state;
        return move(command.ref, null);
      case 'select': {
        const t = command.target;
        return { ...state, ...CLEAR, selectedId: t.id, selected: { ...t, rect: { ...t.rect } }, plate: command.plate ?? false, sheet: null };
      }
      case 'openPlate':
        return state.selected && !state.plate ? { ...state, plate: true } : state;
      case 'openResearch':
        return { ...state, ...CLEAR, sheet: 'research', researchProject: command.project ?? null };
      case 'toggleSheet':
        return state.sheet === command.sheet ? { ...state, sheet: null, researchProject: null }
          : { ...state, ...CLEAR, sheet: command.sheet, researchProject: null };
      case 'cancel':
        return state.selected || state.sheet || state.task
          ? { ...state, ...CLEAR, sheet: null, researchProject: null } : state;
      case 'openTask':
        return { ...state, ...CLEAR, sheet: null, researchProject: null, task: command.task };
      case 'back':
        // Innermost first: a task detail, then a part's detail (plate or callout: one layer), then a sheet.
        if (state.task) return { ...state, task: null };
        if (state.selected) return { ...state, ...CLEAR };
        if (state.sheet) return { ...state, sheet: null, researchProject: null };
        return state;
    }
  };
  return {
    getState: () => state,
    getScope: () => scope,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    dispatch: command => publish(apply(command)),
    settle(transitioning) {
      if (transitioning || !state.partner) return;
      const rested: ViewState = { ...state, partner: null };
      if (!state.goal) { publish(rested); return; }
      state = rested;
      const snapshot = read(), next = stepToward(snapshot.focus, state.goal!, snapshot);
      if (!next || !isRef(snapshot.focus, state.focus)) { publish({ ...rested, goal: null }); return; }
      publish(move(next, next.level === state.goal ? null : state.goal));
    },
    setReducedMotion(on) { if (on !== state.reducedMotion) publish({ ...state, reducedMotion: on }); },
    reset: next => publish(next),
  };
}
