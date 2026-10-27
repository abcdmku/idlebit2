import { useMemo } from 'react';
import { POOL_DOMAIN, selectResearchTree, type GpuGeneration, type GpuStats, type PartView, type Quote, type ResearchId, type ResearchNodeView, type SystemId, type TaskView } from '../../game';
import { useGameSelector, useQuote, useShell } from '../storeHooks';
import { projectKey } from '../research/model';
import { familyName } from '../hooks/feedModel';
import { bits, ops, quantity, watts } from './format';
import { PlateFrame } from './PlateFrame';
import type { PlateCommon } from './types';
import { GPU_CLASSES, GPU_GENERATIONS, GPU_TIERS, gpuResearch, SERIES_NAMES } from './gpuModel';
import { changeNote, Key, OverSupplyNote, Price, QuoteKey } from './widgets';
import { LockIcon } from './icons';
import { OptionRow, perGeneration, routine, type Option } from './OptionRow';
import { partQuotes } from './PartKeys';
import { GpuCard } from './GpuCard';
import '../styles/gpu.css';

interface GpuPlateProps extends Omit<PlateCommon, 'quotes'> {
  system: SystemId;
  index: number | null;
  installed?: PartView;
  tasks?: readonly TaskView[];
}

/** Gen 1 has no project of its own (D39: it needs System); every later generation needs its research. */
function researched(nodes: readonly ResearchNodeView[], g: GpuGeneration): boolean {
  const node = gpuResearch(nodes, g);
  return node ? node.state === 'done' : g === 1;
}

/**
 * GPU tier ruling (upgrade experience decision, 26 Oct): a card is its generation, type and tier. The plate leads
 * with that state and the card's live duty. Its two buys are pinned in the footer, always in view: the next tier
 * (hot) and a later generation at the same type and tier (cold, the difference in value), or that generation's
 * research. The body says what each changes, then offers another type at the same tier (cold, any rise in value)
 * and Remove. An empty bay offers one card per type at the newest researched generation the wallet can buy.
 * Every figure, price and lock is the sim's quote.
 */
