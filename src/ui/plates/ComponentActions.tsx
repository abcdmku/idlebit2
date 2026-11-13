import { createContext, useContext, type ReactNode } from 'react';
import type { NodeRef, Quote } from '../../game';
import type { HitTarget } from '../../render/core';
import { useQuote, useShell } from '../storeHooks';
import { plateRequest } from './PlateLayer';
import { purchaseGain, purchaseReason } from './purchaseText';
import { CoinIcon, GemIcon } from './icons';
import { wholeText } from './format';

const Context = createContext<ReactNode>(null);
export const useComponentActions = () => useContext(Context);

export function MaintenanceAction({ quote: q, label, actionLabel = label, className = '', icon, onAction }: {
  quote: Quote; label: string; actionLabel?: string; className?: string; icon?: 'minus'; onAction: (quote: Quote) => void;
}) {
  const refund = q.refund && q.refund !== '0' ? q.refund : null, dataRefund = q.dataRefund && q.dataRefund !== '0' ? q.dataRefund : null;
  const returns = [dataRefund && `${dataRefund} Data`, refund && `${refund} Credits`].filter(Boolean).join(' and ');
  const reason = purchaseReason(q), title = [actionLabel, purchaseGain(q), returns ? `Returns ${returns}` : '', reason,
    q.cold && q.downtimeMs > 0 ? `${Math.ceil(q.downtimeMs / 1000)}s offline` : ''].filter(Boolean).join(' · ');
  return <button type="button" className={`maintenance-action${q.action.type === 'removePart' || q.action.type === 'removeUnit' ? ' remove' : ''} ${className}`}
    title={title} aria-label={title} disabled={!!reason} data-maintenance-action={JSON.stringify(q.action)} onClick={() => onAction(q)}>
    {icon === 'minus' ? <span className="maintenance-minus" aria-hidden="true" /> : label}
    {icon !== 'minus' && dataRefund && <span className="maintenance-refund">+<GemIcon />{wholeText(dataRefund)}</span>}
    {icon !== 'minus' && refund && <span className="maintenance-refund">+<CoinIcon />{wholeText(refund)}</span>}
  </button>;
}

/** Component maintenance is always visible and uses the simulation's own quotes. */
export function ComponentActions({ target, children }: { target: HitTarget; children: ReactNode }) {
  const shell = useShell(), focus = shell.store.getSnapshot().focus;
  const cores = target.kind !== 'unit' && (target.id === 'cores' || target.part?.slot.kind === 'core');
  const part = cores && focus.level === 'chip' && focus.cores.length ? {
    unit: { kind: 'system' as const, id: focus.systemId }, slot: { kind: 'core' as const, socket: focus.socket, index: focus.cores.length - 1 },
  } : null;
  const result = useQuote(part ? { kind: 'part', part } : plateRequest(target, focus));
  const all = result?.quotes ?? [];
  // Downgrade, then Remove: the left group of the plate's bottom row.
  const qs = [...all.filter(q => q.action.type === 'downgradePart' && q.action.part.slot.kind !== 'ram' && q.action.part.slot.kind !== 'drive'),
    ...all.filter(q => q.action.type === 'removePart' || q.action.type === 'removeUnit')];
  const fire = (q: Quote) => {
    const a = q.action, at = shell.view.getState().focus, build = shell.store.getState().build;
    let returnTo: NodeRef | null = null;
    if (a.type === 'removeUnit') {
      if (a.unit.kind === 'system' && (at.level === 'chip' || at.level === 'system') && at.id === a.unit.id) {
        const rack = build.systems[a.unit.id]?.rack;
        if (rack !== undefined) returnTo = { level: 'rack', id: rack };
      } else if (a.unit.kind === 'rack' && at.level === 'rack' && at.id === a.unit.id) {
        const room = build.racks[a.unit.id]?.room;
        if (room !== undefined) returnTo = { level: 'room', id: room };
      }
    }
    if (!shell.dispatch(a)?.ok) return;
    if (returnTo) shell.view.dispatch({ type: 'drill', ref: returnTo });
    else if (a.type === 'removePart' || a.type === 'removeUnit') shell.view.dispatch({ type: 'cancel' });
  };
  const actions = qs.length ? <div className="component-maintenance" aria-label="Downgrade or remove component">
    {qs.map((q, i) => {
      const a = q.action;
      const label = a.type === 'removeUnit' ? `Remove ${a.unit.kind === 'system' ? 'system' : a.unit.kind}`
        : a.type === 'removePart' ? a.part.slot.kind === 'core' ? 'Remove core' : 'Remove'
        : 'Downgrade';
      return <MaintenanceAction key={i} quote={q} label={label} onAction={fire} />;
    })}
  </div> : null;
  return <Context.Provider value={actions}>{children}</Context.Provider>;
}
