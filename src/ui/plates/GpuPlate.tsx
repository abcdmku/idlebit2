import { useMemo, useState } from 'react';
import { POOL_DOMAIN, selectResearchTree, type Amount, type GpuGeneration, type GpuStats, type PartView, type GpuSeries, type GpuTier, type Quote, type QuoteResult, type QuoteRequest, type ResearchNodeView, type ResearchTreeView, type SystemId, type TaskView } from '../../game';
import { useGameSelector, useQuote, useShell } from '../storeHooks';
import { projectKey } from '../research/model';
import { familyName } from '../hooks/feedModel';
import { TaskTypeLabel } from '../art/TaskType';
import { useLayout } from '../shell/geometry';
import { bits, hertz, ops, quantity, span, watts } from './format';
import { PlateFrame } from './PlateFrame';
import type { PlateCommon } from './types';
import { exactAmount, GPU_CLASSES, GPU_GENERATIONS, GPU_SERIES, GPU_TIERS, gpuResearch, lacksAmount, SERIES_COPY, SERIES_NAMES, type GpuSelection } from './gpuModel';
import { Pips } from './widgets';
import { GpuCard } from './GpuCard';
import { GpuPower } from './GpuPower';
import '../styles/gpu.css';

interface GpuPlateProps extends Omit<PlateCommon, 'quotes'> {
  system: SystemId;
  index: number | null;
  installed?: PartView;
  tasks?: readonly TaskView[];
}

/** The connected picker owns selection only. Every stat, price and purchase comes from the sim. */
export function GpuPlate({ system, index, installed, ...props }: GpuPlateProps) {
  const shell = useShell();
  const walletKey = useGameSelector(s => `${s.epoch}|${s.hud.credits}|${s.hud.data}|${s.research.active}|${s.research.queued}`, Object.is, 500);
  void walletKey;
  const tree = selectResearchTree(shell.store.getState());
  const cap = [...GPU_GENERATIONS].reverse().find(g => generationResearched(tree.nodes, g)) ?? null;
  const card = installed?.gpu ?? null;
  // D39: an occupied slot is only offered strictly better cards. The plate opens on the first one.
  const first = useMemo(() => card && index !== null ? firstOffer(shell.quote, system, index, card.generation) : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the installed model and wallet are the inputs
    [shell, system, index, card?.model, walletKey]);
  // A pick belongs to the card it was made against; after a replace the plate reopens on the next offer.
  const [pick, setPick] = useState<{ readonly model: string | undefined; readonly selection: GpuSelection } | null>(null);
  const picked = pick && pick.model === card?.model ? pick.selection : null;
  const setSelection = (next: GpuSelection) => setPick({ model: card?.model, selection: next });
  const selection: GpuSelection = picked ?? first ?? {
    generation: card?.generation ?? cap ?? 1, series: card?.series ?? 3, tier: card?.tier ?? 30,
  };
  const models = useQuote({ kind: 'gpuModels', system, index, generation: selection.generation });
  const part = useQuote(index === null ? null : { kind: 'part', part: { unit: { kind: 'system', id: system }, slot: { kind: 'gpu', index } } });
  const code = `${selection.generation}${selection.series}${selection.tier}`;
  const selected = models?.quotes.find(q => q.action.type === 'installGpu' && q.action.model === code);
  const upgrade = part?.quotes.find(q => q.action.type === 'upgradePart' && q.gpu);
  const credits = shell.store.getSnapshot().hud.credits;
  return <GpuModelPlate {...props} installed={installed} system={system} index={index} selection={selection} onSelect={setSelection}
    selected={selected} upgrade={upgrade} tree={tree} credits={credits} data={shell.store.getSnapshot().hud.data} cap={cap}
    best={!!card && index !== null && first === null} />;
}

export interface GpuModelPlateProps extends GpuPlateProps {
  selection: GpuSelection;
  onSelect: (selection: GpuSelection) => void;
  selected: Quote | undefined;
  upgrade: Quote | undefined;
  tree: ResearchTreeView;
  credits: Amount;
  data: Amount;
  cap: GpuGeneration | null;
  /** The installed card has no strictly better model on offer. */
  best?: boolean;
}

/** Gen 1 has no project of its own (D39: it needs System); every later generation needs its research. */
function generationResearched(nodes: readonly ResearchNodeView[], g: GpuGeneration): boolean {
  const node = gpuResearch(nodes, g);
  return node ? node.state === 'done' : g === 1;
}

/** The first model the sim offers for this slot: from the installed generation up, then below; unlocked first. */
function firstOffer(quote: (r: QuoteRequest) => QuoteResult, system: SystemId, index: number, from: GpuGeneration): GpuSelection | null {
  const order = [...GPU_GENERATIONS.filter(g => g >= from), ...GPU_GENERATIONS.filter(g => g < from)];
  const offers = order.flatMap(generation => quote({ kind: 'gpuModels', system, index, generation }).quotes);
  const q = offers.find(o => !o.locked) ?? offers[0];
  if (!q || q.action.type !== 'installGpu') return null;
  const code = q.action.model;
  return { generation: Number(code[0]) as GpuGeneration, series: Number(code[1]) as GpuSeries, tier: Number(code.slice(2)) as GpuTier };
}

