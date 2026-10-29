import { type GameAction, type SchedulerView, type SystemId } from '../../game';
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
    <PreloadBudget system={system} />
    <label className="queue-batching"><input type="checkbox" checked={view.batching ?? false}
      onChange={e => onAction({ type: 'setQueueBatching', system, on: e.target.checked })} />Batch matching recipes</label>
    <div className="queue-preparation">
      <p className="p-line">{p ? `${bits(p.loadedBits)} / ${bits(p.targetBits)} cached · ${p.availableCores}/${p.requiredCores} cores` : 'Loader idle'}</p>
    </div>
    <p className="p-line muted">{bits(view.batchSavedBits ?? 0)} of cache loading reused this round</p>
  </section>;
}
