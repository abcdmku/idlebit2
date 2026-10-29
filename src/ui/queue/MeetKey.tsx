// One meet line as a key (user, 26 Oct): "Buy Cache 2 → 16 b · 9" buys every level in one tap; "Install …";
// or "Research X", which opens the research. An unaffordable line says "Saving up".
import type { GameAction, Quote, ResearchId } from '../../game';
import { CurrencyIcon } from '../Hud';
import { useSavingUp } from '../deck/SavingUp';
import { wholeText } from '../hooks/format';
import { meetLabel } from './meet';

export function MeetKey({ quote: q, n, onAction, onResearch, researchName, className = 'key' }: {
  quote: Quote; n: number; onAction: (a: GameAction) => void; onResearch?: (id: ResearchId) => void;
  researchName?: (id: ResearchId) => string; className?: string;
}) {
  const lock = q.locked, credits = q.currency === 'credits', price = lock || !credits ? null : Math.ceil(Number(q.cost));
  const saving = useSavingUp(price, q.affordable);
  if (lock?.code === 'research' && lock.node) {
    const node = lock.node;
    return <button type="button" className={`${className} locked-action`} data-qa-target data-testid="td-fix" onClick={() => onResearch?.(node)}>{meetLabel(q, researchName)}</button>;
  }
  return <>
    <button type="button" className={className} data-qa-target data-testid="td-fix" disabled={!!lock || !q.affordable} onClick={() => onAction(q.action)}>
      {meetLabel(q, researchName)}{price !== null && <span className="pz"> <CurrencyIcon kind="credits" n={n} />{wholeText(price)}</span>}</button>
    {(lock || saving) && <p className="need">{lock?.text ?? saving}</p>}
  </>;
}
