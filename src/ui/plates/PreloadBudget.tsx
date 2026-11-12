import type { SystemId } from '../../game';
import { useGameSelector, useShell, shallowEqual } from '../storeHooks';
import { ChoiceStrip } from './ChoiceStrip';

/** How many idle cores may load cache for queued tasks at once: 1, 2 or 4, as far as research allows. */
export function PreloadBudget({ system }: { system: SystemId }) {
  const shell = useShell();
  const value = useGameSelector(() => {
    const state = shell.store.getState(), max = state.compiled.sys.preloadLoaders[system] ?? 1;
    return { max, selected: Math.min(max, state.build.systems[system]?.spec.settings.queueLoaderLimit ?? 4) };
  }, shallowEqual, 200);
  if (value.max <= 1) return null;
  return <div className="inline-setting"><span>Preload cores</span><ChoiceStrip label="Cores that preload at once" value={String(value.selected)}
    choices={([1, 2, 4] as const).filter(n => n <= value.max).map(n => ({ id: String(n), label: String(n) }))}
    onPick={n => shell.dispatch({ type: 'setQueueLoaderLimit', system, limit: Number(n) as 1 | 2 | 4 })} /></div>;
}
