// The deck (L2 syncDeck): the now card, the one Buy button (the best next upgrade), the build rows
// (desktop) or the Build sheet key (phone), and the research fixture that opens the drawer.
import { SPR } from '../../render/core';
import { ArtCanvas } from '../art/ArtCanvas';
import { drawFlask, drawMiniIcon, drawPartIcon } from '../art/deckArt';
import { wholeText } from '../hooks/format';
import type { DesktopLayout, PhoneLayout } from '../layout';
import { box, T, useLayout } from '../shell/geometry';
import { shallowEqual, useGameSelector, useShell, useViewState } from '../storeHooks';
import { BuildSheet } from './BuildSheet';
import { NowCard } from './NowCard';
import type { Offers } from './offers';
import { lockWord, offerAction, PriceText, useTapOffer } from './offerUi';
import { useShellOffers } from './useOffers';

function BuyButton({ offers }: { offers: Offers }) {
  const L = useLayout(), tap = useTapOffer(), nx = offers.next, n = L.N, d = L.kind === 'desktop';
  const can = !!nx && nx.affordable, tx = L.lat + 16 * n + 8;
  return <button type="button" className={`skey buy${can ? '' : ' off'}`} style={box(L.buy)} data-k="buy" data-testid="buy" data-qa-target
    disabled={!nx} title={nx ? `${nx.name}: ${nx.change} for ${wholeText(nx.price ?? 0)} Credits` : 'Nothing to buy here'}
    onClick={() => { if (nx && can) tap(nx); }}>
    {nx && <>
      <span className="aic" style={{ left: L.lat, top: d ? 0 : L.lat }}>
        <ArtCanvas w={16} h={16} n={n} artKey={`${nx.icon}:${can}`} draw={g => drawPartIcon(g, nx.icon, !can)} />
      </span>
      {d ? <>
        <T x={tx} y={0} h={L.buy.h} w={L.buy.w - tx - 160}><b>{nx.name}</b> <span className={can ? '' : 'mute'}>{nx.change}</span></T>
        <T right={L.lat} y={0} h={L.buy.h}><PriceText offer={nx} n={n} /></T>
      </> : <>
        <T x={tx} y={8}><b>{nx.name}</b></T>
        <T right={8} y={8}><PriceText offer={nx} n={n} /></T>
        <T x={tx} y={24} w={L.buy.w - tx - 8} className={`${can ? '' : 'mute'}`}>{nx.change}</T>
        <T x={8} y={40} className={can ? 'gold' : 'dim'}>{can ? 'Tap to buy' : 'Saving up'}</T>
      </>}
    </>}
  </button>;
}

function BuildRows({ L, offers }: { L: DesktopLayout; offers: Offers }) {
  const tap = useTapOffer(), n = L.N, first = L.rows[0], nameX = L.lat + 8 * n + 8, changeX = nameX + 32 * n;
  return <ul className="panel rows" aria-label="Build" style={box({ x: first.x, y: first.y, w: first.w, h: 5 * first.h })} data-testid="build-rows">
    {offers.rows.map((o, i) => {
      const research = !o.where && o.quote?.locked?.code === 'research';
      return <li key={o.key}><button type="button" className={`row${i === offers.best ? ' best' : ''}${o.affordable ? '' : ' off'}`}
        style={box(L.rows[i]!, first)} data-k={`row-${o.key}`} data-row={o.key} disabled={!offerAction(o)}
        title={`${o.name}: ${o.change}${o.lock ? ` (${o.lock})` : ''}`} onClick={() => tap(o)}>
        <span className="aic" style={{ left: L.lat, top: 0 }}>
          <ArtCanvas w={8} h={8} n={n} artKey={`${o.icon}:${!!o.lock}`} draw={g => drawMiniIcon(g, o.icon, !!o.lock)} />
        </span>
        <T x={nameX} y={0} h={first.h}><b className={o.lock && !o.where ? 'dim' : ''}>{o.name}</b>{o.where && <> <span className="net">{o.change}</span></>}</T>
        {!o.where && <T x={changeX} y={0} h={first.h} w={first.w - changeX - 160} className={`${o.lock ? 'dim' : 'mute'}`}>{o.change}</T>}
        <T right={research ? L.lat + 8 * n + 8 : L.lat} y={0} h={first.h}>
          {o.price !== null ? <PriceText offer={o} n={n} /> : o.lock ? <span className="dim">{lockWord(o)}</span> : null}
        </T>
        {research && <span className="aic" style={{ right: L.lat, top: 0 }}>
          <ArtCanvas w={7} h={8} n={n} artKey="lock" draw={g => { g.clearRect(0, 0, 7, 8); g.drawImage(SPR.lock, 0, 0); }} />
        </span>}
      </button></li>;
    })}
  </ul>;
}

