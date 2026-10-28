// The band: the level ladder at the left (and its name on desktop), SLA in the centre at the big size
// with its task ratio and reward milestone, and Data over Credits stacked at the right (user, 25 Oct:
// SLA is very important). It overlays the world's top edge. Every element keeps its box while its text
// updates in place; currencies are whole numbers (D2.2, D3.3). On phone the pressed rung names the
// level and the icons name the currencies.
import { ORDER, SPR } from '../render/core';
import type { LevelId } from '../game';
import { ArtCanvas } from './art/ArtCanvas';
import { useEffect, useRef, useState } from 'react';
import { amountText, wholeText } from './hooks/format';
import { box, useLayout } from './shell/geometry';
import { shallowEqual, useGameSelector, useShell, useViewState } from './storeHooks';
import { LEVEL_NAMES } from './viewState';
import { returnToMarket } from './input/commands';
import { CoinIcon } from './plates/icons';
import { Sla } from './hud/Sla';
import { useNewLevels } from './hud/useNewLevels';

/** The ladder lists the deepest level first: CPU, System, Rack, Room, Global. */
const LADDER: readonly LevelId[] = [...ORDER];

export function CurrencyIcon({ kind, n }: { kind: 'credits' | 'data'; n: number }) {
  return <ArtCanvas w={8} h={8} n={n} artKey={kind} className={`cur-ic ${kind}`}
    draw={g => { g.clearRect(0, 0, 8, 8); g.drawImage(kind === 'credits' ? SPR.coin8 : SPR.gem8, 0, 0); }} />;
}

function Ladder() {
  const L = useLayout(), { view, registry } = useShell(), state = useViewState();
  const unlocked = useGameSelector(s => s.unlocked, shallowEqual);
  const newLevels = useNewLevels();
  const target = state.goal ?? state.focus.level;
  return <div className="ladder" role="group" aria-label="Zoom level">
    {LADDER.map((level, i) => {
      const open = unlocked[level] || level === state.focus.level;
      return <button key={level} type="button" className={`rung${open ? '' : ' locked'}${newLevels.has(level) ? ' newly-unlocked' : ''}`} data-level={level} style={box(L.rungs[i]!)}
        aria-pressed={level === target} title={open ? LEVEL_NAMES[level] : `${LEVEL_NAMES[level]}: opens with research`}
        aria-label={open ? `${LEVEL_NAMES[level]}${newLevels.has(level) ? ', newly unlocked' : ''}` : `${LEVEL_NAMES[level]}, locked. Opens research.`} data-qa-target={L.kind === 'phone' ? '' : undefined}
        onClick={() => view.dispatch(open ? { type: 'zoomTo', level } : { type: 'openResearch' })}>
        <ArtCanvas w={16} h={16} n={L.N} style={{ margin: (L.rungs[i]!.w - 16 * L.N) / 2 }} artKey={`${level}:${registry.has(level)}`}
          draw={g => { g.clearRect(0, 0, 16, 16); if (registry.has(level)) registry.level(level).icon(g); }} />
      </button>;
    })}
    {L.kind === 'desktop' && <span className="rung-label" style={{ ...box(L.rungLabel), lineHeight: `${L.lh}px` }} data-testid="place">
      <b>{state.focus.level === 'chip' ? `CPU ${(state.focus.socket ?? 0) + 1}` : LEVEL_NAMES[state.focus.level]}</b></span>}
  </div>;
}

function NetIncome() {
  const L = useLayout();
  const { net, live } = useGameSelector(s => {
    const report = s.round.lastReport, live = s.round.state === 'running';
    const net = !live && report && report.durationMs > 0
      ? (BigInt(report.net) * 60000n / BigInt(report.durationMs)).toString() as typeof s.hud.netPerMinute : s.hud.netPerMinute;
    return { net, live };
  }, shallowEqual, 500);
  const text = `${BigInt(net) > 0n ? '+' : ''}${amountText(net)}/min`;
  if (L.kind !== 'desktop') return null;
  const at = { x: L.rungLabel.x, y: L.rungLabel.y + L.lh, w: L.rungLabel.w, h: L.lh };
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

/** How long the armed End round key waits for the second tap. */
export const END_CONFIRM_MS = 3000;

/** End round (spec §4.1): two taps within 3 s. Reserved in every phase; it only works while a round runs. */
function EndRound() {
  const L = useLayout(), shell = useShell(), k = L.endKey;
  const phase = useGameSelector(s => s.round.state), running = phase === 'running', canReturn = useGameSelector(s => s.round.canReturn);
  const compact = k.w < 64;
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
  if (phase === 'ended') return <button type="button" className="skey end-round" style={box(k)} disabled data-testid="end-round" aria-label="End round">{compact ? 'End' : 'End round'}</button>;
  if (!running) return <button type="button" className="skey end-round" style={box(k)} disabled={!canReturn} data-testid="end-round"
    data-qa-target={k.h >= 44 ? "" : undefined} aria-label="Return to market" onPointerDown={e => e.stopPropagation()} onClick={() => returnToMarket(shell)}>Return</button>;
  return <button type="button" className={`skey end-round ${armed ? 'warn two' : ''}`} style={box(k)} data-testid="end-round"
    data-qa-target={k.h >= 44 ? "" : undefined} aria-label={armed ? "End round? Tap again" : "End round"} onPointerDown={e => e.stopPropagation()} onClick={press}>
    {armed ? <><span>{compact ? 'End?' : 'End round?'}</span><span>{compact ? 'Again' : 'Tap again'}</span></> : compact ? 'End' : 'End round'}</button>;
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
