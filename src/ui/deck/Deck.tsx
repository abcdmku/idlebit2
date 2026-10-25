// The deck (L2 syncDeck), with the head task moved up to the queue strip: the build list (desktop) or
// the Build sheet key (phone), the research fixture that opens the drawer, and the one Buy key (the
// best next upgrade) in the bottom-right corner on every layout. One offer list feeds all of them
// and the world's callouts (A08).
import { useEffect, useMemo, useState } from 'react';
import { formatOps, selectContextualResearchTree } from '../../game';
import { projectKey } from '../research/ResearchDrawer';
import { ArtCanvas } from '../art/ArtCanvas';
import { drawFlask, drawMiniIcon, drawPartIcon } from '../art/deckArt';
import { wholeText } from '../hooks/format';
import type { DesktopLayout, PhoneLayout } from '../layout';
import { box, T, useLayout } from '../shell/geometry';
import { shallowEqual, useGameSelector, useShell, useViewState } from '../storeHooks';
import { BuildSheet } from './BuildSheet';
import type { Offers } from './offers';
import { offerAction, PriceText, RightText, useTapOffer } from './offerUi';
import { useShellOffers } from './useOffers';

/** Room the price keeps at the right of a line, so a long name truncates before the price does (A13). */
const PRICE_W = 120;

function BuyButton({ offers }: { offers: Offers }) {
  const L = useLayout(), tap = useTapOffer(), nx = offers.next, unlock = offers.unlock, n = L.N, d = L.kind === 'desktop';
  const credits = useGameSelector(s => Math.floor(Number(s.hud.credits)), Object.is, 250);
  const can = !!nx && nx.affordable, tx = L.lat + 16 * n + 8, b = L.buy, pad = d ? L.lat : 8;
  const short = nx?.price ? Math.max(0, nx.price - credits) : 0;
  const shown = nx ?? unlock;
  return <button type="button" className={`skey buy${can ? '' : ' off'}`} style={box(b)} data-k="buy" data-testid="buy" data-qa-target
    disabled={!nx && !unlock} title={nx ? `${nx.name}: ${nx.change} for ${wholeText(nx.price ?? 0)} Credits` : unlock ? `Research ${unlock.right.kind === 'research' ? unlock.right.node : ''}` : 'Nothing to buy here'}
    onClick={() => { if (nx && can) tap(nx); else if (!nx && unlock) tap(unlock); }}>
    {!shown ? <T x={pad} y={pad} className="dim">Nothing to buy here</T> : <>
      <span className="aic" style={{ left: L.lat, top: L.lat }}>
        <ArtCanvas w={16} h={16} n={n} artKey={`${shown.icon}:${can}`} draw={g => drawPartIcon(g, shown.icon, !can)} />
      </span>
      {!nx && unlock ? <>
        <T x={tx} y={pad} w={b.w - tx - 8}><b>Next: {unlock.right.kind === 'research' ? unlock.right.node : unlock.name}</b></T>
        <T x={tx} y={pad + L.lh} w={b.w - tx - 8} className="mute">{unlock.name}{unlock.change ? ` ${unlock.change}` : ''}</T>
        <T x={d ? tx : 8} y={pad + 2 * L.lh} className="rnd">Research</T>
      </> : nx && (d ? <>
        <T x={tx} y={L.lat} w={b.w - tx - PRICE_W}><b>{nx.name}</b></T>
        <T right={L.lat} y={L.lat}><PriceText offer={nx} n={n} /></T>
        <T x={tx} y={L.lat + L.lh} w={b.w - tx - L.lat} className={can ? '' : 'mute'}>{nx.change}</T>
        <T x={tx} y={L.lat + 2 * L.lh} w={b.w - tx - L.lat} className={can ? 'gold' : 'dim'}><b>{can ? 'Buy' : `Saving up · ${wholeText(short)} to go`}</b></T>
      </> : <>
        {/* The name has its own line (it never shares one with the price); the price sits by the call to buy. */}
        <T x={tx} y={8} w={b.w - tx - 8}><b>{nx.name}</b></T>
        <T x={tx} y={24} w={b.w - tx - 8} className={`${can ? '' : 'mute'}`}>{nx.change}</T>
        <T x={8} y={40} className={can ? 'gold' : 'dim'}>{can ? 'Tap to buy' : 'Saving up'}</T>
        <T right={8} y={40}><PriceText offer={nx} n={n} /></T>
      </>)}
    </>}
  </button>;
}

const PAGE = 5;

