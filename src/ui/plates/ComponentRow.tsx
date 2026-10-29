import type { PartRef } from '../../game';
import type { HitTarget } from '../../render/core';
import { sourceAction, sourceRequest, runSourceAction } from '../input/sourceAction';
import { useQuote, useShell } from '../storeHooks';
import { GenerationAction } from './GenerationAction';
import { QuoteKey } from './widgets';

/** A one-action component buys on the overview row instead of opening a second popup. */
export function ComponentRow({ label, value, part, onOpen }: {
  label: string; value: string; part: PartRef | null; onOpen: () => void;
}) {
  const shell = useShell(), focus = shell.store.getSnapshot().focus;
  const target: HitTarget = { id: `component-${label}`, kind: 'part', owner: shell.view.getState().focus,
    part, unit: null, sw: null, slot: null, port: null, drill: null, rect: { x: 0, y: 0, w: 0, h: 0 } };
  const quotes = useQuote(part ? sourceRequest(target, focus) : null);
  const direct = part ? sourceAction(target, focus, quotes?.quotes ?? []) : null;
  if (direct) {
    const q = direct.quote, buy = () => runSourceAction(shell, target);
    return q.locked?.code === 'research' ? <GenerationAction quote={q} onAction={buy} onResearch={buy} />
      : <QuoteKey quote={q} label={label} detail={direct.gain} onAction={buy} />;
  }
  return <button type="button" className="sum-row" disabled={!part} data-qa-target onClick={onOpen}>
    <b>{label}</b><span>{value}</span></button>;
}
