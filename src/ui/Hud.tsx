// The band: the level ladder at the left (and its name on desktop), SLA in the centre at the big size
// with its 60–100% meter and the round clock, and Data over Credits stacked at the right (user, 25 Oct:
// SLA is very important). It overlays the world's top edge. Every element keeps its box while its text
// updates in place; currencies are whole numbers (D2.2, D3.3). On phone the pressed rung names the
// level and the icons name the currencies.
import { ORDER, SPR } from '../render/core';
import type { LevelId } from '../game';
import { ArtCanvas } from './art/ArtCanvas';
import { useEffect, useRef, useState } from 'react';
import { amountText, clockText, slaFill, slaText, wholeText } from './hooks/format';
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
    {L.kind === 'desktop' && <span className="rung-label" style={{ ...box(L.rungLabel), lineHeight: `${L.rungLabel.h}px` }} data-testid="place">
      <b>{LEVEL_NAMES[state.focus.level]}</b></span>}
  </div>;
}

/** A10: what the last purchase spent, shown for 600 ms after the Credits, where nothing else sits. */
function useSpent(): number | null {
  const shell = useShell(), [spent, setSpent] = useState<number | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const listener = (credits: number) => { setSpent(credits); clearTimeout(timer); timer = setTimeout(() => setSpent(null), 600); };
    shell.spent.add(listener);
    return () => { shell.spent.delete(listener); clearTimeout(timer); };
  }, [shell]);
  return spent;
}

/** Data over Credits at the band's right (user, 25 Oct), the same size; right-aligned, so nothing shifts. */
function Wallet() {
  const L = useLayout(), spent = useSpent(), d = L.kind === 'desktop';
  const w = useGameSelector(s => ({ credits: s.hud.credits, data: s.hud.data }), shallowEqual, 100);
  const box0 = L.wallet, rowH = box0.h / 2;
  const credits = amountText(w.credits), data = amountText(w.data);
  const row = (i: number) => ({ right: L.w - (box0.x + box0.w), top: box0.y + i * rowH, height: rowH });
  return <div className="wallet" role="group" aria-label="Wallet">
    <span className="figrow r" style={row(0)} aria-label={`${data} Data`}>
      <CurrencyIcon kind="data" n={L.N} /><b className="fig mid data" data-testid="data">{data}</b>{d && <span className="mute">Data</span>}
    </span>
    <span className="figrow r" style={row(1)} aria-label={`${credits} Credits`}>
      <span className="dim" data-testid="spent">{spent ? `−${wholeText(spent)}` : ''}</span>
      <CurrencyIcon kind="credits" n={L.N} /><b className="fig mid gold" data-testid="credits">{credits}</b>{d && <span className="mute">Credits</span>}
    </span>
  </div>;
}

/** SLA in the HUD's centre at the big size with its 60–100% meter (the 80% tick) and the round clock. */
/**
 * SLA in the HUD's centre (D28): the share of the round's last tasks that completed, met / (met +
 * failed) over the rolling window, at the big size; the counts beside it; and its 60–100% meter with
 * the 80% tick, or "warming up" until 10 tasks have resolved and the floor applies.
 */
function Sla() {
  const L = useLayout(), d = L.kind === 'desktop', n = L.N;
  const g = useGameSelector(s => ({ phase: s.round.state, percent: s.hud.sla.percent, met: s.hud.sla.met, failed: s.hud.sla.failed,
    checking: s.hud.sla.checking, round: s.hud.roundIndex, seconds: Math.floor(s.hud.roundElapsedMs / 1000) }), shallowEqual, 250);
  const tone = !g.checking ? 'mute' : g.percent >= 90 ? 'ok' : g.percent >= 80 ? 'warn' : 'bad';
  // Short words, so the label keeps its reserved width beside End round (QA-16).
  const when = g.phase === 'running' ? clockText(g.seconds * 1000) : g.phase === 'ended' ? 'over' : 'break';
  const counts = `${g.met} / ${g.met + g.failed}`, meterW = 32 * n;
  // Where the band is narrow (End round beside it), the meter gives way first; the percent carries the same reading.
  const roomy = 2.2 * L.body + 3.4 * L.big + 3.6 * L.body + meterW + (d ? 7 : 2) * L.body + 4 * 8 <= L.sla.w;
  // Reserved widths ("100.0%", "50 / 50", the meter, "R99 · 1:59:59"), so nothing moves while the numbers change.
  return <span className="figrow sla" role="status" aria-label={`SLA ${slaText(g.percent)}, ${counts} completed, round ${g.round}, ${when}`} data-testid="sla-gauge"
    style={{ left: L.sla.x, top: L.sla.y, width: L.sla.w, height: L.sla.h, justifyContent: 'center' }}>
    <span className="mute">SLA</span>
    <b className={`fig big ${tone}`} data-testid="sla" style={{ minWidth: 3.4 * L.big, textAlign: 'right' }}>{slaText(g.percent)}</b>
    <span className="mute" data-testid="sla-counts" style={{ minWidth: 3.6 * L.body, textAlign: 'center' }}>{counts}</span>
    {!roomy ? null : g.checking
      ? <i className="g-meter hud-meter" data-free="art" aria-hidden="true" title="80% ends the round" style={{ flex: 'none', width: meterW, height: 2 * n }}>
        <b style={{ width: `${slaFill(g.percent).toFixed(1)}%` }} /><em style={{ top: -n, height: 4 * n, width: n }} /></i>
      : <span className="dim" data-testid="sla-warming" style={{ width: meterW, textAlign: 'center' }} title="The 80% floor applies after 10 tasks">warming up</span>}
    <span className="dim" data-testid="round" style={{ width: d ? 7 * L.body : 2 * L.body }}>{d ? `R${g.round} · ${when}` : `R${g.round}`}</span>
  </span>;
}

/** How long the armed End round key waits for the second tap. */
export const END_CONFIRM_MS = 3000;

/** End round (spec §4.1): two taps within 3 s. Reserved in every phase; it only works while a round runs. */
function EndRound() {
  const L = useLayout(), shell = useShell(), k = L.endKey;
  const running = useGameSelector(s => s.round.state === 'running');
  const [armed, setArmed] = useState(false), timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => { if (!running) { clearTimeout(timer.current); setArmed(false); } }, [running]);
  const press = () => {
    clearTimeout(timer.current);
    if (!armed) { setArmed(true); timer.current = setTimeout(() => setArmed(false), END_CONFIRM_MS); return; }
    setArmed(false);
    shell.dispatch({ type: 'endRound' });
  };
  return <button type="button" className={`skey end-round ${armed ? 'warn two' : ''}`} style={box(k)} disabled={!running} data-testid="end-round"
    data-qa-target={k.h >= 44 ? "" : undefined} aria-label={armed ? "End round? Tap again" : "End round"} onPointerDown={e => e.stopPropagation()} onClick={press}>
    {armed ? <><span>End round?</span><span>Tap again</span></> : 'End round'}</button>;
}

export function Hud() {
  const L = useLayout();
  return <header className="band" aria-label="Status">
    <div className="band-bg" style={box(L.band)} />
    <Ladder />
    <Sla />
    <EndRound />
    <Wallet />
  </header>;
}
