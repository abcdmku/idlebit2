import { useState } from 'react';
import type { PartView, Quote } from '../../game';
import type { BoardPartView } from './BoardPartPlate';
import type { PartFacts } from './partFacts';
import type { PlateCommon } from './types';
import { bits, bitRate } from './format';
import { partQuotes } from './PartKeys';
import { eccToDo } from './OptionRow';
import { OverSupplyNote, QuoteKey } from './widgets';

type Actions = Pick<PlateCommon, 'onAction' | 'onResearch' | 'researchName'>;

function MemoryAction({ quote: q, label, add = false, primary = false, ...actions }: Actions & {
  quote: Quote; label: string; add?: boolean; primary?: boolean;
}) {
  const e = q.effect, cold = q.cold && q.downtimeMs > 0;
  const capacity = e && (add ? `+${bits(e.capacityAfter - e.capacityBefore)}` : bits(e.capacityAfter));
  const rate = e?.throughputAfter;
  const slower = rate !== undefined && e?.throughputBefore !== undefined && rate < e.throughputBefore;
  const buy = (value: Quote) => actions.onAction(value.action);
  return <div className={`memory-action${primary ? ' main' : ''}`}>
    {e && <p className={slower ? 'memory-change warn' : 'memory-change'}>{capacity}
      {rate !== undefined && (!add || rate !== e?.throughputBefore) && <> · {bitRate(rate)}{slower ? ' ↓' : ''}</>}
    </p>}
    {cold && <p className="memory-cold">Offline {Math.ceil(q.downtimeMs / 1000)}s · running work lost</p>}
    <OverSupplyNote quote={q} onAction={buy} />
    <QuoteKey quote={q} label={label} tone={primary ? '' : 'replace'} showSupplyNote={false}
      onAction={buy} onResearch={actions.onResearch} researchName={actions.researchName} />
  </div>;
}

/** One module's facts and three distinct purchases, without a list of every generation. */
export function memoryPartView({ module: part, slot, facts, own, add, eccFirst, ...actions }: Actions & {
  module: PartView; slot: 'ram' | 'drive'; facts: PartFacts; own: readonly Quote[]; add?: Quote; eccFirst: boolean;
}): BoardPartView {
  const { upgrade, replace } = partQuotes(own), ecc = own.find(eccToDo);
  const main = eccFirst && ecc ? ecc : upgrade?.locked?.code !== 'ceiling' ? upgrade : undefined;
  const capacity = part.capacityBits ?? 0, used = part.usedBits ?? 0;
  const name = slot === 'ram' ? 'RAM' : 'Drive';
  return {
    title: facts.title, sub: `${facts.sub} · L${facts.level}`, head: null,
    footer: main && <MemoryAction quote={main} label={main === ecc ? 'Enable ECC' : 'Upgrade'} primary {...actions} />,
    body: <div className="memory-part">
      <div className="memory-current"><b>Size {bits(capacity)}</b><span>{bits(used)} used</span></div>
      <div className="memory-meter" role="meter" aria-label={`${name} used`} aria-valuemin={0} aria-valuemax={capacity} aria-valuenow={used}>
        <i style={{ width: `${Math.min(100, used / Math.max(1, capacity) * 100)}%` }} />
      </div>
      <p className="memory-speed">{slot === 'ram' ? 'Bandwidth' : 'IO'} {bitRate(part.rateBits ?? 0)}</p>
      {add && <MemoryAction quote={add} label={`Add ${slot === 'ram' ? 'RAM' : 'drive'}`} add {...actions} />}
      {(replace || ecc && main !== ecc) && <details className="memory-extra"><summary>Change type</summary>
        {replace && <MemoryAction quote={replace} label={`Replace with ${replace.label ?? 'next type'}`} {...actions} />}
        {ecc && main !== ecc && <MemoryAction quote={ecc} label="Enable ECC" {...actions} />}
      </details>}
      {!main && <p className="p-hint">Max level</p>}
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
    <label>Type<select aria-label="Memory type" value={choice} onChange={e => setChoice(Number(e.target.value))}>
      {ordered.map((q, i) => <option key={i} value={i}>{q.label}</option>)}
    </select></label>
    <MemoryAction quote={q} label="Add" add primary {...actions} />
  </div>;
}
