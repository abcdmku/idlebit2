import type { ReactNode } from 'react';
import { wakeLatencyS } from '../../game';
import { purchaseGain } from './purchaseText';
import { partQuotes } from './PartKeys';
import { GenerationAction, nextGeneration } from './GenerationAction';
import { QuoteKey } from './widgets';
import type { PlateCommon } from './types';
export const wakeS = wakeLatencyS;
export interface PowerKeysProps extends Pick<PlateCommon, 'quotes' | 'onAction' | 'onResearch' | 'researchName'> { installed: boolean; level: number; wake?: boolean; noun: string }

function powerQuotes(quotes: PowerKeysProps['quotes'], installed: boolean) {
  const { upgrade, replaces } = partQuotes(quotes?.quotes ?? []);
  const ended = upgrade?.locked?.code === 'ceiling' || upgrade?.locked?.code === 'cap';
  return { main: installed ? ended ? undefined : upgrade : replaces.find(q => !q.locked) ?? replaces[0], next: installed ? nextGeneration(replaces) : undefined };
}

/** The level upgrade, or the first buy of an empty slot. The next generation is in the plate's bottom row (`powerGeneration`). */
export function PowerKeys({ quotes, installed, level, wake = false, noun, onAction, onResearch, researchName }: PowerKeysProps) {
  const { main } = powerQuotes(quotes, installed);
  if (!main) return null;
  return <div className="key-stack power-keys">
    <QuoteKey quote={main} label={installed ? 'Upgrade' : 'Buy ' + noun}
      detail={installed ? [wake ? '' : purchaseGain(main), `Wake ${wakeS(level + 1)}s`].filter(Boolean).join(' · ') : undefined}
      onAction={q => onAction(q.action)} onResearch={onResearch} researchName={researchName} />
  </div>;
}

/** The next generation for PlateFrame's bottom row, or null. */
export function powerGeneration({ quotes, installed, onAction, onResearch, researchName }: Omit<PowerKeysProps, 'level' | 'wake' | 'noun'>): ReactNode {
  const { main, next } = powerQuotes(quotes, installed);
  return next ? <GenerationAction quote={next} primary={!main} onAction={q => onAction(q.action)} onResearch={onResearch} researchName={researchName} /> : null;
}
