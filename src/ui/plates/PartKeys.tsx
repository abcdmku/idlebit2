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
  const { upgrade, replace } = partQuotes(quotes);
  const q = upgrade ?? replace;
  return q ? { name: q.label, verb: q === upgrade ? 'Upgrade' : 'Replace', quote: q } : null;
}
export function PartKeys({ quotes, level, onAction, onResearch, researchName, part = 'all' }:
  Pick<PlateCommon, 'quotes' | 'onAction' | 'onResearch' | 'researchName'> & { level: number; unblocks?: number; eccPriority?: boolean; part?: 'all' | 'primary' | 'rest' }) {
  const all = quotes?.quotes ?? [], main = partMain(all, level);
  const fire = (q: Quote) => onAction(q.action);
  const rows = { onAction: fire, onResearch, researchName };
  const primary = main && (isReplace(main.quote) ? <GenerationAction quote={main.quote} {...rows} /> : <OptionRow option={main} primary {...rows} />);
  const rest = <GenerationAction quote={nextGeneration(partQuotes(all).replaces.filter(q => q !== main?.quote))} {...rows} />;
  return part === 'primary' ? primary : part === 'rest' ? rest : <>{rest}{primary}</>;
}