export function GpuPlate({ system, index, installed, tasks = [], onAction, onResearch, ...frame }: GpuPlateProps) {
  const shell = useShell();
  // Wallet and research changes re-quote the keys below (each quote hook keys on them too).
  const walletKey = useGameSelector(s => `${s.epoch}|${s.hud.credits}|${s.hud.data}|${s.research.active}|${s.research.queued}`, Object.is, 500);
  const state = shell.store.getState(), tree = selectResearchTree(state);
  const open = GPU_GENERATIONS.filter(g => researched(tree.nodes, g));
  const card = installed?.kind === 'gpu' ? installed.gpu ?? null : null;
  const slot = index === null ? null : { unit: { kind: 'system' as const, id: system }, slot: { kind: 'gpu' as const, index } };
  const part = useQuote(slot && { kind: 'part', part: slot });
  // The furthest researched generation above the card; none researched yet: its next generation's project.
  const later = card ? open.filter(g => g > card.generation).at(-1) ?? null : null;
  const genQuote = useQuote(card && later !== null ? { kind: 'gpuModels', system, index, generation: later } : null)?.quotes[0];
  const nextNode = card && later === null && card.generation < 9 ? gpuResearch(tree.nodes, (card.generation + 1) as GpuGeneration) : undefined;
  const typeQuotes = useQuote(card ? { kind: 'gpuModels', system, index, generation: card.generation } : null)?.quotes ?? [];
  // An empty bay: the newest researched generation with a card the wallet covers (a later generation keeps tier and
  // type and costs only the difference, so an older card is never wasted); the newest when none is affordable.
  const openKey = open.join(',');
  const entry = useMemo(() => {
    if (card) return [];
    const byGen = open.map(generation => shell.quote({ kind: 'gpuModels', system, index, generation }).quotes);
    const at = byGen.map((qs, i) => (qs.some(q => !q.locked && q.affordable) ? i : -1)).filter(i => i >= 0).at(-1) ?? byGen.length - 1;
    return byGen[at] ?? [];
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the wallet, research and slot are the inputs
  }, [shell, card?.model, system, index, walletKey, openKey]);
  const focus = shell.store.getSnapshot().focus, bays = focus.level === 'system' ? focus.gpu.length : 0;
  const npus = useQuote(index === null ? { kind: 'part', part: { unit: { kind: 'system', id: system }, slot: { kind: 'gpu', index: bays } } } : null);
  const act = (q: Quote) => onAction(q.action);
  const step = { onAction: act, onResearch, researchName: frame.researchName };

  const tier = part?.quotes.find(q => q.action.type === 'upgradePart');
  const top = tier?.locked?.code === 'ceiling';
  const remove = part?.quotes.find(q => q.action.type === 'removePart');
  const title = card ? `GPU ${card.model}` : installed?.kind === 'npu' ? `NPU ${index! + 1}` : npus?.quotes.some(q => q.action.type === 'addPart') ? 'GPU or NPU' : 'Buy GPU';
  const footer = card ? <div className="gpu-keys">
    {tier && !top ? <StepKey quote={tier} label={`Tier ${tier.gpu?.after.tier ?? ''}`} verb="Upgrade to" onAction={act} onResearch={onResearch} />
      : <Key label="Tier 90" disabled ariaLabel="Tier 90 is the top tier" onPress={() => undefined} />}
    {genQuote ? <StepKey quote={genQuote} label={`Gen ${genQuote.gpu?.after.generation ?? ''}`} verb="Replace with" onAction={act} onResearch={onResearch} />
      : nextNode ? <ResearchKey node={nextNode} tree={tree} onAction={onAction} onResearch={onResearch} />
        : <Key label="Gen 9" disabled ariaLabel="Generation 9 is the newest" onPress={() => undefined} />}
  </div> : undefined;
  return <PlateFrame {...frame} title={title} sub={index === null ? undefined : `Slot ${index + 1}`} className="gpu-picker" closeKey pinTop footer={footer}>
    {card && installed && <CardState card={card} part={installed} />}
    {card && tier && <GpuStep {...step} quote={tier} before={card} keyless
      title={top ? 'Tier 90 reached' : `Tier ${tier.gpu?.after.tier ?? ''}`}
      note={''} />}
    {card && genQuote && <GpuStep {...step} quote={genQuote} before={card} keyless
      title={`Gen ${genQuote.gpu?.after.generation ?? ''} · ${genQuote.gpu?.after.model ?? ''}`}
      note={`${changeNote(genQuote)} · keeps tier ${card.tier}`} />}
    {card && nextNode && <ResearchReason node={nextNode} tree={tree} />}
    {card && typeQuotes.length > 0 && <TypeKeys quotes={typeQuotes} onAction={act} onResearch={onResearch} />}
    {!card && entry.map(q => <GpuStep key={q.label} {...step} quote={q} verb="Buy" before={null}
      title={`${q.gpu?.after.model ?? q.label} · ${q.gpu ? SERIES_NAMES[q.gpu.after.series] : ''}`}
      note={q.gpu ? `Tier 30 · Gen ${q.gpu.after.generation}` : ''} />)}
    {index === null && <NpuKeys quotes={npus?.quotes.filter(q => q.action.type === 'addPart') ?? []} onAction={act} onResearch={onResearch} title="Or an NPU · tensor work only" />}
    {installed?.kind === 'npu' && <NpuOwn quotes={part?.quotes ?? []} generation={installed.generation} onAction={act} onResearch={onResearch} />}
    {card && remove && <div className="gpu-remove"><Key label="Remove card" tone="replace" ariaLabel={`Remove GPU ${card.model}`} disabled={!!remove.locked} onPress={() => act(remove)} /></div>}
    <AssignedWork tasks={tasks} index={index} />
  </PlateFrame>;
}

/** A pinned step: one fixed-size key with its price; why it cannot be bought is said in the body. */
function StepKey({ quote: q, label, verb, onAction, onResearch }: { quote: Quote; label: string; verb: string; onAction: (q: Quote) => void; onResearch?: (id: ResearchId) => void }) {
  const research = q.locked?.code === 'research' ? q.locked.node : null;
  if (research) return <Key tone="locked-action" label={<><LockIcon />{label}</>} ariaLabel={`${label}: research needed`} onPress={() => onResearch?.(research)} />;
  return <Key label={label} price={q.locked ? null : { cost: q.cost, currency: q.currency }} disabled={!!q.locked || !q.affordable}
    ariaLabel={`${verb} ${label}, ${q.cost} Credits`} onPress={() => onAction(q)} />;
}

