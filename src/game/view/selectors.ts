import type { ResearchId, SystemId, UnitKind, UnitRef } from '../types/ids';
import type { GameState } from '../types/state';
import type { QueuePage, ResearchTreeView, SavedConfigsView } from '../types/views';
import { unitLabel } from './labels';
import { researchTree } from './research';
import { contextualResearchTree } from './researchContext';
import { queuedTasks } from './tasks';

/** Lazy selectors: called by plates and the wafer while open, never inside the snapshot. */

export const selectResearchTree = (state: GameState): ResearchTreeView => researchTree(state);

export const selectContextualResearchTree = (state: GameState, focus: ResearchId | null = null): ResearchTreeView =>
  contextualResearchTree(state, focus);

export const selectSavedConfigs = (state: GameState, kind: UnitKind): SavedConfigsView =>
  ({ kind, names: state.configs[kind].map((c) => c.name) });

/** One page of a system's scheduler queue, front first. */
export function selectQueuePage(state: GameState, systemId: SystemId, offset: number, limit: number): QueuePage {
  const total = state.build.systems[systemId] ? (state.hot.sys.queueLen[systemId] ?? 0) : 0;
  const from = Math.max(0, Math.min(Math.floor(offset), total));
  return { systemId, offset: from, total, tasks: total > 0 ? queuedTasks(state, systemId, from, Math.max(0, Math.floor(limit))) : [] };
}

/** Short in-world name of a unit: "Server 3", "Rack 2", "Zone B", "eu-west". */
export const selectUnitLabel = (state: GameState, unit: UnitRef): string => unitLabel(state, unit);
