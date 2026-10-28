import { FAMILIES, type GameAction, type SchedulerView, type SystemId } from '../../game';
import { bits } from './format';
import { PreloadBudget } from './PreloadBudget';
import '../styles/queue-controls.css';

export function QueueControls({ system, view, onAction }: { system: SystemId; view: SchedulerView; onAction: (a: GameAction) => void }) {
  const p = view.preparation;
  return <section className="queue-controls" aria-label="Queue optimization">
    <label>Optimize for
      <select value={view.optimization ?? 'utilization'} onChange={e => onAction({ type: 'setQueueOptimization', system,
        optimization: e.target.value === 'preload' ? 'preload' : 'utilization' })}>
        <option value="utilization">Keep cores busy</option><option value="preload">Preload and wait for cores</option>
      </select>
    </label>
    <p className="p-line muted">{view.strategy === 'timeSlice' ? 'Time slicing shares cores; queued preloading is paused.'
      : view.optimization === 'preload' ? 'Loads cache using idle cores; wide tasks wait for their full core count.'
      : 'Starts tasks immediately on available cores.'}</p>
    <PreloadBudget system={system} />
    <label className="queue-batching"><input type="checkbox" checked={view.batching ?? false}
      onChange={e => onAction({ type: 'setQueueBatching', system, on: e.target.checked })} />Batch matching recipes</label>
    <p className="p-line muted">Reuses fixed cache workspace; task data stays separate.</p>
    <div className="queue-preparation">
      <p className="p-line">{p ? `${p.active ? 'Preloading' : 'Prepared'} ${FAMILIES[p.family]?.name ?? 'task'}` : 'No task preloading'}</p>
      <p className="p-line">{p ? `${bits(p.loadedBits)} / ${bits(p.targetBits)} cached · ${p.active ? 'loader active' : 'loader idle'}` : 'Cache loading costs 1 CPU op per bit'}</p>
      <p className="p-line">{p ? `${p.requiredCores} cores wanted · ${p.availableCores} available` : 'Wide tasks can wait while smaller tasks pass'}</p>
    </div>
    <p className="p-line muted">{bits(view.batchSavedBits ?? 0)} of cache loading reused this round</p>
  </section>;
}
