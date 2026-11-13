import type { Quote, ResearchId } from '../../game';
import { overloadWarning, resultingSpecs, purchaseGain, purchaseReason } from './purchaseText';
import { LockIcon } from './icons';
import { Price } from './widgets';

/** Catalog order is generation order. Prefer the capacity-preserving quote for the next one. */
export function nextGeneration(quotes: readonly Quote[]): Quote | undefined {
  const first = quotes.find(q => q.action.type === 'replacePart' || q.action.type === 'replaceCpu');
  if (first?.action.type !== 'replacePart') return first;
  const generation = first.action.generation;
  return quotes.find(q => q.action.type === 'replacePart' && q.action.generation === generation && q.action.preserveCapacity) ?? first;
}

/**
 * The next generation as a key in the plate's bottom row, right of Downgrade and Remove: 44px, two lines, in the
 * secondary tone unless it is the component's only purchase. Line one is "Upgrade to <target>", line two the
 * resulting specs and the price. In a narrow key "Upgrade to" and then the specs drop out (CSS); the target and
 * the price always show whole. Research is navigation; an unlocked generation buys this component.
 */
export function GenerationAction({ quote, primary = false, onAction, onResearch, researchName }: {
  quote?: Quote;
  /** The component's only purchase (its level ladder has ended). */
  primary?: boolean;
  onAction: (quote: Quote) => void;
  onResearch?: (id: ResearchId) => void;
  researchName?: (id: ResearchId) => string;
}) {
  if (!quote) return null;
  const node = quote.locked?.code === 'research' ? quote.locked.node : null;
  const fullTarget = quote.label.replace(/^Replace CPU · /, '').replace(/ · L\d+$/, '');
  const target = fullTarget
    .replace(/ (?:power control|room start|global start|oscillator|CPU|PDU|UPS|room switch|switch|plane|CRAC)$/, '')
    .replace(/^GPU /, '').replace('Rear-door water', 'Rear-door');
  const after = quote.gpu?.after;
  const name = `${target}${after ? ` · ${after.cores} ${after.cores === 1 ? 'core' : 'cores'}` : ''}`;
  const label = node ? `Research ${researchName?.(node) ?? target}` : `Upgrade to ${name}`;
  const reason = purchaseReason(quote, researchName);
  const disabled = node ? !onResearch : !!reason;
  const cold = quote.cold && quote.downtimeMs > 0 ? `${Math.ceil(quote.downtimeMs / 1000)}s offline` : '';
  const spec = [after ? purchaseGain(quote) : resultingSpecs(quote), cold].filter(Boolean).join(' · ');
  const announcedLabel = node ? label : `Upgrade to ${fullTarget}`;
  // A lock's reason stays; resulting specs give way to the price in a narrow key.
  const why = !!quote.locked, detail = why ? reason : overloadWarning(quote) || spec;
  const price = !(quote.locked && quote.cost === '0') && <Price cost={quote.cost} currency={quote.currency} affordable={quote.affordable} />;
  return <button type="button" className={`key generation-action${primary && !node ? '' : ' replace'}`} disabled={disabled}
    data-research-target={node ?? undefined} data-purchase-action={!node ? JSON.stringify(quote.action) : undefined}
    aria-label={[announcedLabel, !node && spec, !node && reason, !node && `${quote.cost} Credits`].filter(Boolean).join('. ')}
    onClick={event => { event.stopPropagation(); if (!disabled) { if (node) onResearch?.(node); else onAction(quote); } }}>
    {node ? <><span className="kl">{label}</span><span className="pz"><LockIcon /></span></> : <>
      <span className="gen-name"><span className="gen-target">{name}</span><span className="gen-verb">Upgrade to</span></span>
      {why ? <span className="gen-foot">{detail && <span className="gen-detail">{detail}</span>}{price}</span>
        : <span className="gen-foot drop">{price}{detail && <span className="gen-detail">{detail}</span>}</span>}
    </>}
  </button>;
}
