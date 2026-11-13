// One meet line as a key (user, 26 Oct): "Buy Cache 2 → 16 b · 9" buys every level in one tap; "Install …";
// or "Research X", which opens the research. An unaffordable line says "Saving up".
import type { GameAction, Quote, ResearchId } from '../../game';
import { Price, quotePrice } from '../plates/widgets';
import { useSavingUp } from '../deck/SavingUp';
import { meetLabel } from './meet';

export function MeetKey({ quote: q, onAction, onResearch, researchName, className = 'key' }: {
  quote: Quote; onAction: (a: GameAction) => void; onResearch?: (id: ResearchId) => void;
  researchName?: (id: ResearchId) => string; className?: string;
}) {
  const lock = q.locked, price = lock ? null : Math.ceil(Number(q.cost));
  const saving = useSavingUp(price, q.affordable);
  if (lock?.code === 'research' && lock.node) {
    const node = lock.node;
    return <button type="button" className={`${className} locked-action`} data-qa-target data-testid="td-fix" onClick={() => onResearch?.(node)}>{meetLabel(q, researchName)}</button>;
  }
  return <>
    <button type="button" className={className} data-qa-target data-testid="td-fix" disabled={!!lock || !q.affordable} onClick={() => onAction(q.action)}>
      {meetLabel(q, researchName)}{price !== null && <Price {...quotePrice(q)} affordable={q.affordable} />}</button>
    {(lock || saving) && <p className="need">{lock?.text ?? saving}</p>}
  </>;
}
