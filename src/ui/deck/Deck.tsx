// The deck (user, 26 Oct): one row, the Research tile at the left beside the head task's card. Buying
// happens on the world's parts (one-tap plates); offers.ts supplies fixes for the task detail.
import { useMemo } from 'react';
import { selectContextualResearchTree } from '../../game';
import { projectKey } from '../research/model';
import { ArtCanvas } from '../art/ArtCanvas';
import { drawFlask } from '../art/deckArt';
import { box, T, useLayout } from '../shell/geometry';
import { shallowEqual, useGameSelector, useShell, useViewState } from '../storeHooks';
import { NowCard } from './NowCard';
import { SettingsKey } from '../settings/SettingsKey';
import { hasTaskDock } from '../layout';

/** Projects the player could start right now (A04): the tile says so, as Build says "2 ready". */
function useResearchReady(): number {
  const { store } = useShell();
  const key = useGameSelector(s => `${s.epoch}|${store.getState().build.revision}|${s.research.active}|${s.research.queued}|${s.hud.data}|${s.hud.credits}|${s.hud.roundState}`, Object.is, 500);
  return useMemo(() => {
    const tree = selectContextualResearchTree(store.getState(), null), { credits, data } = store.getSnapshot().hud;
    return tree.nodes.filter(n => n.state === 'available' && projectKey(n, tree, credits, data).action).length;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` is the value identity of what the count reads
  }, [store, key]);
}

function ResearchKey() {
  const L = useLayout(), { view, store } = useShell(), open = useViewState().sheet === 'research', ready = useResearchReady();
  // D27: the project in the line (feed.research) is the live truth: waiting at the front, or running on a system.
  const r = useGameSelector(s => ({ active: s.feed.research?.name ?? s.research.name, progress: s.feed.research?.progress ?? s.research.progress,
    needsData: s.research.needsData, stopped: s.research.stoppedInsolvent, queued: s.research.queued,
    rate: s.feed.research?.opsPerSec ?? s.research.opsPerSec, waiting: s.feed.research ? !s.feed.research.running : false,
    // A paused project keeps its progress but holds no place in line.
    paused: !s.research.active && Object.keys(store.getState().research.parked).length > 0 }), shallowEqual, 250);
  const n = L.N, d = L.kind === 'desktop', k = L.research, pct = r.active ? `${Math.floor(r.progress * 100)}%` : '';
  if (hasTaskDock(L)) return <button type="button" className={`skey research-dock-key${open ? ' open' : ''}`} style={box(k)}
    data-testid="research-key" data-qa-target aria-expanded={open} aria-haspopup="dialog"
    title={r.active ? `Research: ${r.active} ${pct}` : ready ? `${ready} research projects ready` : 'Research'}
    aria-label={r.active ? `Research ${r.active} ${pct}` : 'Research'} onClick={() => view.dispatch({ type: 'toggleSheet', sheet: 'research' })}>
    <ArtCanvas w={16} h={16} n={n} artKey="flask" draw={drawFlask} />
    <i className="research-dock-progress" data-free="art" aria-hidden="true"><i style={{ width: `${r.progress * 100}%` }} /></i>
    {ready > 0 && !r.active && <b className="research-dock-ready gold">{ready}</b>}
  </button>;
  const idle = !r.active && ready ? <span className="gold">{ready} ready</span>
    : r.needsData ? <span className="dim">Needs Data</span> : <span className="dim">Idle</span>;
  // Icon at the top left, the title beside it, then one state line (and, on desktop, the project).
  const stacked = d && k.w < 128;
  const compact = stacked || !d && k.w < 112, flat = !d && k.h === 48;
  const textOnly = flat && k.w < 112;
  const pad = d ? L.lat : 8, icon = 16 * n, tx = compact || textOnly ? pad : pad + icon + 8;
  const line2 = d ? stacked ? pad + icon + 8 + L.lh : pad + L.lh : flat ? 24 : compact ? 56 : 48;
  return <button type="button" className={`panel research${open ? ' open' : ''}`} style={box(k)} data-k="research" data-testid="research-key" data-qa-target
    aria-expanded={open} aria-label={r.active ? `Research ${r.active} ${pct}` : ready ? `Research, ${ready} ready` : 'Research'}
    onClick={() => view.dispatch({ type: 'toggleSheet', sheet: 'research' })}>
    <i className="rim-track" data-free="art" style={{ left: n, top: n, width: k.w - 2 * n, height: 2 * n }}>
      <b className="rim-fill" data-tone="rnd" style={{ height: 2 * n, width: Math.round((k.w / n - 2) * r.progress) * n }} /></i>
    {!textOnly && <span className="aic" style={{ left: compact ? Math.floor((k.w - icon) / 16) * 8 : pad, top: pad }}><ArtCanvas w={16} h={16} n={n} artKey="flask" draw={drawFlask} /></span>}
    <T x={tx} y={stacked ? pad + icon + 8 : d || flat ? pad : compact ? 40 : 16} w={k.w - tx - 4}>{r.stopped ? <b className="warn">Stopped</b> : <b>Research</b>}</T>
    <T x={d || flat ? tx : pad} y={line2} w={k.w - (d || flat ? tx : pad) - pad}>{r.stopped ? <span className="warn">no Credits</span>
      : r.active ? <span className="rnd">{r.waiting ? compact ? 'Next' : 'Next in line' : compact ? pct : `Running ${pct}`}</span>
      : r.paused ? <span className="mute">Paused</span> : idle}</T>
    {d && r.active && <T x={tx} y={line2 + L.lh} w={k.w - tx - pad} className="mute">{r.active}</T>}
  </button>;
}

export function Deck() {
  return <div className="deck" onPointerDown={e => e.stopPropagation()}>
    <ResearchKey />
    <SettingsKey />
    <NowCard />
  </div>;
}
