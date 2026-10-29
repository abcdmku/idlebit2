import { useState } from 'react';
import type { PartView, Quote } from '../../game';
import type { BoardPartView } from './BoardPartPlate';
import type { PartFacts } from './partFacts';
import type { PlateCommon } from './types';
import { bits, bitRate } from './format';
import { partQuotes } from './PartKeys';
import { GenerationAction, nextGeneration } from './GenerationAction';
import { QuoteKey } from './widgets';
import { ChoiceStrip } from './ChoiceStrip';

type Actions = Pick<PlateCommon, 'onAction' | 'onResearch' | 'researchName'>;

function MemoryAction({ quote: q, label, add: _add = false, primary = false, ...actions }: Actions & {
  quote: Quote; label: string; add?: boolean; primary?: boolean;
}) {
  const buy = (value: Quote) => actions.onAction(value.action);
  return <div className={`memory-action${primary ? ' main' : ''}`}>
    <QuoteKey quote={q} label={label} tone={primary ? '' : 'replace'} showSupplyNote={false}
      onAction={buy} onResearch={actions.onResearch} researchName={actions.researchName} />
  </div>;
}

/** One module's current facts, capacity upgrade and next generation. */
export function memoryPartView({ module: part, slot, facts, own, ...actions }: Actions & {
  module: PartView; slot: 'ram' | 'drive'; facts: PartFacts; own: readonly Quote[];
}): BoardPartView {
  const { replaces } = partQuotes(own);
  const capacityUpgrade = own.find(q => q.action.type === 'upgradePart' && q.action.axis !== 'speed');
  const speedUpgrade = own.find(q => q.action.type === 'upgradePart' && q.action.axis === 'speed');
  const buy = (q: Quote) => actions.onAction(q.action);
  const capacity = part.capacityBits ?? 0, used = part.usedBits ?? 0;
  const name = slot === 'ram' ? 'RAM' : 'Drive';
  return {
    title: facts.title, sub: facts.sub, head: null,
    footer: <div className="memory-upgrades">
      {capacityUpgrade && <QuoteKey quote={capacityUpgrade} label="Space" onAction={buy} onResearch={actions.onResearch} researchName={actions.researchName} />}
      {speedUpgrade && <QuoteKey quote={speedUpgrade} label="Speed" onAction={buy} onResearch={actions.onResearch} researchName={actions.researchName} />}
    </div>,
    body: <div className="memory-part">
      <div className="memory-current"><b>{bits(used)} / {bits(capacity)} used</b></div>
      <div className="memory-meter" role="meter" aria-label={`${name} used`} aria-valuemin={0} aria-valuemax={capacity} aria-valuenow={used}>
        <i style={{ width: `${Math.min(100, used / Math.max(1, capacity) * 100)}%` }} />
      </div>
      <p className="memory-speed">Speed {bitRate(part.rateBits ?? 0)}</p>
      <GenerationAction quote={nextGeneration(replaces)} onAction={q => actions.onAction(q.action)} onResearch={actions.onResearch} researchName={actions.researchName} />
    </div>,
  };
}

/** An empty memory slot uses a type picker and one purchase key. */
export function MemoryAdd({ quotes, preferred, ...actions }: Actions & { quotes: readonly Quote[]; preferred?: Quote }) {
  const [choice, setChoice] = useState(0);
  const ordered = preferred ? [preferred, ...quotes.filter(q => q !== preferred)] : quotes;
  const q = ordered[choice] ?? ordered[0];
  if (!q) return null;
  return <div className="memory-add">
    <ChoiceStrip label="Memory type" value={String(choice)} onPick={value => setChoice(Number(value))}
      choices={ordered.map((q, i) => ({ id: String(i), label: q.label }))} />
    <MemoryAction quote={q} label="Add" add primary {...actions} />
  </div>;
}
