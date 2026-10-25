import { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { attachLiveBridge } from '../dev/bridge';
import type { LevelId } from '../game';
import { createGameStore, createRuntime, type GameStore } from '../platform';
import { createGameRegistry } from '../render';
import type { LevelRegistry } from '../render/core';
import { GameShell } from './GameShell';

export interface AppProps {
  store: GameStore;
  registry: LevelRegistry;
  level?: LevelId;
  /** Runs once the shell has mounted (boot attaches the DEV bridge here). */
  onMount?: () => (() => void) | void;
  /** The runtime's save, for the new-version Reload. */
  saveNow?: () => void;
}

/** The runtime belongs to boot and the platform; the shell only reads the store and dispatches. */
export function App({ store, registry, level, onMount, saveNow }: AppProps) {
  useEffect(() => onMount?.() ?? undefined, [onMount]);
  return <GameShell store={store} registry={registry} level={level} saveNow={saveNow} />;
}

const LEVELS: readonly LevelId[] = ['chip', 'system', 'rack', 'room', 'global'];

/**
 * Store, runtime, registry, then the shell. URL flags: `?fresh` ignores the save (QA),
 * `?level=system` opens that level first if it is unlocked.
 */
export async function boot(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const store = createGameStore();
  const runtime = createRuntime(store, { fresh: params.has('fresh') });
  // Levels load independently; a level that fails to load is logged and drawn blank.
  const registry = await createGameRegistry();
  const level = LEVELS.find(id => id === params.get('level'));
  const host = document.getElementById('root');
  if (!host) throw new Error('Missing #root');
  const onMount = () => attachLiveBridge(store, runtime);
  createRoot(host).render(<App store={store} registry={registry} level={level} onMount={onMount} saveNow={() => runtime.save()} />);
  if (import.meta.hot) import.meta.hot.dispose(() => runtime.dispose());
}
