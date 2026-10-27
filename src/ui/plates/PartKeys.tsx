import type { EffectPreview, GameAction, Quote } from '../../game';
import { measureUnit, watts } from './format';
import { eccToDo, OptionList, OptionRow, improves, perGeneration, routine, sameGeneration, type Option } from './OptionRow';
import type { PlateCommon } from './types';

const amountOf = (n: number, unit: EffectPreview['unit']) => measureUnit(n, unit);

/** "8 kops/s → 16 kops/s · +3 W". At most 3 significant figures. */
export function effectText(e: EffectPreview | null): string {
  if (!e) return '';
  // A power supply change says what it saves: its loss, and the input watts that saves at this draw.
  if (e.lossPctBefore !== undefined && e.lossPctAfter !== undefined) {
    const saves = e.wattsBefore - e.wattsAfter;
    return `${amountOf(e.capacityBefore, e.unit)} → ${amountOf(e.capacityAfter, e.unit)} · loss ${Math.round(e.lossPctBefore)}% → ${Math.round(e.lossPctAfter)}%${saves > 1e-12 ? ` · saves ~${watts(saves)}` : ''}`;
  }
  const dw = e.wattsAfter - e.wattsBefore;
  const w = Math.abs(dw) < 1e-9 ? '' : ` · ${dw > 0 ? '+' : '−'}${watts(Math.abs(dw))}`;
  return `${amountOf(e.capacityBefore, e.unit)} → ${amountOf(e.capacityAfter, e.unit)}${w}`;
}

const isUpgrade = (q: Quote) => q.action.type === 'upgradePart' || q.action.type === 'upgradeAll';
const isReplace = (q: Quote) => q.action.type === 'replacePart' || q.action.type === 'replaceCpu';

/** A task fix can quote upgradePartTo for the same purchase as a normal upgrade key. */
export function samePurchase(a: Quote | null | undefined, b: Quote | null | undefined): boolean {
  if (!a || !b || a.cost !== b.cost || a.currency !== b.currency) return false;
  if (JSON.stringify(a.action) === JSON.stringify(b.action)) return true;
  const target = (q: Quote): string | null => {
    const action = q.action;
    if (action.type !== 'upgradePart' && action.type !== 'upgradePartTo') return null;
    const { unit, slot } = action.part;
    return `${unit.kind}:${'id' in unit ? unit.id : ''}:${slot.kind}:${'socket' in slot ? slot.socket : ''}:${'index' in slot ? slot.index : ''}`;
  };
  const left = target(a), right = target(b);
  return left !== null && left === right;
}

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

const levelOf = (a: GameAction) => (a.type === 'replacePart' ? a.generation : null);

/** What a quote's part is, for its effect lines ("RAM 50.3 Mb → 51.4 Mb"). */
function partNoun(q: Quote): string | null {
  const a = q.action;
  const kind = a.type === 'addPart' ? a.kind : a.type === 'upgradePart' || a.type === 'replacePart' ? a.part.slot.kind : a.type === 'replaceCpu' ? 'cpu' : null;
  switch (kind) {
    case 'ram': return 'RAM';
    case 'drive': return 'Drive';
    case 'l1': case 'l2': case 'l3': return 'Cache';

    case 'clock': case 'cpu': return 'Clock';
    case 'socket': case 'core': return 'Work';
    case 'gpu': case 'npu': return 'Work';
    default: return null;
  }
}
const UNIT_NOUN: Partial<Record<EffectPreview['unit'], string>> = { 'ops/s': 'Work', Hz: 'Speed', bits: 'Capacity', W: 'Capacity', 'tasks/s': 'Rate', J: 'Battery' };

