import type { Quote, ResearchId } from '../../game';
import { purchaseGain, purchaseReason } from './purchaseText';
import { Price } from './widgets';

/** Catalog order is generation order. Prefer the capacity-preserving quote for the next one. */
export function nextGeneration(quotes: readonly Quote[]): Quote | undefined {
  const first = quotes.find(q => q.action.type === 'replacePart' || q.action.type === 'replaceCpu');
  if (first?.action.type !== 'replacePart') return first;
  const generation = first.action.generation;
  return quotes.find(q => q.action.type === 'replacePart' && q.action.generation === generation && q.action.preserveCapacity) ?? first;
}

/** Research is navigation; an unlocked generation buys this exact component. */
export function GenerationAction({ quote, onAction, onResearch, researchName }: {
  quote?: Quote;
  onAction: (quote: Quote) => void;
  onResearch?: (id: ResearchId) => void;
  researchName?: (id: ResearchId) => string;
}) {
  if (!quote) return null;
  const node = quote.locked?.code === 'research' ? quote.locked.node : null;
  const target = quote.label.replace(/^Replace CPU · /, '').replace(/ · L\d+$/, '');
  const noPower = !!quote.overSupply || quote.locked?.code === 'power';
  const label = node ? `Research ${researchName?.(node) ?? target}` : noPower ? "Can't upgrade" : `Upgrade to ${target}`;
  const reason = purchaseReason(quote, researchName);
  const disabled = node ? !onResearch : !!reason;
  const cold = quote.cold && quote.downtimeMs > 0 ? `${Math.ceil(quote.downtimeMs / 1000)}s offline` : '';
  const spec = [purchaseGain(quote), cold].filter(Boolean).join(' · ');
  const detail = !node && (quote.locked || quote.overSupply ? reason : spec);
  return <button type="button" className="generation-action" disabled={disabled}
    data-research-target={node ?? undefined} data-purchase-action={!node ? JSON.stringify(quote.action) : undefined}
    aria-label={[label, !node && spec, !node && reason, !node && `${quote.cost} Credits`].filter(Boolean).join('. ')}
    onClick={event => { event.stopPropagation(); if (!disabled) { if (node) onResearch?.(node); else onAction(quote); } }}>
    <span className="generation-label">{label}</span>
    {!node && !(quote.locked && quote.cost === '0') && <Price cost={quote.cost} currency={quote.currency} />}
    {detail && <span className="generation-spec">{detail}</span>}
  </button>;
}
