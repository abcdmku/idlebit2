import type { SystemId } from '../../game';
import { useGameSelector, useShell, shallowEqual } from '../storeHooks';

export function PreloadBudget({ system }: { system: SystemId }) {
  const shell = useShell();
  const value = useGameSelector(() => {
    const state = shell.store.getState(), max = state.compiled.sys.preloadLoaders[system] ?? 1;
    return { max, selected: Math.min(max, state.build.systems[system]?.spec.settings.queueLoaderLimit ?? 4) };
  }, shallowEqual, 200);
  if (value.max <= 1) return null;
  return <div className="queue-loader-budget"><p className="p-line">Cache loader core budget</p><div className="keys key-pair">
    {([1, 2, 4] as const).filter(n => n <= value.max).map(n => <button key={n} type="button" className="key row" aria-pressed={value.selected === n}
      onClick={() => shell.dispatch({ type: 'setQueueLoaderLimit', system, limit: n })}>{n} {n === 1 ? 'core' : 'cores'}</button>)}
  </div><p className="p-line muted">Uses idle physical cores and installed cache.</p></div>;
}
