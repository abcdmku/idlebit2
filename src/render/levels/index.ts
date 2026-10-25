import { createLevelRegistry, ORDER, setRect } from '../core';
import type { LevelId, LevelRegistry, LevelRenderer } from '../core';

/** Each level folder's index.ts exports one factory. Pass the shared registry so a parent can draw child minis. */
export interface LevelModules {
  createChipRenderer?: (registry: LevelRegistry) => LevelRenderer<'chip'>;
  createSystemRenderer?: (registry: LevelRegistry) => LevelRenderer<'system'>;
  createRackRenderer?: (registry: LevelRegistry) => LevelRenderer<'rack'>;
  createRoomRenderer?: (registry: LevelRegistry) => LevelRenderer<'room'>;
  createGlobalRenderer?: (registry: LevelRegistry) => LevelRenderer<'global'>;
}
type ReadyModules = Readonly<Record<string, LevelModules>>;
type ModuleLoaders = Readonly<Record<string, () => Promise<LevelModules>>>;
// Keep module evaluation inside a promise so one broken level cannot abort the page's imports.
const modules = import.meta.glob<LevelModules>('./*/index.ts');

function blankLevel<L extends LevelId>(id: L): LevelRenderer<L> {
  return {
    id, name: id,
    size: (_s, out) => setRect(out, 0, 0, 160, 200),
    focus: (_s, _viewport, out) => setRect(out, 0, 0, 160, 200),
    draw() {}, drawMini() {}, icon() {},
    children: () => 0,
    targets: (_s, _view, _out, from) => from,
  };
}

function registerLevel(registry: LevelRegistry, id: LevelId, module: LevelModules | undefined): void {
  try {
    if (module) {
      const renderer = id === 'chip' ? module.createChipRenderer?.(registry)
        : id === 'system' ? module.createSystemRenderer?.(registry)
          : id === 'rack' ? module.createRackRenderer?.(registry)
            : id === 'room' ? module.createRoomRenderer?.(registry)
              : module.createGlobalRenderer?.(registry);
      if (!renderer) throw new Error(`Missing renderer factory for ${id}`);
      if (renderer.id !== id) throw new Error(`Expected renderer ${id}, received ${renderer.id}`);
      registry.register(renderer);
    }
  } catch (error) {
    console.error(`Failed to register level "${id}"`, error);
  }
  // Parent renderers may look up child minis even when that child's module failed.
  if (!registry.has(id)) registry.register(blankLevel(id));
}

/** Load in parallel, then register deepest first. Each import and factory has its own failure boundary. */
export async function loadLevels(registry: LevelRegistry, found: ModuleLoaders = modules): Promise<void> {
  const loaded = await Promise.allSettled(ORDER.map(id =>
    Promise.resolve().then(() => found[`./${id}/index.ts`]?.())));
  for (let i = 0; i < ORDER.length; i++) {
    const id = ORDER[i], result = loaded[i];
    if (result.status === 'rejected') {
      console.error(`Failed to load level "${id}"`, result.reason);
      registerLevel(registry, id, undefined);
    } else registerLevel(registry, id, result.value);
  }
}

/** Supplied, already-loaded modules retain the synchronous registration path. */
export function registerLevels(registry: LevelRegistry, found: ReadyModules): void;
export function registerLevels(registry: LevelRegistry): Promise<void>;
export function registerLevels(registry: LevelRegistry, found?: ReadyModules): void | Promise<void> {
  if (!found) return loadLevels(registry);
  for (const id of ORDER) {
    registerLevel(registry, id, found[`./${id}/index.ts`]);
  }
}

export function createGameRegistry(found: ReadyModules): LevelRegistry;
export function createGameRegistry(): Promise<LevelRegistry>;
export function createGameRegistry(found?: ReadyModules): LevelRegistry | Promise<LevelRegistry> {
  const registry = createLevelRegistry();
  if (!found) return registerLevels(registry).then(() => registry);
  registerLevels(registry, found);
  return registry;
}
export function registeredLevelIds(registry: LevelRegistry): readonly LevelId[] {
  return registry.allLevels().map(level => level.id);
}
