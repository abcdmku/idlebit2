import type { ReactNode } from 'react';
import type { Quote } from '../../game';
import { OptionRow, type Option } from './OptionRow';
import { GenerationAction, nextGeneration } from './GenerationAction';
import type { PlateCommon } from './types';

const isUpgrade = (q: Quote) => q.action.type === 'upgradePart' || q.action.type === 'upgradeAll';
const isReplace = (q: Quote) => q.action.type === 'replacePart' || q.action.type === 'replaceCpu';

export function partQuotes(quotes: readonly Quote[]) {
  const replaces = quotes.filter(isReplace);
  return {
    upgrade: quotes.find(isUpgrade),
    /** Keep capacity by default; base-level and later-generation choices remain available. */
    replace: replaces.find(q => !q.locked && q.action.type === 'replacePart' && q.action.preserveCapacity) ?? replaces.find(q => !q.locked) ?? replaces[0],
    replaces,
    remove: quotes.find((q) => q.action.type === 'removePart'),
  };
}

/** The selected component keeps its own upgrade button, including a disabled limit state. */
export function partMain(quotes: readonly Quote[], _level: number, _eccPriority = false): Option | null {
  const { upgrade, replace, replaces } = partQuotes(quotes);
  const ended = upgrade?.locked?.code === 'ceiling' || upgrade?.locked?.code === 'cap';
  const q = ended ? nextGeneration(replaces) : upgrade ?? replace;
  return q ? { name: q.label, verb: q.label.startsWith('Install ') ? 'Install' : q === upgrade ? 'Upgrade' : 'Replace', quote: q } : null;
}

/** The level upgrade, or null once the ladder has ended (the next generation is then the only purchase). */
export function partLevel(quotes: readonly Quote[], level: number): Option | null {
  const main = partMain(quotes, level);
  return main && !isReplace(main.quote) ? main : null;
}

type KeyProps = Pick<PlateCommon, 'quotes' | 'onAction' | 'onResearch' | 'researchName'> & { level: number };

/** The level upgrade key, pinned in the plate footer above the bottom action row. */
export function PartKeys({ quotes, level, onAction, onResearch, researchName }: KeyProps) {
  const main = partLevel(quotes?.quotes ?? [], level);
  return main && <OptionRow option={main} primary onAction={q => onAction(q.action)} onResearch={onResearch} researchName={researchName} />;
}

/**
 * The next generation for PlateFrame's bottom row (`generation`), or null when the part has none. An ended ladder
 * leaves it as the component's only purchase, in the primary tone.
 */
export function generationKey({ quotes, level, onAction, onResearch, researchName }: KeyProps): ReactNode {
  const all = quotes?.quotes ?? [], main = partMain(all, level);
  if (!main) return null;
  const ended = isReplace(main.quote), quote = ended ? main.quote : nextGeneration(partQuotes(all).replaces);
  return quote ? <GenerationAction quote={quote} primary={ended} onAction={q => onAction(q.action)} onResearch={onResearch} researchName={researchName} /> : null;
}
