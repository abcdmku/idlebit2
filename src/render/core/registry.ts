import type { AnyLevelRenderer, LevelId, LevelRegistry, LevelRenderer } from './types';

/** Deepest level first. */
export const ORDER: readonly LevelId[] = ['chip', 'system', 'rack', 'room', 'global'];
export function depth(id: LevelId): number { return ORDER.indexOf(id); }
export function parentId(id: LevelId): LevelId | null { return ORDER[depth(id) + 1] ?? null; }
export function childId(id: LevelId): LevelId | null { return ORDER[depth(id) - 1] ?? null; }

const REQUIRED = ['size', 'focus', 'draw', 'drawMini', 'children', 'targets', 'icon'] as const;
/** Inject this same instance into level factories so parents can draw child minis. */
export function createLevelRegistry(initial: readonly AnyLevelRenderer[] = []): LevelRegistry {
  const levels = new Map<LevelId, AnyLevelRenderer>();
  const ordered: AnyLevelRenderer[] = [];
  const registry: LevelRegistry = {
    register(renderer) {
      for (const key of REQUIRED) if (typeof renderer[key] !== 'function') throw new Error(`Level ${renderer.id} is missing ${key}`);
      if (levels.has(renderer.id)) throw new Error(`Duplicate renderer: ${renderer.id}`);
      levels.set(renderer.id, renderer);
      ordered.length = 0;
      for (const id of ORDER) { const entry = levels.get(id); if (entry) ordered.push(entry); }
    },
    level<L extends LevelId>(id: L): LevelRenderer<L> {
      const renderer = levels.get(id);
      if (!renderer) throw new Error(`Unregistered renderer: ${id}`);
      return renderer as unknown as LevelRenderer<L>;
    },
    has: id => levels.has(id),
    allLevels: () => ordered,
  };
  for (const renderer of initial) registry.register(renderer);
  return registry;
}
