import { useMemo, useState } from 'react';
import { selectResearchTree, type GpuGeneration, type PartView, type Quote, type ResearchNodeView, type SystemId, type TaskView } from '../../game';
import { useGameSelector, useQuote, useShell } from '../storeHooks';
import { bits, ops } from './format';
import { PlateFrame } from './PlateFrame';
import type { PlateCommon } from './types';
import { GPU_GENERATIONS, gpuResearch, SERIES_NAMES } from './gpuModel';
import { Key, QuoteKey } from './widgets';
import { PartKeys } from './PartKeys';
import { GenerationAction } from './GenerationAction';
import { ChoiceStrip } from './ChoiceStrip';

interface GpuPlateProps extends Omit<PlateCommon, 'quotes'> { system: SystemId; index: number | null; installed?: PartView; tasks?: readonly TaskView[] }
function researched(nodes: readonly ResearchNodeView[], g: GpuGeneration): boolean {
  const node = gpuResearch(nodes, g); return node ? node.state === 'done' : g === 1;
}
export function GpuPlate({ system, index, installed, onAction, onResearch, tasks: _tasks, ...frame }: GpuPlateProps) {
  const shell = useShell(), [choice, setChoice] = useState(0);
  const walletKey = useGameSelector(s => s.epoch + '|' + s.hud.credits + '|' + s.hud.data + '|' + s.research.active + '|' + s.research.queued, Object.is, 500);
  const tree = selectResearchTree(shell.store.getState()), open = GPU_GENERATIONS.filter(g => researched(tree.nodes, g));
  const card = installed?.kind === 'gpu' ? installed.gpu ?? null : null;
  const ref = index === null ? null : { unit: { kind: 'system' as const, id: system }, slot: { kind: 'gpu' as const, index } };
  const part = useQuote(ref && { kind: 'part', part: ref });
  const later = card ? GPU_GENERATIONS.find(g => g > card.generation) ?? null : null;
  const generation = useQuote(card && later !== null ? { kind: 'gpuModels', system, index, generation: later } : null)?.quotes[0];
  const types = useQuote(card ? { kind: 'gpuModels', system, index, generation: card.generation } : null)?.quotes.filter(q => q.gpu?.after.model !== card?.model) ?? [];
  const openKey = open.join(',');
  const entry = useMemo(() => {
    if (card || installed) return [];
    const byGen = open.map(generation => shell.quote({ kind: 'gpuModels', system, index, generation }).quotes);
    const at = byGen.map((qs, i) => qs.some(q => !q.locked && q.affordable) ? i : -1).filter(i => i >= 0).at(-1) ?? byGen.length - 1;
    return byGen[at] ?? [];
    // eslint-disable-next-line react-hooks/exhaustive-deps -- catalog choices are quoted from the live wallet and research
  }, [shell, card?.model, !!installed, system, index, walletKey, openKey]);
  const focus = shell.store.getSnapshot().focus, bays = focus.level === 'system' ? focus.gpu.length : 0;
  const npus = useQuote(index === null ? { kind: 'part', part: { unit: { kind: 'system', id: system }, slot: { kind: 'gpu', index: bays } } } : null);
  const options = card ? types : [...entry, ...(npus?.quotes.filter(q => q.action.type === 'addPart' && q.locked?.code !== 'research') ?? [])];
  const selected = options[choice] ?? options[0];
  const tier = part?.quotes.find(q => q.action.type === 'upgradePart');
  const primary = card ? tier : selected;
  const fire = (q: Quote) => {
    const before = shell.store.getState().build.revision;
    onAction(q.action);
    if (index === null && shell.store.getState().build.revision !== before) frame.onClose();
  };
  const keys = { onAction: fire, onResearch, researchName: frame.researchName };
  const picker = <><ChoiceStrip label="Card type" value={String(choice)} onPick={value => setChoice(Number(value))}
    choices={options.map((q, i) => ({ id: String(i), label: q.gpu ? `${q.gpu.after.model} · ${SERIES_NAMES[q.gpu.after.series]}` : q.label }))} />
    {card && selected && <QuoteKey quote={selected} label={selected.gpu ? `Switch to ${selected.gpu.after.model}` : 'Replace'} tone="replace" {...keys} />}</>;
  const npu = installed?.kind === 'npu';
  return <PlateFrame {...frame} title={card ? 'GPU ' + card.model : npu ? 'NPU ' + (index! + 1) : 'GPU bay'}
    sub={card ? SERIES_NAMES[card.series] + ' · Gen ' + card.generation + ' · Tier ' + card.tier : npu ? 'Gen ' + (installed.generation + 1) : 'Empty'} className="part gpu-picker"
    footer={npu ? <PartKeys quotes={part} level={installed.level} onAction={onAction} onResearch={onResearch} researchName={frame.researchName} part="primary" />
      : primary ? <QuoteKey quote={primary} label={card ? 'Upgrade' : 'Buy'} {...keys} /> : <Key label="Buy" detail="No card available" disabled onPress={() => undefined} />}>
    {card && <div className="component-facts"><p>{card.cores} cores · {ops(card.opsPerS)}/s</p><p>VRAM {bits(installed?.vramUsedBits ?? 0)} / {bits(card.vramBits)} · {Math.round((installed?.resourceBusy ?? 0) * 100)}% busy</p></div>}
    {npu ? <PartKeys quotes={part} level={installed.level} onAction={onAction} onResearch={onResearch} researchName={frame.researchName} part="rest" />
      : card ? <><GenerationAction quote={generation} {...keys} />
        {options.length > 0 && picker}</> : picker}
  </PlateFrame>;
}
