// One direct, priced action (user, 26 Oct: everything one or two taps from play). Tapping a part opens its options
// and spends nothing; each option is its own key, so the second tap buys. What it does, its downtime and any
// supply warning with its fix sit above the key, so a key never shows without its consequence.
import { useContext, type ReactNode } from 'react';
import { supplyPreparation, type Quote, type ResearchId } from '../../game';
import { EffectDetail } from './PartKeys';
import { coldText, OverSupplyNote, QuoteKey } from './widgets';
import { ShellContext } from '../storeHooks';

export interface Option {
  /** The key's verb: "Upgrade", "Add RAM", "Replace". */
  readonly verb: string;
  /** What it buys: "DDR2 · L14", "RAM 2 · DDR3", "CPU 3 · same as CPU 1". */
  readonly name: string;
  readonly quote: Quote;
  /** The before → after, when it reads better than the quote's own effect lines. */
  readonly effect?: ReactNode;
}

export interface OptionRowProps {
  readonly option: Option;
  /** The plate's main action: the gold key and the full consequence. Others are one-line keys. */
  readonly primary?: boolean;
  readonly onAction: (q: Quote) => void;
  readonly onResearch?: (id: ResearchId) => void;
  readonly researchName?: (id: ResearchId) => string;
}

export function OptionRow({ option: o, primary = false, onAction, onResearch, researchName, className = '', prepAbove = false }: OptionRowProps & { className?: string; prepAbove?: boolean }) {
  const q = o.quote, cold = coldText(q), effect = o.effect ?? (q.effect ? <EffectDetail quote={q} brief={!primary} /> : null);
  const verb = q.overSupply ? `${o.verb} anyway` : o.verb;
  return <section className={`opt${primary ? ' primary' : ''}${className ? ` ${className}` : ''}`}>
    {primary && <p className="opt-name">{o.name}</p>}
    {effect && <p className="option-values">{effect}</p>}
    {cold && <p className="option-cold">{cold}</p>}
    {/* R17: an option over a supply says so in its own words ("With DDR4 · L1: full load …") with its preparation, a
        secondary key, inside the option: never a plate-wide block that reads as the machine as it is now. */}
    <OverSupplyNote quote={q} onAction={onAction} scope={o.name} prepAbove={prepAbove} />
    <QuoteKey quote={q} label={primary ? verb : `${verb} ${o.name}`} tone={primary && !q.overSupply ? '' : 'replace'} showSupplyNote={false}
      ariaLabel={`${verb}: ${o.name}, ${q.cost} ${q.currency === 'data' ? 'Data' : 'Credits'}`}
      onAction={onAction} onResearch={onResearch} researchName={researchName} />
  </section>;
}

/**
 * A plate's alternate options (R17): the safe ones first, then each one over a supply with its own warning and its
 * preparation inside it. Two options needing the very same preparation carry its key once (the first); the other
 * points to it, so no key repeats.
 */
export function OptionList({ options, className = '', rowClassName = '', ...row }: { options: readonly Option[]; className?: string; rowClassName?: string }
  & Pick<OptionRowProps, 'onAction' | 'onResearch' | 'researchName'>) {
  // Without a shell (isolated component tests) nothing is shared, so every unsafe option shows its own preparation.
  const state = useContext(ShellContext)?.store.getState(), seen = new Set<string>();
  const ordered = [...options.filter(o => !o.quote.overSupply), ...options.filter(o => o.quote.overSupply)];
  if (!ordered.length) return null;
  return <div className={`opts${className ? ` ${className}` : ''}`}>{ordered.map((o, i) => {
    // The same preparation as the player sees it: the same step on the same supply, to the same capacity, at the same price.
    const prep = o.quote.overSupply && state ? supplyPreparation(state, o.quote, false) : null;
    const key = prep ? `${prep.action.type}|${o.quote.overSupply!.part}|${prep.effect?.capacityAfter}|${prep.cost}` : '';
    const above = !!key && seen.has(key);
    if (key) seen.add(key);
    return <OptionRow key={i} option={o} prepAbove={above} className={rowClassName} {...row} />;
  })}</div>;
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
