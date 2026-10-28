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
import { returnToMarket } from './input/commands';
import { CoinIcon } from './plates/icons';

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
    {L.kind === 'desktop' && <span className="rung-label" style={{ ...box(L.rungLabel), lineHeight: `${L.lh}px` }} data-testid="place">
      <b>{LEVEL_NAMES[state.focus.level]}</b></span>}
  </div>;
}

function NetIncome() {
  const L = useLayout(), d = L.kind === 'desktop';
  const { net, live } = useGameSelector(s => {
    const report = s.round.lastReport, live = s.round.state === 'running';
    const net = !live && report && report.durationMs > 0
      ? (BigInt(report.net) * 60000n / BigInt(report.durationMs)).toString() as typeof s.hud.netPerMinute : s.hud.netPerMinute;
    return { net, live };
  }, shallowEqual, 500);
  const text = `${BigInt(net) > 0n ? '+' : ''}${amountText(net)}/min`;
  const at = d ? { x: L.rungLabel.x, y: L.rungLabel.y + L.lh, w: L.rungLabel.w, h: L.lh }
    : { x: L.sla.x + 8, y: L.sla.y + 32, w: L.sla.w - 8, h: 16 };
  return <span className={`t clip ${BigInt(net) < 0n ? 'bad' : 'ok'}`} style={box(at)} data-testid="net-income"
    title={live ? 'Net Credits after energy over the last 60 seconds' : 'Last round average net Credits after energy'}
    aria-label={`${live ? 'Net income' : 'Last round net income'} ${text} after energy`}>{live ? 'Net' : 'Last'} <CoinIcon />{text}</span>;
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
      <span className="dim" data-testid="spent">{spent ? <>−<CoinIcon />{wholeText(spent)}</> : ''}</span>
      <CurrencyIcon kind="credits" n={L.N} /><b className="fig mid gold" data-testid="credits">{credits}</b>{d && <span className="mute">Credits</span>}
    </span>
  </div>;
}

/**
 * SLA in the HUD's centre (D28): the share of the round's last tasks that completed, met / (met +
 * failed) over the rolling window, at the big size; the counts beside it; and its 60–100% meter with
 * the 80% tick, or "warming up" until 10 tasks have resolved and the floor applies.
 */
function Sla() {
  const L = useLayout(), d = L.kind === 'desktop', n = L.N;
  const shell = useShell();
  const rewards = useGameSelector(() => shell.store.getState().roundRewards.pending.length, Object.is, 100);
  const g = useGameSelector(s => ({ phase: s.round.state, percent: s.hud.sla.percent, met: s.hud.sla.met, failed: s.hud.sla.failed,
    checking: s.hud.sla.checking, round: s.hud.roundIndex, seconds: Math.floor(s.hud.roundElapsedMs / 1000) }), shallowEqual, 250);
  const tone = !g.checking ? 'mute' : g.percent >= 90 ? 'ok' : g.percent >= 80 ? 'warn' : 'bad';
  // Short words, so the label keeps its reserved width beside End round (QA-16).
  const when = g.phase === 'running' ? clockText(g.seconds * 1000) : g.phase === 'ended' ? 'over' : 'break';
  const counts = `${g.met} / ${g.met + g.failed}`, meterW = 32 * n;
  // Where the band is narrow (End round beside it), the meter gives way first; the percent carries the same reading.
  const roundW = (d ? 7 : 2) * L.body + 28;
  const fixedW = 2.2 * L.body + 3.4 * L.big + roundW + 3 * 8;
  const showCounts = fixedW + 3.6 * L.body + 8 <= L.sla.w;
  const roomy = fixedW + (showCounts ? 3.6 * L.body + 8 : 0) + meterW + 8 <= L.sla.w;
  // Reserved widths ("100.0%", "50 / 50", the meter, "R99 · 1:59:59"), so nothing moves while the numbers change.
  return <span className="figrow sla" role="status" aria-label={`SLA ${slaText(g.percent)}, ${counts} completed, round ${g.round}, ${when}`} data-testid="sla-gauge"
    title="Completed tasks out of the last 50 resolved. Below 80% ends the round after 10 tasks. Dismissals do not count."
    style={{ left: L.sla.x, top: L.sla.y, width: L.sla.w, height: d ? L.sla.h : 32, justifyContent: 'center' }}>
    <span className="mute">SLA</span>
    <b className={`fig big ${tone}`} data-testid="sla" style={{ minWidth: 3.4 * L.big, textAlign: 'right' }}>{slaText(g.percent)}</b>
    {showCounts && <span className="mute" data-testid="sla-counts" style={{ minWidth: 3.6 * L.body, textAlign: 'center' }}>{counts}</span>}
    {!roomy ? null : g.checking
      ? <i className="g-meter hud-meter" data-free="art" aria-hidden="true" title="80% ends the round" style={{ flex: 'none', width: meterW, height: 2 * n }}>
        <b style={{ width: `${slaFill(g.percent).toFixed(1)}%` }} /><em style={{ top: -n, height: 4 * n, width: n }} /></i>
      : <span className="dim" data-testid="sla-warming" style={{ width: meterW, textAlign: 'center' }} title="The 80% floor applies after 10 tasks">warming up</span>}
    <button type="button" className="round-rewards-key" data-testid="round-rewards-key" style={{ width: roundW }}
      aria-label={`Round ${g.round}, ${rewards} rewards ready. Open round rewards.`} onClick={() => shell.view.dispatch({ type: 'openRoundRewards' })}>
      <span data-testid="round">{d ? `R${g.round} · ${when}` : `R${g.round}`}</span>
      <b className={`round-rewards-badge${rewards ? '' : ' empty'}`} data-testid="round-rewards-count">{rewards > 99 ? '99+' : rewards}</b>
    </button>
  </span>;
}

/** How long the armed End round key waits for the second tap. */
export const END_CONFIRM_MS = 3000;

/** End round (spec §4.1): two taps within 3 s. Reserved in every phase; it only works while a round runs. */
function EndRound() {
  const L = useLayout(), shell = useShell(), k = L.endKey;
  const phase = useGameSelector(s => s.round.state), running = phase === 'running', canReturn = useGameSelector(s => s.round.canReturn);
  const [armed, setArmed] = useState(false), timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => { if (!running) { clearTimeout(timer.current); setArmed(false); } }, [running]);
  const press = () => {
    clearTimeout(timer.current);
    if (!armed) { setArmed(true); timer.current = setTimeout(() => setArmed(false), END_CONFIRM_MS); return; }
    setArmed(false);
    shell.dispatch({ type: 'endRound' });
  };
  // Out of a round the same key (same box) is Return to market, as the head card's key (user, 26 Oct).
  if (phase === 'ended') return <button type="button" className="skey end-round" style={box(k)} disabled data-testid="end-round">End round</button>;
  if (!running) return <button type="button" className="skey end-round" style={box(k)} disabled={!canReturn} data-testid="end-round"
    data-qa-target={k.h >= 44 ? "" : undefined} aria-label="Return to market" onPointerDown={e => e.stopPropagation()} onClick={() => returnToMarket(shell)}>Return</button>;
  return <button type="button" className={`skey end-round ${armed ? 'warn two' : ''}`} style={box(k)} data-testid="end-round"
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
    <NetIncome />
  </header>;
}
