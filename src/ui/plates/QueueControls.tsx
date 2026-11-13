import type { ReactNode } from 'react';
import type { GameAction, LockReason, QueueStrategyId, ResearchId, SchedulerView, SystemId } from '../../game';
import { useQuote } from '../storeHooks';
import { LOADING_EFFECT, QUEUE_EFFECT } from './copy';
import { LockIcon } from './icons';
import { PreloadBudget } from './PreloadBudget';
import { ChoiceStrip } from './ChoiceStrip';
import '../styles/queue-controls.css';

export interface StripOption<T extends string> { readonly id: T; readonly label: ReactNode; readonly name: string; readonly lock: LockReason | null }

/** Offered: every researched option, the current one, and the first that research still locks. */
export function offered<Q extends { readonly locked: LockReason | null }>(quotes: readonly Q[], current: (q: Q) => boolean): Q[] {
  const next = quotes.find(q => q.locked?.code === 'research' && q.locked.node !== null && !current(q));
  return quotes.filter(q => !q.locked || current(q) || q === next);
}

/** One choice of several. A locked option is a key to its research project; it never selects. */
export function LockableStrip<T extends string>({ label, className = '', value, options, onPick, onResearch }: {
  label: string; className?: string; value: T; options: readonly StripOption<T>[]; onPick: (id: T) => void; onResearch?: (id: ResearchId) => void;
}) {
  return <div className={`choice-strip ${className}`} role="group" aria-label={label}>{options.map(o => {
    const on = o.id === value, node = o.lock?.node ?? null;
    return o.lock && !on ? <button key={o.id} type="button" className="lock" aria-label={`${o.name}, locked. Open research`} disabled={!node || !onResearch}
      onClick={() => node && onResearch?.(node)}><LockIcon />{o.label}</button>
      : <button key={o.id} type="button" className={on ? 'on' : ''} aria-pressed={on} aria-label={o.name} onClick={() => onPick(o.id)}>{o.label}</button>;
  })}</div>;
}

const NAMES: Readonly<Record<QueueStrategyId, [short: string, full: string]>> = {
  fifo: ['FIFO', 'First in, first out'], sjf: ['Short', 'Shortest first'], timeSlice: ['Slice', 'Time slice'], priority: ['Priority', 'Priority'], mlfq: ['Aging', 'Aging'],
};

/** Queue order, loading policy, preload cores and batching, each with what the selected choice does (spec §6.4, §8.1). */
export function QueueControls({ system, view, onAction, onResearch }: { system: SystemId; view: SchedulerView; onAction: (a: GameAction) => void; onResearch?: (id: ResearchId) => void }) {
  const qs = useQuote({ kind: 'part', part: { unit: { kind: 'system', id: system }, slot: { kind: 'scheduler' } } })?.quotes ?? [];
  const strategies = offered(qs.flatMap(q => q.action.type === 'setStrategy' ? [{ id: q.action.strategy as QueueStrategyId, locked: q.locked }] : []), q => q.id === view.strategy);
  const order = strategies.length ? strategies : [{ id: view.strategy, locked: null }];
  // Slicing shares every core among the running tasks, so nothing is left to preload with.
  const sliced = view.strategy === 'timeSlice', loading = view.optimization ?? 'utilization';
  return <section className="queue-controls" aria-label="Queue settings">
    <LockableStrip label="Queue order" className="queue-order" value={view.strategy} onResearch={onResearch}
      options={order.map(q => ({ id: q.id, label: NAMES[q.id][0], name: NAMES[q.id][1], lock: q.locked }))}
      onPick={strategy => onAction({ type: 'setStrategy', unit: { kind: 'system', id: system }, strategy })} />
    <p className="choice-effect" aria-live="polite" data-testid="queue-effect">{QUEUE_EFFECT[view.strategy]}</p>
    <fieldset className="queue-loading" disabled={sliced}>
      <div className="inline-setting"><span>Loading</span><ChoiceStrip label="Queue loading" value={loading}
        choices={[{ id: 'utilization', label: 'Keep busy' }, { id: 'preload', label: 'Preload' }]}
        onPick={value => onAction({ type: 'setQueueOptimization', system, optimization: value === 'preload' ? 'preload' : 'utilization' })} /></div>
      <p className="choice-effect" aria-live="polite" data-testid="loading-effect">{sliced ? 'Off while slicing: every core is shared.' : LOADING_EFFECT[loading]}</p>
      <PreloadBudget system={system} />
    </fieldset>
    <label className="queue-batching"><input type="checkbox" checked={view.batching ?? false}
      onChange={e => onAction({ type: 'setQueueBatching', system, on: e.target.checked })} />
      <span><b>Batch matching recipes</b><small>Reuses a finished match's cache.</small></span></label>
  </section>;
}