/** No later generation researched: its project, one tap from the card, with both its costs. */
function ResearchKey({ node, tree, onAction, onResearch }: { node: ResearchNodeView; tree: ReturnType<typeof selectResearchTree>;
  onAction: PlateCommon['onAction']; onResearch?: (id: ResearchId) => void }) {
  const shell = useShell(), hud = shell.store.getSnapshot().hud;
  const key = projectKey(node, tree, hud.credits, hud.data);
  return <button type="button" className="key locked-action" disabled={!key.action && !node.lockedBy} aria-label={`${key.label} ${node.name}`}
    onClick={() => { if (key.action) onAction(key.action); else if (node.lockedBy) onResearch?.(node.id); }}>
    <span className="kl">{key.action?.type === 'cancelResearch' ? 'Pause' : 'Research'} Gen {node.id.replace('gpuGen', '')}</span>
  </button>;
}

function ResearchReason({ node, tree }: { node: ResearchNodeView; tree: ReturnType<typeof selectResearchTree> }) {
  const shell = useShell(), hud = shell.store.getSnapshot().hud;
  const key = projectKey(node, tree, hud.credits, hud.data);
  return <section className="gpu-step">
    <p className="gpu-step-title">Gen {node.id.replace('gpuGen', '')} research</p>
    <div className="gpu-research-price"><Price cost={node.dataCost} currency="data" />{node.creditCost && <Price cost={node.creditCost} />}</div>
    {!key.action && !node.lockedBy && <p className="need">{key.label}</p>}
  </section>;
}

/** Another type at the same generation and tier: a cold swap that costs any rise in value, else nothing. */
function TypeKeys({ quotes, onAction, onResearch }: { quotes: readonly Quote[]; onAction: (q: Quote) => void; onResearch?: (id: ResearchId) => void }) {
  return <section className="gpu-step gpu-types"><p className="gpu-step-title"><b>Change type</b></p>
    <p className="gpu-note">Keeps generation and tier · {quotes[0] ? changeNote(quotes[0]) : 'Cold swap'}</p>
    <div className="gpu-type-keys">{quotes.map(q => {
      const after = q.gpu?.after, name = after ? `${SERIES_NAMES[after.series]} · ${after.model}` : q.label;
      const free = BigInt(q.cost) === 0n;
      return q.locked?.code === 'research' ? <QuoteKey key={q.label} quote={q} label={name} onAction={onAction} onResearch={onResearch} showSupplyNote={false} />
        : <Key key={q.label} label={name} price={free || q.locked ? null : { cost: q.cost, currency: q.currency }}
          disabled={!!q.locked || !q.affordable} ariaLabel={`Change to ${name}, ${q.cost} Credits`} onPress={() => onAction(q)} />;
    })}</div>
  </section>;
}

/** The card as it is: art, model, type, generation, its tier on the 30–90 ladder, and its duty right now. */
function CardState({ card, part }: { card: GpuStats; part: PartView }) {
  const busy = Math.round(Math.max(0, Math.min(1, part.resourceBusy)) * 100);
  return <section className="gpu-state" aria-label={`GPU ${card.model}, ${SERIES_NAMES[card.series]}, generation ${card.generation}, tier ${card.tier} of 90`}>
    <div className="gpu-model"><GpuCard tier={card.tierIndex} busy={part.resourceBusy} />
      <div><b>{SERIES_NAMES[card.series]}</b><span>Gen {card.generation} · {GPU_CLASSES[card.generation - 1]}</span></div></div>
    <ol className="gpu-ladder" aria-hidden="true">{GPU_TIERS.map((t, i) =>
      <li key={t} className={i < card.tierIndex ? 'done' : i === card.tierIndex ? 'now' : ''}>{t}</li>)}</ol>
    <p className="gpu-live">{card.cores.toLocaleString('en-US')} cores · {ops(card.opsPerS)}/s · busy {busy}%</p>
    <p className="gpu-live">VRAM {bits(part.vramUsedBits ?? 0)} of {bits(card.vramBits)}</p>
  </section>;
}

/** The three specs that decide task fit and speed, before → after. */
const SPECS: readonly (readonly [string, (s: GpuStats) => string, (s: GpuStats) => number])[] = [
  ['Cores', s => s.cores.toLocaleString('en-US'), s => s.cores], ['VRAM', s => bits(s.vramBits), s => s.vramBits],
  ['Work', s => `${ops(s.opsPerS)}/s`, s => s.opsPerS],
];

