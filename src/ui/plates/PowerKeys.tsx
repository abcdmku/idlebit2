import type { Quote } from '../../game';
import { partQuotes } from './PartKeys';
import { GenerationAction, nextGeneration } from './GenerationAction';
import { QuoteKey } from './widgets';
import type { PlateCommon } from './types';
export const wakeS = (level: number) => [2, 1.5, 1, 0.5, 0.25][Math.max(1, Math.min(5, level)) - 1]!;
export interface PowerKeysProps extends Pick<PlateCommon, 'quotes' | 'onAction' | 'onResearch' | 'researchName'> { installed: boolean; level: number; wake?: boolean; noun: string }
export function PowerKeys({ quotes, installed, level, wake = false, noun, onAction, onResearch, researchName }: PowerKeysProps) {
  const list = quotes?.quotes ?? [], { upgrade, replaces } = partQuotes(list);
  const main = installed ? upgrade : replaces.find(q => !q.locked) ?? replaces[0];
  const fire = (q: Quote) => onAction(q.action);
  const next = installed ? nextGeneration(replaces) : undefined;
  return <div className="power-keys">
    <GenerationAction quote={next} onAction={fire} onResearch={onResearch} researchName={researchName} />
    {main && <QuoteKey quote={main} label={installed ? 'Upgrade' : 'Buy ' + noun}
      detail={wake && installed ? wakeS(level) + 's → ' + wakeS(level + 1) + 's wake' : undefined}
      onAction={fire} onResearch={onResearch} researchName={researchName} />}
  </div>;
}