function BuildRows({ L, offers }: { L: DesktopLayout; offers: Offers }) {
  const tap = useTapOffer(), n = L.N, first = L.rows[0], h = first.h, level = useViewState().focus.level;
  const pages = Math.ceil(offers.rows.length / PAGE), [page, setPage] = useState(0);
  useEffect(() => setPage(0), [level]);
  const p = Math.min(page, pages - 1), keyW = pages > 1 ? 48 : 0, w = first.w - keyW;
  const nameX = L.lat + 8 * n + 8, changeX = nameX + 40 * n, iconTop = (h - 8 * n) / 2;
  return <div className="deck-rows">
    <ul className="panel rows" aria-label="Build" style={box({ x: first.x, y: first.y, w: first.w, h: 5 * h })} data-testid="build-rows">
      {offers.rows.slice(p * PAGE, p * PAGE + PAGE).map((o, j) => {
        const i = p * PAGE + j, locked = !!o.lock && !o.where;
        return <li key={o.key}><button type="button" className={`row${i === offers.best ? ' best' : ''}${o.affordable ? '' : ' off'}`}
          style={{ ...box(L.rows[j]!, first), width: w }} data-k={`row-${o.key}`} data-row={o.key} disabled={!offerAction(o)}
          title={`${o.name}${o.change ? `: ${o.change}` : ''}${o.lock ? ` (${o.lock})` : ''}`} onClick={() => tap(o)}>
          <span className="aic" style={{ left: L.lat, top: iconTop }} data-free={iconTop % 8 ? 'art' : undefined}>
            <ArtCanvas w={8} h={8} n={n} artKey={`${o.icon}:${locked}`} draw={g => drawMiniIcon(g, o.icon, locked)} />
          </span>
          <T x={nameX} y={0} h={h} w={changeX - nameX - 8}><b className={locked ? 'mute' : ''}>{o.name}</b></T>
          <T x={changeX} y={0} h={h} w={w - changeX - (o.right.kind === 'research' || o.right.kind === 'at' || o.right.kind === 'lock' ? 240 : 104)} className={o.where ? 'net' : 'mute'}>{o.change}</T>
          <T right={L.lat} y={0} h={h}><RightText offer={o} n={n} /></T>
        </button></li>;
      })}
    </ul>
    {pages > 1 && <button type="button" className="skey off page" data-testid="rows-page" aria-label={`Build list page ${p + 1} of ${pages}`}
      style={{ left: first.x + first.w - keyW, top: first.y, width: keyW, height: 5 * h }} onClick={() => setPage((p + 1) % pages)}>
      {p + 1}/{pages}</button>}
  </div>;
}

function BuildKey({ L, offers }: { L: PhoneLayout; offers: Offers }) {
  const { view } = useShell(), open = useViewState().sheet === 'build';
  const ready = offers.rows.filter(o => o.affordable).length;
  return <button type="button" className={`skey${open ? '' : ' off'}`} style={box(L.build)} data-k="build" data-testid="build-key" data-qa-target
    aria-expanded={open} onClick={() => view.dispatch({ type: 'toggleSheet', sheet: 'build' })}>
    <T x={16} y={16}><b>Build</b></T>
    <T x={16} y={32}>{ready ? <span className="gold">{ready} ready</span> : <span className="dim">saving up</span>}</T>
  </button>;
}


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
  const L = useLayout(), { view } = useShell(), open = useViewState().sheet === 'research', ready = useResearchReady();
  const r = useGameSelector(s => ({ active: s.research.name, progress: s.research.progress, needsData: s.research.needsData,
    stopped: s.research.stoppedInsolvent, queued: s.research.queued, rate: s.research.opsPerSec }), shallowEqual, 250);
  const n = L.N, d = L.kind === 'desktop', k = L.research, pct = r.active ? `${Math.floor(r.progress * 100)}%` : '';
  const idle = !r.active && ready ? <span className="gold">{ready} ready</span>
    : r.needsData ? <span className="dim">Needs Data</span> : <span className="dim">Idle</span>;
  const tx = L.lat + 16 * n + 8;
  return <button type="button" className={`panel research${open ? ' open' : ''}`} style={box(k)} data-k="research" data-testid="research-key" data-qa-target
    aria-expanded={open} aria-label={r.active ? `Research ${r.active} ${pct}` : ready ? `Research, ${ready} ready` : 'Research'}
    onClick={() => view.dispatch({ type: 'toggleSheet', sheet: 'research' })}>
    <i className="rim-track" data-free="art" style={{ left: n, top: n, width: k.w - 2 * n, height: 2 * n }}>
      <b className="rim-fill" data-tone="rnd" style={{ height: 2 * n, width: Math.round((k.w / n - 2) * r.progress) * n }} /></i>
    <span className="aic" style={{ left: L.lat, top: L.lat }}><ArtCanvas w={16} h={16} n={n} artKey="flask" draw={drawFlask} /></span>
    {d ? <>
      <T x={tx} y={L.lat} w={k.w - tx - L.lat - (r.active ? 56 : 0)}><b>Research</b>{!r.active && ready > 0 && <span className="gold"> · {ready} ready</span>}</T>
      <T right={L.lat} y={L.lat} className="rnd">{pct}</T>
      <T x={tx} y={L.lat + L.lh} w={k.w - tx - L.lat}>{r.active ? <b>{r.active}</b>
        : ready ? <span className="mute">Tap to start one</span> : idle}</T>
      <T x={tx} y={L.lat + 2 * L.lh} w={k.w - tx - L.lat}>{r.stopped ? <span className="warn">Stopped · no Credits</span>
        : r.active ? <span className="mute">{formatOps(r.rate)}/s{r.queued ? ` · ${r.queued} queued` : ''}</span>
        : <span className="dim">{ready ? '' : 'Choose a project'}</span>}</T>
    </> : <>
      <T x={48} y={8} w={k.w - 52}><b>Research</b></T>
      <T x={8} y={40} w={k.w - 16}>{r.active ? <><span className="rnd">{pct}</span> <span className="mute">{r.stopped ? 'stopped' : r.active}</span></> : idle}</T>
    </>}
  </button>;
}

export function Deck() {
  const L = useLayout(), offers = useShellOffers(), sheet = useViewState().sheet;
  return <div className="deck" onPointerDown={e => e.stopPropagation()}>
    {L.kind === 'desktop' ? <BuildRows L={L} offers={offers} /> : <BuildKey L={L} offers={offers} />}
    <ResearchKey />
    <BuyButton offers={offers} />
    {L.kind === 'phone' && sheet === 'build' && <BuildSheet L={L} offers={offers} />}
  </div>;
}
