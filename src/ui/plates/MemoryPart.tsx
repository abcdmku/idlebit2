import { useState } from 'react';
import type { PartView, Quote } from '../../game';
import type { BoardPartView } from './BoardPartPlate';
import type { PartFacts } from './partFacts';
import type { PlateCommon } from './types';
import { bits, bitRate, measureUnit } from './format';
import { partQuotes } from './PartKeys';
import { GenerationAction, nextGeneration } from './GenerationAction';
import { QuoteKey } from './widgets';
import { ChoiceStrip } from './ChoiceStrip';
import { MaintenanceAction } from './ComponentActions';

type Actions = Pick<PlateCommon, 'onAction' | 'onResearch' | 'researchName'>;

function MemoryTrack({ upgrade, downgrade, label, current, ...actions }: Actions & { upgrade?: Quote; downgrade?: Quote; label: string; current: string }) {
  const buy = (q: Quote) => actions.onAction(q.action);
  return <div className="memory-track" role="group" aria-label={label}>
    <span className="memory-track-name"><span>{label}</span><b>{current}</b></span>
    {downgrade && <MaintenanceAction quote={downgrade} label="−" icon="minus" actionLabel={`Decrease ${label.toLowerCase()}`} className="memory-down" onAction={buy} />}
    {upgrade && <QuoteKey quote={upgrade} label={upgrade.effect ? `+ ${measureUnit(upgrade.effect.capacityAfter, upgrade.effect.unit)}` : 'Upgrade'}
      ariaLabel={`Increase ${label.toLowerCase()}`} detail=""
      onAction={buy} onResearch={actions.onResearch} researchName={actions.researchName} />}
  </div>;
}

function MemoryAction({ quote: q, label, add: _add = false, primary = false, ...actions }: Actions & {
  quote: Quote; label: string; add?: boolean; primary?: boolean;
}) {
  const buy = (value: Quote) => actions.onAction(value.action);
  return <div className={`memory-action${primary ? ' main' : ''}`}>
    <QuoteKey quote={q} label={label} tone={primary ? '' : 'replace'} showSupplyNote={false}
      onAction={buy} onResearch={actions.onResearch} researchName={actions.researchName} />
  </div>;
}

/** One module's usage, independent Space and Speed controls, and next generation. */
export function memoryPartView({ module: part, slot, facts, own, ...actions }: Actions & {
  module: PartView; slot: 'ram' | 'drive'; facts: PartFacts; own: readonly Quote[];
}): BoardPartView {
  const { replaces } = partQuotes(own);
  const capacityUpgrade = own.find(q => q.action.type === 'upgradePart' && q.action.axis !== 'speed');
  const speedUpgrade = own.find(q => q.action.type === 'upgradePart' && q.action.axis === 'speed');
  const capacityDown = own.find(q => q.action.type === 'downgradePart' && q.action.axis !== 'speed');
  const speedDown = own.find(q => q.action.type === 'downgradePart' && q.action.axis === 'speed');
  const capacity = part.capacityBits ?? 0, used = part.usedBits ?? 0;
  const name = slot === 'ram' ? 'RAM' : 'Drive';
  return {
    title: facts.title, sub: facts.sub, head: null,
    footer: <div className="memory-upgrades memory-tracks">
      <MemoryTrack label="Space" current={bits(capacity)} upgrade={capacityUpgrade} downgrade={capacityDown} {...actions} />
      <MemoryTrack label="Speed" current={bitRate(part.rateBits ?? 0)} upgrade={speedUpgrade} downgrade={speedDown} {...actions} />
    </div>,
    body: <div className="memory-part">
      <div className="memory-current"><b>{bits(used)} used</b></div>
      <div className="memory-meter" role="meter" aria-label={`${name} used`} aria-valuemin={0} aria-valuemax={capacity} aria-valuenow={used}>
        <i style={{ width: `${Math.min(100, used / Math.max(1, capacity) * 100)}%` }} />
      </div>
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
