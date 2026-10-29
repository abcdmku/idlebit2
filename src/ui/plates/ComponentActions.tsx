import { createContext, useContext, type ReactNode } from 'react';
import type { Quote } from '../../game';
import type { HitTarget } from '../../render/core';
import { useQuote, useShell } from '../storeHooks';
import { plateRequest } from './PlateLayer';
import { purchaseGain, purchaseReason } from './purchaseText';

const Context = createContext<ReactNode>(null);
export const useComponentActions = () => useContext(Context);

/** Component maintenance is always visible and uses the simulation's own quotes. */
export function ComponentActions({ target, children }: { target: HitTarget; children: ReactNode }) {
  const shell = useShell(), focus = shell.store.getSnapshot().focus;
  const cores = target.id === 'cores' || target.part?.slot.kind === 'core';
  const part = cores && focus.level === 'chip' && focus.cores.length ? {
    unit: { kind: 'system' as const, id: focus.systemId }, slot: { kind: 'core' as const, socket: focus.socket, index: focus.cores.length - 1 },
  } : null;
  const result = useQuote(part ? { kind: 'part', part } : plateRequest(target, focus));
  const qs = result?.quotes.filter(q => q.action.type === 'downgradePart' || q.action.type === 'removePart') ?? [];
  const fire = (q: Quote) => { if (shell.dispatch(q.action)?.ok && q.action.type === 'removePart') shell.view.dispatch({ type: 'cancel' }); };
  const actions = qs.length ? <div className="component-maintenance" aria-label="Downgrade or remove component">
    {qs.map((q, i) => {
      const a = q.action, memory = a.type === 'downgradePart' && (a.part.slot.kind === 'ram' || a.part.slot.kind === 'drive');
      const label = a.type === 'removePart' ? a.part.slot.kind === 'core' ? '− Core' : 'Remove'
        : memory ? a.type === 'downgradePart' && a.axis === 'speed' ? '− Speed' : '− Space' : 'Downgrade';
      const reason = purchaseReason(q), title = [label, purchaseGain(q), reason, q.cold && q.downtimeMs > 0 ? `${Math.ceil(q.downtimeMs / 1000)}s offline` : ''].filter(Boolean).join(' · ');
      return <button key={i} type="button" className={`maintenance-action${a.type === 'removePart' ? ' remove' : ''}`} title={title} aria-label={title}
        disabled={!!reason} data-maintenance-action={JSON.stringify(a)} onClick={() => fire(q)}>{label}</button>;
    })}
  </div> : null;
  return <Context.Provider value={actions}>{children}</Context.Provider>;
}
