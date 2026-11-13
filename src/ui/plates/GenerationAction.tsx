import type { Quote, ResearchId } from '../../game';
import { costWords, overloadWarning, resultingSpecs, purchaseGain, purchaseReason } from './purchaseText';
import { LockIcon } from './icons';
import { measureUnit } from './format';
import { Price, quotePrice } from './widgets';

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
  // A new generation starts at level 1, so it can be slower or smaller than the levelled part it replaces: say so.
  const e = after ? null : quote.effect, drop = !!e && e.capacityAfter < e.capacityBefore;
  const verb = drop ? 'Replace with' : 'Upgrade to';
  const label = node ? `Research ${researchName?.(node) ?? target}` : `${verb} ${name}`;
  const reason = purchaseReason(quote, researchName);
  const disabled = node ? !onResearch : !!reason;
  const cold = quote.cold && quote.downtimeMs > 0 ? `${Math.ceil(quote.downtimeMs / 1000)}s offline` : '';
  const spec = [drop ? `from ${measureUnit(e!.capacityBefore, e!.unit)}` : after ? purchaseGain(quote) : resultingSpecs(quote), cold].filter(Boolean).join(' · ');
  const announcedLabel = node ? label : `${verb} ${fullTarget}${drop ? `, ${measureUnit(e!.capacityAfter, e!.unit)}` : ''}`;
  // A lock's reason stays; resulting specs give way to the price in a narrow key.
  const why = !!quote.locked, detail = why ? reason : overloadWarning(quote) || spec;
  const price = !(quote.locked && quote.cost === '0') && <Price {...quotePrice(quote)} affordable={quote.affordable} />;
  return <button type="button" className={`key generation-action${primary && !node && !drop ? '' : ' replace'}`} disabled={disabled}
    data-research-target={node ?? undefined} data-purchase-action={!node ? JSON.stringify(quote.action) : undefined}
    aria-label={[announcedLabel, !node && spec, !node && reason, !node && costWords(quote)].filter(Boolean).join('. ')}
    onClick={event => { event.stopPropagation(); if (!disabled) { if (node) onResearch?.(node); else onAction(quote); } }}>
    {node ? <><span className="kl">{label}</span><span className="pz"><LockIcon /></span></> : <>
      <span className="gen-name"><span className="gen-target">{drop ? <>{target.replace(/ package$/, '')} · <span className="warn">{measureUnit(e!.capacityAfter, e!.unit)}</span></> : name}</span><span className="gen-verb">{verb}</span></span>
      {why ? <span className="gen-foot">{detail && <span className="gen-detail">{detail}</span>}{price}</span>
        : <span className="gen-foot drop">{price}{detail && <span className="gen-detail">{detail}</span>}</span>}
    </>}
  </button>;
}
