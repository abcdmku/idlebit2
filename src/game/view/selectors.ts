import type { NodeRef, ResearchId, UnitKind, UnitRef } from '../types/ids';
import type { GameState } from '../types/state';
import type { ResearchTreeView, SavedConfigsView } from '../types/views';
import { unitLabel } from './labels';
import { researchTree } from './research';
import { contextualResearchTree } from './researchContext';

/** Lazy selectors: called by plates and the wafer while open, never inside the snapshot. */

/** `at`: the node the part specs (ResearchTreeView.parts) are read at; default the player's first system. */
export const selectResearchTree = (state: GameState, at: NodeRef | null = null): ResearchTreeView => researchTree(state, at);

export const selectContextualResearchTree = (state: GameState, focus: ResearchId | null = null, at: NodeRef | null = null): ResearchTreeView =>
  contextualResearchTree(state, focus, at);

export const selectSavedConfigs = (state: GameState, kind: UnitKind): SavedConfigsView =>
  ({ kind, names: state.configs[kind].map((c) => c.name) });

/** Short in-world name of a unit: "Server 3", "Rack 2", "Zone B", "eu-west". */
export const selectUnitLabel = (state: GameState, unit: UnitRef): string => unitLabel(state, unit);
