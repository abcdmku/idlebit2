import { type GameAction, type SchedulerView, type SystemId, type QueueStrategyId } from '../../game';
import { useQuote } from '../storeHooks';
import { PreloadBudget } from './PreloadBudget';
import { ChoiceStrip } from './ChoiceStrip';
import '../styles/queue-controls.css';

export function QueueControls({ system, view, onAction }: { system: SystemId; view: SchedulerView; onAction: (a: GameAction) => void }) {
  const qs = useQuote({ kind: 'part', part: { unit: { kind: 'system', id: system }, slot: { kind: 'scheduler' } } })?.quotes ?? [];
  const names: Record<QueueStrategyId, string> = { fifo: 'FIFO', sjf: 'Shortest', timeSlice: 'Time slice', priority: 'Priority', mlfq: 'Aging' };
  const strategies = qs.filter(q => q.action.type === 'setStrategy');
  return <section className="queue-controls" aria-label="Queue optimization">
    <div className="queue-order"><ChoiceStrip label="Queue order" value={view.strategy}
      choices={strategies.flatMap(q => q.action.type === 'setStrategy' ? [{ id: q.action.strategy,
        label: q.action.strategy === 'timeSlice' ? 'Slice' : q.action.strategy === 'sjf' ? 'Short' : names[q.action.strategy as QueueStrategyId], disabled: !!q.locked, title: q.locked?.text ?? names[q.action.strategy as QueueStrategyId] }] : [])}
      onPick={value => onAction({ type: 'setStrategy', unit: { kind: 'system', id: system }, strategy: value as QueueStrategyId })} /></div>
    <div className="inline-setting"><span>Loading</span><ChoiceStrip label="Queue loading" value={view.optimization ?? 'utilization'}
      choices={[{ id: 'utilization', label: 'Keep busy' }, { id: 'preload', label: 'Preload' }]}
      onPick={value => onAction({ type: 'setQueueOptimization', system, optimization: value === 'preload' ? 'preload' : 'utilization' })} /></div>
    <PreloadBudget system={system} />
    <label className="queue-batching"><input type="checkbox" checked={view.batching ?? false}
      onChange={e => onAction({ type: 'setQueueBatching', system, on: e.target.checked })} />Batch matching recipes</label>
  </section>;
}