function BuildKey({ L, offers }: { L: PhoneLayout; offers: Offers }) {
  const { view } = useShell(), open = useViewState().sheet === 'build';
  const ready = offers.rows.filter(o => o.affordable).length;
  return <button type="button" className={`skey${open ? '' : ' off'}`} style={box(L.build)} data-k="build" data-testid="build-key" data-qa-target
    aria-expanded={open} onClick={() => view.dispatch({ type: 'toggleSheet', sheet: 'build' })}>
    <T x={16} y={16}><b>Build</b></T>
    <T x={16} y={32}>{ready ? <span className="gold">{ready} ready</span> : <span className="dim">saving</span>}</T>
  </button>;
}

function ResearchKey() {
  const L = useLayout(), { view } = useShell(), open = useViewState().sheet === 'research';
  const r = useGameSelector(s => ({ active: s.research.name, progress: s.research.progress, needsData: s.research.needsData, stopped: s.research.stoppedInsolvent }), shallowEqual, 250);
  const n = L.N, d = L.kind === 'desktop', pct = r.active ? `${Math.floor(r.progress * 100)}%` : '';
  const what = r.active ? <span className="mute">{r.stopped ? 'Stopped · no Credits' : r.active}</span>
    : r.needsData ? <span className="dim">Needs Data</span> : <span className="dim">Idle</span>;
  return <button type="button" className={`panel research${open ? ' open' : ''}`} style={box(L.research)} data-k="research" data-testid="research-key" data-qa-target
    aria-expanded={open} aria-label={r.active ? `Research ${r.active} ${pct}` : 'Research'}
    onClick={() => view.dispatch({ type: 'toggleSheet', sheet: 'research' })}>
    {d ? <i className="bar" data-free="art" style={{ left: 72 * n, top: (L.research.h - 4 * n) / 2, width: 40 * n, height: 4 * n }}>
      <b style={{ width: Math.round(38 * r.progress) * n }} /></i>
      : <i className="rim-track" data-free="art" style={{ left: n, top: n, width: L.research.w - 2 * n, height: 2 * n }}>
        <b className="rim-fill" data-tone="rnd" style={{ height: 2 * n, width: Math.round((L.research.w / n - 2) * r.progress) * n }} /></i>}
    <span className="aic" style={{ left: L.lat, top: d ? 0 : L.lat }}><ArtCanvas w={16} h={16} n={n} artKey="flask" draw={drawFlask} /></span>
    {d ? <>
      <T x={L.lat + 16 * n + 8} y={0} h={L.research.h} w={72 * n - L.lat - 16 * n - 16}>{r.active ? <b>{r.active}</b> : <><b>Research</b> {what}</>}</T>
      <T right={L.lat} y={0} h={L.research.h} className="rnd">{pct}</T>
    </> : <>
      <T x={48} y={8} className="rnd">{pct}</T>
      <T x={8} y={40} w={L.research.w - 16}>{what}</T>
    </>}
  </button>;
}

export function Deck() {
  const L = useLayout(), offers = useShellOffers(), sheet = useViewState().sheet;
  return <div className="deck" onPointerDown={e => e.stopPropagation()}>
    <NowCard />
    <BuyButton offers={offers} />
    {L.kind === 'desktop' ? <BuildRows L={L} offers={offers} /> : <BuildKey L={L} offers={offers} />}
    <ResearchKey />
    {L.kind === 'phone' && sheet === 'build' && <BuildSheet L={L} offers={offers} />}
  </div>;
}
