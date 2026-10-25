// The band: the level ladder and its name, Data and Credits around the payout coin, SLA and the
// round clock (L2 syncBand). It overlays the world's top edge. Every element keeps its box while
// its text updates in place; currencies are whole numbers (D2.2, D3.3).
import { ORDER, SPR } from '../render/core';
import type { LevelId } from '../game';
import { ArtCanvas } from './art/ArtCanvas';
import { amountText, clockText, slaText } from './hooks/format';
import { box, useLayout } from './shell/geometry';
import { shallowEqual, useGameSelector, useShell, useViewState } from './storeHooks';
import { LEVEL_NAMES } from './viewState';

/** The ladder lists the deepest level first: CPU, System, Rack, Room, Global. */
const LADDER: readonly LevelId[] = [...ORDER];

export function CurrencyIcon({ kind, n }: { kind: 'credits' | 'data'; n: number }) {
  return <ArtCanvas w={8} h={8} n={n} artKey={kind} className={`cur-ic ${kind}`}
    draw={g => { g.clearRect(0, 0, 8, 8); g.drawImage(kind === 'credits' ? SPR.coin8 : SPR.gem8, 0, 0); }} />;
}

function Ladder() {
  const L = useLayout(), { view, registry } = useShell(), state = useViewState();
  const unlocked = useGameSelector(s => s.unlocked, shallowEqual);
  const target = state.goal ?? state.focus.level;
  return <div className="ladder" role="group" aria-label="Zoom level">
    {LADDER.map((level, i) => {
      const open = unlocked[level] || level === state.focus.level;
      return <button key={level} type="button" className={`rung${open ? '' : ' locked'}`} data-level={level} style={box(L.rungs[i]!)}
        aria-pressed={level === target} title={open ? LEVEL_NAMES[level] : `${LEVEL_NAMES[level]}: opens with research`}
        aria-label={open ? LEVEL_NAMES[level] : `${LEVEL_NAMES[level]}, locked. Opens research.`} data-qa-target={L.kind === 'phone' ? '' : undefined}
        onClick={() => view.dispatch(open ? { type: 'zoomTo', level } : { type: 'openResearch' })}>
        <ArtCanvas w={16} h={16} n={L.N} style={{ margin: (L.rungs[i]!.w - 16 * L.N) / 2 }} artKey={`${level}:${registry.has(level)}`}
          draw={g => { g.clearRect(0, 0, 16, 16); if (registry.has(level)) registry.level(level).icon(g); }} />
      </button>;
    })}
    <span className="rung-label" style={{ ...box(L.rungLabel), lineHeight: `${L.rungLabel.h}px` }} data-testid="place">
      <b>{LEVEL_NAMES[state.focus.level]}</b></span>
  </div>;
}

function Wallet() {
  const L = useLayout();
  const w = useGameSelector(s => ({ credits: s.hud.credits, data: s.hud.data }), shallowEqual, 100);
  const row = L.creditsRow, gap = L.kind === 'desktop' ? L.gutter : 16, coin = 8 * L.N;
  const credits = amountText(w.credits), data = amountText(w.data);
  return <div className="wallet" role="group" aria-label="Wallet">
    <span className="figrow r" style={{ right: L.w - (L.creditX - gap), top: row.y, height: row.h }} aria-label={`${data} Data`}>
      <CurrencyIcon kind="data" n={L.N} /><b className="fig mid data" data-testid="data">{data}</b><span className="mute">Data</span>
    </span>
    <span className="hud-coin" data-free="art" style={{ left: L.creditX - coin / 2, top: row.y + (row.h - coin) / 2 }}><CurrencyIcon kind="credits" n={L.N} /></span>
    <span className="figrow" style={{ left: L.creditX + gap, top: row.y, height: row.h }} aria-label={`${credits} Credits`}>
      <b className="fig big gold" data-testid="credits">{credits}</b><span className="mute">Credits</span>
    </span>
  </div>;
}

function Sla() {
  const L = useLayout();
  const g = useGameSelector(s => ({ phase: s.round.state, percent: s.hud.sla.percent, seconds: Math.floor(s.hud.roundElapsedMs / 1000) }), shallowEqual, 250);
  const tone = g.percent >= 90 ? 'ok' : g.percent >= 80 ? 'warn' : 'bad';
  const when = g.phase === 'running' ? clockText(g.seconds * 1000) : g.phase === 'ended' ? 'round over' : 'between rounds';
  return <span className="figrow r sla" role="status" aria-label={`SLA ${slaText(g.percent)}, ${when}`} data-testid="sla-gauge"
    style={{ right: L.w - L.slaRight, top: L.band.y, height: L.rungRow }}>
    <span className="mute">SLA</span><span className={tone} data-testid="sla">{slaText(g.percent)}</span>
    {L.kind === 'desktop' && <span className="dim">· {when}</span>}
  </span>;
}

export function Hud() {
  const L = useLayout();
  return <header className="band" aria-label="Status">
    <div className="band-bg" style={box(L.band)} />
    <Ladder />
    <Wallet />
    <Sla />
  </header>;
}
