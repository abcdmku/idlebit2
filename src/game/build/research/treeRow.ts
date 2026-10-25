import type { AnswerCode, Era, ResearchCategory, ResearchEffect, WorkTier } from '../../types/catalog';
import type { LevelId } from '../../types/ids';

/** One node as written in docs/research.md §9: the arguments of its `n(...)` call. */
export type TreeRow = readonly [
  id: string, name: string, category: ResearchCategory, requires: readonly string[],
  /** The doc writes the Chip level as "cpu" (D7.1 rename); the sim id stays chip. */
  level: LevelId | 'cpu', era: Era, tier: WorkTier, data: number, effects: readonly ResearchEffect[], answers: readonly AnswerCode[],
];
