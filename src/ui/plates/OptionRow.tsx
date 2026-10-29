import type { ReactNode } from 'react';
import type { Quote, ResearchId } from '../../game';
import { QuoteKey } from './widgets';

export interface Option { readonly verb: string; readonly name: string; readonly quote: Quote; readonly effect?: ReactNode }
export interface OptionRowProps {
  readonly option: Option; readonly primary?: boolean; readonly onAction: (q: Quote) => void;
  readonly onResearch?: (id: ResearchId) => void; readonly researchName?: (id: ResearchId) => string;
}
export function OptionRow({ option: o, primary = false, onAction, onResearch, researchName, className = '' }: OptionRowProps & { className?: string }) {
  const label = o.verb === 'Replace' ? o.name : o.verb;
  return <div className={className}><QuoteKey quote={o.quote} label={label} tone={primary ? '' : 'replace'}
    ariaLabel={o.verb + ': ' + o.name + ', ' + o.quote.cost + ' Credits'}
    onAction={onAction} onResearch={onResearch} researchName={researchName} /></div>;
}
export function OptionList({ options, className = '', rowClassName = '', ...row }: { options: readonly Option[]; className?: string; rowClassName?: string }
  & Pick<OptionRowProps, 'onAction' | 'onResearch' | 'researchName'>) {
  return options.length ? <div className={'opts ' + className}>{options.map((option, i) =>
    <OptionRow key={i} option={option} className={rowClassName} {...row} />)}</div> : null;
}

/** Alternates worth a key: every open one, and only the first that research still locks (its key opens it), so a plate
 * shows one Research key however many of its steps wait on research. */
export function routine<T extends { quote: Quote }>(list: readonly T[]): T[] {
  const firstLocked = list.find(x => x.quote.locked?.code === 'research');
  return list.filter(x => x.quote.locked?.code !== 'research' || x === firstLocked);
}

/** The ECC conversion still to do: none once all RAM is ECC (its ceiling), which is not a key at all. */
export const eccToDo = (q: Quote) => q.action.type === 'convertRamToEcc' && q.locked?.code !== 'ceiling';

/** Two replaces of one generation (its capacity-keeping one and its base level) are one choice. */
export const sameGeneration = (q: Quote, lead: Quote | undefined) => !!lead && (q === lead
  || (q.action.type === 'replacePart' && lead.action.type === 'replacePart' && q.action.generation === lead.action.generation));

/** One replace per generation: the capacity-keeping one where the sim offers both. */
export const perGeneration = (qs: readonly Quote[]) => qs.filter(q => q.action.type !== 'replacePart' || q.action.preserveCapacity
  || !qs.some(o => o !== q && o.action.type === 'replacePart' && q.action.type === 'replacePart' && o.action.generation === q.action.generation && o.action.preserveCapacity));

/**
 * A step worth pinning as a plate's main action (R16): open, within every supply, giving up none of what it shows
 * (capacity, bandwidth or IO, research rate) and gaining something. Real trade-offs stay ordinary keys with their
 * losses shown; a known regression or a dead Max is never the recommendation.
 */
export function improves(q: Quote): boolean {
  if (q.locked || q.overSupply) return false;
  const e = q.effect;
  if (!e) return q.action.type === 'convertRamToEcc';
  const tb = e.throughputBefore, ta = e.throughputAfter, rb = e.researchOpsBefore, ra = e.researchOpsAfter;
  if (e.capacityAfter < e.capacityBefore || (tb !== undefined && ta !== undefined && ta < tb) || (rb !== undefined && ra !== undefined && ra < rb)) return false;
  const loss = e.lossPctBefore !== undefined && e.lossPctAfter !== undefined && e.lossPctAfter < e.lossPctBefore;
  return e.capacityAfter > e.capacityBefore || (tb !== undefined && ta !== undefined && ta > tb) || (rb !== undefined && ra !== undefined && ra > rb) || loss;
}
