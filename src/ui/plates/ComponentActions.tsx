import { createContext, useContext, type ReactNode } from 'react';
import type { Quote } from '../../game';
import type { HitTarget } from '../../render/core';
import { useQuote, useShell } from '../storeHooks';
import { plateRequest } from './PlateLayer';
import { purchaseGain, purchaseReason } from './purchaseText';
import { CoinIcon } from './icons';
import { wholeText } from './format';

const Context = createContext<ReactNode>(null);
export const useComponentActions = () => useContext(Context);

export function MaintenanceAction({ quote: q, label, actionLabel = label, className = '', icon, onAction }: {
  quote: Quote; label: string; actionLabel?: string; className?: string; icon?: 'minus'; onAction: (quote: Quote) => void;
}) {
  const refund = q.refund && q.refund !== '0' ? q.refund : null;
  const reason = purchaseReason(q), title = [actionLabel, purchaseGain(q), refund ? `Returns ${refund} Credits` : '', reason,
    q.cold && q.downtimeMs > 0 ? `${Math.ceil(q.downtimeMs / 1000)}s offline` : ''].filter(Boolean).join(' · ');
  return <button type="button" className={`maintenance-action${q.action.type === 'removePart' ? ' remove' : ''} ${className}`}
    title={title} aria-label={title} disabled={!!reason} data-maintenance-action={JSON.stringify(q.action)} onClick={() => onAction(q)}>
    {icon === 'minus' ? <span className="maintenance-minus" aria-hidden="true" /> : label}
    {icon !== 'minus' && refund && <span className="maintenance-refund">+<CoinIcon />{wholeText(refund)}</span>}
  </button>;
}

/** Component maintenance is always visible and uses the simulation's own quotes. */
export function ComponentActions({ target, children }: { target: HitTarget; children: ReactNode }) {
  const shell = useShell(), focus = shell.store.getSnapshot().focus;
  const cores = target.id === 'cores' || target.part?.slot.kind === 'core';
  const part = cores && focus.level === 'chip' && focus.cores.length ? {
    unit: { kind: 'system' as const, id: focus.systemId }, slot: { kind: 'core' as const, socket: focus.socket, index: focus.cores.length - 1 },
  } : null;
  const result = useQuote(part ? { kind: 'part', part } : plateRequest(target, focus));
  const qs = result?.quotes.filter(q => q.action.type === 'removePart' || q.action.type === 'downgradePart'
    && q.action.part.slot.kind !== 'ram' && q.action.part.slot.kind !== 'drive') ?? [];
  const fire = (q: Quote) => { if (shell.dispatch(q.action)?.ok && q.action.type === 'removePart') shell.view.dispatch({ type: 'cancel' }); };
  const actions = qs.length ? <div className="component-maintenance" aria-label="Downgrade or remove component">
    {qs.map((q, i) => {
      const a = q.action;
      const label = a.type === 'removePart' ? a.part.slot.kind === 'core' ? 'Remove core' : 'Remove'
        : 'Downgrade';
      return <MaintenanceAction key={i} quote={q} label={label} onAction={fire} />;
    })}
  </div> : null;
  return <Context.Provider value={actions}>{children}</Context.Provider>;
}
