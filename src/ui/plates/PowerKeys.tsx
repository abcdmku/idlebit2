import { wakeLatencyS, type Quote } from '../../game';
import { purchaseGain } from './purchaseText';
import { partQuotes } from './PartKeys';
import { GenerationAction, nextGeneration } from './GenerationAction';
import { QuoteKey } from './widgets';
import type { PlateCommon } from './types';
export const wakeS = wakeLatencyS;
export interface PowerKeysProps extends Pick<PlateCommon, 'quotes' | 'onAction' | 'onResearch' | 'researchName'> { installed: boolean; level: number; wake?: boolean; noun: string }
export function PowerKeys({ quotes, installed, level, wake = false, noun, onAction, onResearch, researchName }: PowerKeysProps) {
  const list = quotes?.quotes ?? [], { upgrade, replaces } = partQuotes(list);
  const main = installed ? upgrade : replaces.find(q => !q.locked) ?? replaces[0];
  const fire = (q: Quote) => onAction(q.action);
  const next = installed ? nextGeneration(replaces) : undefined;
  return <div className="power-keys">
    <GenerationAction quote={next} onAction={fire} onResearch={onResearch} researchName={researchName} />
    {main && <QuoteKey quote={main} label={installed ? 'Upgrade' : 'Buy ' + noun}
      detail={installed ? [wake ? '' : purchaseGain(main), `Wake ${wakeS(level + 1)}s`].filter(Boolean).join(' · ') : undefined}
      onAction={fire} onResearch={onResearch} researchName={researchName} />}
  </div>;
}
