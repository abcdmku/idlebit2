import type { ReactNode } from 'react';
import type { Quote, ResearchId } from '../../game';
import { QuoteKey } from './widgets';
import { costWords } from './purchaseText';

export interface Option { readonly verb: string; readonly name: string; readonly quote: Quote; readonly effect?: ReactNode }
export interface OptionRowProps {
  readonly option: Option; readonly primary?: boolean; readonly onAction: (q: Quote) => void;
  readonly onResearch?: (id: ResearchId) => void; readonly researchName?: (id: ResearchId) => string;
}
export function OptionRow({ option: o, primary = false, onAction, onResearch, researchName, className = '' }: OptionRowProps & { className?: string }) {
  const label = o.verb === 'Replace' ? o.name : o.verb;
  return <div className={className}><QuoteKey quote={o.quote} label={label} tone={primary ? '' : 'replace'}
    ariaLabel={o.verb + ': ' + o.name + ', ' + costWords(o.quote)}
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