export function GpuModelPlate({ system, index, installed, tasks = [], selection: s, onSelect, selected: q, upgrade, tree, credits, data, cap, best = false,
  onAction, onResearch, ...frame }: GpuModelPlateProps) {
  const L = useLayout();
  const before = q?.gpu?.before ?? installed?.gpu ?? null, after = q?.gpu?.after;
  const code = `${s.generation}${s.series}${s.tier}`;
  const nextGeneration = GPU_GENERATIONS.find(g => cap === null || g > cap);
  const next = nextGeneration ? gpuResearch(tree.nodes, nextGeneration) : undefined;
  const researchKey = next ? projectKey(next, tree, credits, data) : null;
  const selectedResearch = q?.locked?.code === 'research' ? q.locked.node : null;
  const feePending = next?.state === 'available' || next?.state === 'locked' || next?.state === 'queued';
  const hot = upgrade?.gpu?.after;
  const held = installed?.vramUsedBits ?? 0;
  const assigned = index === null ? [] : tasks.filter(t => t.accelDomain === index || t.accelDomain === POOL_DOMAIN);
  const notOffered = !q && index !== null && !!installed?.gpu;
  const note = best ? 'Your card is the best available' : notOffered ? 'Not an upgrade' : q?.locked?.text ?? (q && !q.affordable ? 'Needs more Credits' : q?.cold
    ? q.downtimeMs > 0 ? `${span(q.downtimeMs / 1000)} offline. Running work is lost.${index === null ? '' : ' Old card is scrapped.'}`
      : `No downtime between rounds.${index === null ? '' : ' Old card is scrapped.'}`
    : index === null ? 'Installs this preconfigured model.' : 'No downtime. Old card is scrapped.');
  return <PlateFrame {...frame} title={index === null ? 'Buy GPU' : installed?.kind === 'npu' ? 'Replace NPU with GPU' : 'Replace GPU'} sub={`System ${system + 1}${index === null ? '' : ` · slot ${index + 1}`}`}
    className="gpu-picker" closeKey pinTop>
    <div className="gpu-scroll" tabIndex={0} aria-label="GPU models and actions">
      <div className="gpu-body">
        <div className="gpu-configure">
          <label className="gpu-generation"><span>Generation</span><select aria-label="GPU generation" value={s.generation}
            onChange={e => onSelect({ ...s, generation: Number(e.target.value) as GpuGeneration })}>
            {GPU_GENERATIONS.map(g => <option key={g} value={g}>Gen {g} · {GPU_CLASSES[g - 1]}{generationResearched(tree.nodes, g) ? '' : ' · locked'}</option>)}
          </select></label>
          <div className="gpu-choice-label">Series</div>
          <div className="gpu-options gpu-series" role="group" aria-label="GPU series">
            {GPU_SERIES.map(series => <button key={series} type="button" aria-pressed={s.series === series}
              aria-label={`Series ${series}, ${SERIES_NAMES[series]}`} onClick={() => onSelect({ ...s, series })}>
              <b>{series}</b><span>{SERIES_NAMES[series]}</span></button>)}
          </div>
          <div className="gpu-choice-label">Tier</div>
          <div className="gpu-options gpu-tiers" role="group" aria-label="GPU tier">
            {GPU_TIERS.map(tier => <button key={tier} type="button" aria-pressed={s.tier === tier} aria-label={`Tier ${tier}`}
              onClick={() => onSelect({ ...s, tier })}>{tier}</button>)}
          </div>
          <p className="gpu-emphasis">{SERIES_COPY[s.series]}</p>
          <p className="gpu-cap">Current cap · {cap === null ? 'GPU research needed' : `Gen ${cap}, ${GPU_CLASSES[cap - 1]}`}</p>
        </div>
        <div className="gpu-quote">
          <div className="gpu-model"><GpuCard /><div><b>{code} · {SERIES_NAMES[s.series]}</b><span>Gen {s.generation} · {GPU_CLASSES[s.generation - 1]} class</span></div></div>
          <GpuComparison before={before} after={after} code={code} installedLabel={installed?.kind === 'npu' ? `NPU Gen ${installed.generation + 1}` : undefined} />
          <GpuPower power={q?.gpuPower} />
          {!best && <button type="button" className="key gpu-buy" disabled={!q || !!q.locked || !q.affordable} onClick={() => q && onAction(q.action)}>
            <span>{index === null ? 'Buy' : 'Replace with'} {code}</span><span className="gpu-price">{q ? `${exactAmount(q.cost)} Cr` : notOffered ? '' : 'Loading quote'}</span>
          </button>}
          <p className={`gpu-note${q?.locked || q && !q.affordable || notOffered && !best ? ' warn' : ''}`} aria-live="polite">{note}</p>
          <button type="button" className="gpu-research-link" disabled={!selectedResearch} onClick={() => selectedResearch && onResearch?.(selectedResearch)}>
            {selectedResearch ? 'Open required research' : q ? 'Selected generation researched' : best ? 'Nothing better to buy' : notOffered ? 'Pick a better model' : 'Waiting for quote'}
          </button>
        </div>
      </div>
      <div className="gpu-alternatives">
        <section>
          <div className="gpu-alt-title"><span>{before ? `Keep ${before.model} · hot upgrade` : 'Hot upgrades after purchase'}</span><Pips filled={before?.upgrades ?? 0} max={before?.maxUpgrades ?? 5} /></div>
          <button type="button" className="key ghost" disabled={!upgrade || !!upgrade.locked || !upgrade.affordable} onClick={() => upgrade && onAction(upgrade.action)}>
            <span>{before ? before.upgrades >= before.maxUpgrades ? 'Upgrade limit reached' : `Push +${before.upgrades} to +${hot?.upgrades ?? before.upgrades + 1}` : 'No card installed'}</span>
            <span className="gpu-price">{upgrade ? `${exactAmount(upgrade.cost)} Cr` : ''}</span>
          </button>
          <p className="gpu-note">{upgrade?.locked?.text ?? (upgrade && !upgrade.affordable ? 'Needs more Credits' : hot && before
            ? `${hot.cores.toLocaleString('en-US')} cores · ${bits(hot.vramBits)} VRAM · ${hertz(hot.clockHz)}. ${quantity(before.efficiencyOpsPerJ, 'ops/J')} → ${quantity(hot.efficiencyOpsPerJ, 'ops/J')}. Instant. Running work stays.`
            : 'Each push raises specs and lowers efficiency.')}</p>
          <GpuPower power={upgrade?.gpuPower} hot />
        </section>
        <section>
          <div className="gpu-alt-title"><span>{nextGeneration ? `Next · Gen ${nextGeneration}` : 'All generations researched'}</span></div>
          <button type="button" className="key locked-action" disabled={!next || !researchKey?.action && !next.lockedBy}
            onClick={() => { if (researchKey?.action) onAction(researchKey.action); else if (next?.lockedBy) onResearch?.(next.id); }}>
            <span>{next ? `${researchKey?.label ?? 'Research'} · ${next.name}` : 'Gen 9 unlocked'}</span>
            {next && <span className="gpu-research-price"><span>{exactAmount(next.dataCost)} Data</span><span>{exactAmount(next.creditCost ?? '0' as Amount)} Cr</span></span>}
          </button>
          <p className="gpu-shortfall">{next && feePending && (next.needsData || lacksAmount(data, next.dataCost)) ? 'Needs Data. ' : ''}{next && feePending && (next.needsCredits || lacksAmount(credits, next.creditCost)) ? 'Needs Credits.' : ''}</p>
          <p className="gpu-note">{next ? `${ops(next.workOps)} + energy. Fees charged when work starts. Cancel gives no refund.` : 'Choose a model from any generation.'}</p>
        </section>
      </div>
      <p className="gpu-status">{before ? `${bits(held)} of ${bits(before.vramBits)} VRAM held. ` : ''}Task fit uses cores and VRAM. Clock sets work speed.</p>
      {assigned.length > 0 && <ul className="gpu-tasks" aria-label="Assigned GPU work">{assigned.map(t => <li key={t.key}>
        <TaskTypeLabel family={t.family} n={L.N} />
        <span><span className="gpu-task-family">{familyName(t.family)}</span> · {t.gpuCoresMin} cores · {bits(t.vramBits)} VRAM · {t.accelDomain === POOL_DOMAIN ? 'linked pool' : `slot ${(t.accelDomain ?? 0) + 1}`}</span>
      </li>)}</ul>}
    </div>
  </PlateFrame>;
}

function GpuComparison({ before, after, code, installedLabel }: { before: GpuStats | null; after: GpuStats | undefined; code: string; installedLabel?: string }) {
  const rows: readonly [string, (s: GpuStats) => string][] = [
    ['Cores', s => s.cores.toLocaleString('en-US')], ['VRAM', s => bits(s.vramBits)], ['Clock', s => hertz(s.clockHz)],
    ['Rated work', s => `${ops(s.opsPerS)}/s`], ['Efficiency', s => quantity(s.efficiencyOpsPerJ, 'ops/J')],
    ['Card load', s => watts(s.idleW + s.loadW)],
  ];
  return <table className="gpu-comparison" aria-label="Installed and selected GPU comparison">
    <thead><tr><th>Specs</th><th>{before ? `${before.model} +${before.upgrades}` : installedLabel ?? 'Empty slot'}</th><th>{code} native</th></tr></thead>
    <tbody>{rows.map(([label, value]) => <tr key={label}><th scope="row">{label}</th><td>{before ? value(before) : '—'}</td><td>{after ? value(after) : '—'}</td></tr>)}</tbody>
  </table>;
}