/** One before → after line, marked ↑ better or ↓ worse (warm) so a downgrade never reads as a gain. */
function Change({ label, before, after, unit, fmt, lowerIsBetter = false }: { label: string; before: number; after: number; unit?: EffectPreview['unit']; fmt?: (n: number) => string; lowerIsBetter?: boolean }) {
  const show = fmt ?? ((n: number) => amountOf(n, unit ?? 'ops'));
  // A change too small to show at this precision reads "same", never an arrow over two equal numbers (R16).
  const sb = show(before), sa = show(after), d = (after - before) * (lowerIsBetter ? -1 : 1);
  if (sb === sa) return <span className="fx">{label} {sa} · same</span>;
  const trend = d > 0 ? 'up' : d < 0 ? 'down' : '';
  return <span className={`fx ${trend}`}>{label} {sb} → {sa}{trend && <b className="trend" aria-label={trend === 'up' ? ' better' : ' worse'}>{trend === 'up' ? ' ↑' : ' ↓'}</b>}</span>;
}

/**
 * A quote's consequence in one format everywhere: what the part (or the system, for an Add) holds or does before →
 * after with ↑/↓, its bandwidth or IO, research, the power it adds, then warnings that say what will happen.
 */
export function EffectDetail({ quote: q, brief = false }: { quote: Quote; brief?: boolean }) {
  const e = q.effect;
  if (!e) return null;
  const a = q.action, noun = partNoun(q) ?? UNIT_NOUN[e.unit] ?? '';
  const drive = (a.type === 'upgradePart' || a.type === 'replacePart') && a.part.slot.kind === 'drive' || a.type === 'addPart' && a.kind === 'drive';
  const lossOnly = e.lossPctBefore !== undefined && e.lossPctAfter !== undefined;
  const dw = e.wattsAfter - e.wattsBefore;
  const warnings = <>
    {e.marginalLoss && e.unit !== 'W' && <><br /><span className="option-warning">Energy costs more than the extra income</span></>}
    {e.researchCooling && <><br /><span className="option-warning">Research heat {watts(e.researchCooling.heatW)} &gt; rack cooling {watts(e.researchCooling.capacityW)}: may overheat</span></>}
  </>;
  // Brief (an alternate's one-line key): the headline change, and its warnings, which are never dropped.
  if (brief) return <><Change label={noun} before={e.capacityBefore} after={e.capacityAfter} unit={e.unit} />
    {e.throughputBefore !== undefined && e.throughputAfter !== undefined && e.throughputAfter < e.throughputBefore
      && <> · <Change label={drive ? 'IO' : 'Bandwidth'} before={e.throughputBefore} after={e.throughputAfter} unit="bit/s" /></>}{warnings}</>;
  return <>
    <Change label={noun} before={e.capacityBefore} after={e.capacityAfter} unit={e.unit} />
    {e.throughputBefore !== undefined && e.throughputAfter !== undefined
      && <><br /><Change label={drive ? 'IO' : 'Bandwidth'} before={e.throughputBefore} after={e.throughputAfter} unit="bit/s" /></>}
{/* Research and the power it costs share a line, so the main option stays short enough to sit beside its part. */}
    {e.researchOpsBefore !== undefined && e.researchOpsAfter !== undefined
      && <><br /><Change label="Research" before={e.researchOpsBefore} after={e.researchOpsAfter} unit="ops/s" />{!lossOnly && Math.abs(dw) >= 1e-9 && <span className="fx"> · Power {dw > 0 ? '+' : '−'}{watts(Math.abs(dw))}</span>}</>}
    {lossOnly ? <><br /><Change label="Loss" before={e.lossPctBefore!} after={e.lossPctAfter!} fmt={n => `${Math.round(n)}%`} lowerIsBetter />{e.wattsBefore - e.wattsAfter > 1e-12 && <> · saves ~{watts(e.wattsBefore - e.wattsAfter)}</>}</>
      : e.researchOpsBefore === undefined && Math.abs(dw) >= 1e-9 && <><br /><span className="fx">Power {dw > 0 ? '+' : '−'}{watts(Math.abs(dw))}</span></>}
    {warnings}
  </>;
}

const replaceLabel = (q: Quote) => `Replace · ${q.label?.replace(/^Replace CPU · /, '') || `Gen ${levelOf(q.action) ?? ''}`}`;