/** One change: what it is, its specs against the card it changes, what it costs in time, then its key (unless pinned). */
function GpuStep({ quote: q, title, note, verb = '', before: slot, keyless = false, onAction, onResearch, researchName }: {
  quote: Quote; title: string; note: string; verb?: string; before: GpuStats | null; keyless?: boolean;
  onAction: (q: Quote) => void; onResearch?: (id: ResearchId) => void; researchName?: (id: ResearchId) => string;
}) {
  // The quote's own before and after, both at the view's power scale.
  const after = q.locked?.code === 'ceiling' ? null : q.gpu?.after ?? null, before = slot && (q.gpu?.before ?? slot);
  const why = q.locked && q.locked.code !== 'research' && q.locked.code !== 'ceiling' ? q.locked.text : !q.locked && !q.affordable ? 'Needs more Credits' : '';
  return <section className="gpu-step">
    <p className="gpu-step-title"><b>{title}</b></p>
    {after && <ul className="gpu-delta">{SPECS.map(([label, value, num]) => {
      const up = before ? num(after) > num(before) : false;
      return <li key={label} className={up ? 'up' : ''}><span>{label}</span><b>{before ? `${value(before)} → ` : ''}{value(after)}{up ? ' ↑' : ''}</b></li>;
    })}</ul>}
    {after && <p className="gpu-note">{note && <>{note} · </>}Card load {watts(after.idleW + after.loadW)} · {quantity(after.efficiencyOpsPerJ, 'ops/J')}</p>}
    {!after && note && <p className="gpu-note">{note}</p>}
    {q.locked?.code !== 'ceiling' && <>
      <OverSupplyNote quote={q} onAction={onAction} scope={title} />
      {keyless ? why && <p className="need gpu-why">{why}</p>
        : <QuoteKey quote={q} label={verb} showSupplyNote={false} onAction={onAction} onResearch={onResearch} researchName={researchName}
          ariaLabel={`${verb} ${title}, ${q.cost} Credits`} />}
    </>}
  </section>;
}

function NpuKeys({ quotes, title, onAction, onResearch }: { quotes: readonly Quote[]; title: string; onAction: (q: Quote) => void; onResearch?: (id: ResearchId) => void }) {
  const options: Option[] = routine(quotes.map(x => ({ name: x.label ?? 'NPU', verb: 'Add', quote: x })));
  if (!options.length) return null;
  return <section className="gpu-npu"><p className="gpu-step-title"><b>{title}</b></p>
    <div className="opts">{options.map((o, i) => <OptionRow key={i} option={o} onAction={x => onAction(x)} onResearch={onResearch} />)}</div></section>;
}

/** An installed NPU keeps its own level and generation keys. A GPU in its place: remove it, then tap the bay. */
function NpuOwn({ quotes, generation, onAction, onResearch }: { quotes: readonly Quote[]; generation: number; onAction: (q: Quote) => void; onResearch?: (id: ResearchId) => void }) {
  const own = partQuotes(quotes), options: Option[] = [
    ...(own.upgrade ? [{ name: own.upgrade.label ?? 'Next level', verb: 'Upgrade', quote: own.upgrade }] : []),
    ...routine(perGeneration(own.replaces).map(r => ({ name: r.label ?? 'Next generation', verb: 'Replace', quote: r }))),
  ];
  return <section className="gpu-npu"><p className="gpu-step-title"><b>NPU · Gen {generation + 1}</b></p>
    <div className="opts">{options.map((o, i) => <OptionRow key={i} option={o} onAction={x => onAction(x)} onResearch={onResearch} />)}</div></section>;
}

function AssignedWork({ tasks, index }: { tasks: readonly TaskView[]; index: number | null }) {
  const assigned = index === null ? [] : tasks.filter(t => t.accelDomain === index || t.accelDomain === POOL_DOMAIN);
  if (!assigned.length) return null;
  return <section className="plate-section"><p className="cfg-lab">Running here</p>
    <ul className="gpu-tasks" aria-label="Assigned GPU work">{assigned.map(t => <li key={t.key}>
      <span><span className="gpu-task-family">{familyName(t.family)}</span> · {t.gpuCoresMin} {t.gpuCoresMin === 1 ? 'core' : 'cores'} · {bits(t.vramBits)} VRAM{t.accelDomain === POOL_DOMAIN ? ' · linked pool' : ''}</span>
    </li>)}</ul></section>;
}