/** The main options a part plate weighs, in order: ECC first when the line waits on it, its upgrade, its replace. */
function partLeads(quotes: readonly Quote[], level: number, eccPriority: boolean, ecc = quotes.find(eccToDo)): Option[] {
  const { upgrade, replace } = partQuotes(quotes);
  return [
    ...(ecc && eccPriority ? [{ name: 'on all RAM', verb: 'Enable ECC', quote: ecc }] : []),
    ...(upgrade ? [{ name: `Level ${level + 1}`, verb: 'Upgrade', quote: upgrade }] : []),
    ...(replace ? [{ name: replaceLabel(replace).replace(/^Replace · /, ''), verb: 'Replace', quote: replace }] : []),
  ];
}
/** The part plate's pinned main option: the first lead that improves without a loss, or none. */
export function partMain(quotes: readonly Quote[], level: number, eccPriority = false, ecc = quotes.find(eccToDo)): Option | null {
  return partLeads(quotes, level, eccPriority, ecc).find(o => improves(o.quote)) ?? null;
}

/**
 * A part's options as direct priced keys (R16: one tap opens the part, the second buys; nothing behind a More). The
 * main option, pinned with its full consequence, is the first that improves without a loss (upgrade, else replace,
 * ECC first when the line waits on it); a dead Max or a known regression is never pinned. The others (its upgrade or
 * replace, other generations, ECC, an over-supply "… anyway") are one-line keys with their losses and warnings shown.
 */
export function PartKeys({ quotes, level, onAction, onResearch, researchName, unblocks = 0, eccPriority = false, part = 'all' }:
  Pick<PlateCommon, 'quotes' | 'onAction' | 'onResearch' | 'researchName'> & { level: number; unblocks?: number; eccPriority?: boolean;
    /** 'primary': the plate's one main option with its consequence (pinned in the footer); 'rest': everything else. */
    part?: 'all' | 'primary' | 'rest' }) {
  const { upgrade, replace, replaces } = partQuotes(quotes?.quotes ?? []);
  const ecc = quotes?.quotes.find(eccToDo);
  const fire = (q: Quote) => onAction(q.action);
  const name = (q: Quote) => replaceLabel(q).replace(/^Replace · /, '');
  const leads = partLeads(quotes?.quotes ?? [], level, eccPriority, ecc);
  const main = partMain(quotes?.quotes ?? [], level, eccPriority, ecc);
  // One key per generation (the lead's generation is the lead) and one Research key per plate (routine).
  const others: Option[] = routine([
    ...leads.filter(o => o.quote !== main?.quote && !(o.quote === upgrade && upgrade.locked?.code === 'ceiling')),
    ...perGeneration(replaces).filter(q => !sameGeneration(q, replace)).map(q => ({ name: name(q), verb: 'Replace', quote: q })),
    ...(ecc && !eccPriority ? [{ name: 'on all RAM', verb: 'Enable ECC', quote: ecc }] : []),
  ]);
  const row = { onAction: fire, onResearch, researchName, className: 'part-option' };
  // At its ceiling an upgrade is said once, plainly, not offered as a dead key.
  const max = upgrade?.locked?.code === 'ceiling' ? <p className="p-hint">Max level</p> : null;
  const primaryKeys = main && <div className="part-keys"><OptionRow option={main} primary {...row} /></div>;
  // Each alternate over a supply carries its own warning and preparation (OptionList), after the safe ones.
  const restKeys = <>
    {max}
    <OptionList options={others} className="part-keys" rowClassName="part-option" onAction={fire} onResearch={onResearch} researchName={researchName} />
    {unblocks > 0 && <p className="p-hint payback">Needed by {unblocks} queued {unblocks === 1 ? 'task' : 'tasks'}</p>}
  </>;
  if (part === 'primary') return primaryKeys || null;
  if (part === 'rest') return restKeys;
  return <>{primaryKeys}{restKeys}</>;
}
