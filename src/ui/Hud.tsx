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
import { hasTaskDock } from './layout';
import { box, useLayout } from './shell/geometry';
import { shallowEqual, useGameSelector, useShell, useViewState } from './storeHooks';
import { LEVEL_NAMES } from './viewState';
import { returnToMarket } from './input/commands';
import { CoinIcon } from './plates/icons';
import { Sla } from './hud/Sla';
import { useNewLevels } from './hud/useNewLevels';
import { useFleetFaults } from './health/useFleetHealth';
import { efficiencyText, rateText, ratesWords, useRates } from './hud/rates';

/** The ladder lists the deepest level first: CPU, System, Rack, Room, Global. */
const LADDER: readonly LevelId[] = [...ORDER];

export function CurrencyIcon({ kind, n }: { kind: 'credits' | 'data'; n: number }) {
  return <ArtCanvas w={8} h={8} n={n} artKey={kind} className={`cur-ic ${kind}`}
    draw={g => { g.clearRect(0, 0, 8, 8); g.drawImage(kind === 'credits' ? SPR.coin8 : SPR.gem8, 0, 0); }} />;
}

function Ladder() {
  const L = useLayout(), { view, registry } = useShell(), state = useViewState();
  const unlocked = useGameSelector(s => s.unlocked, shallowEqual);
  const newLevels = useNewLevels(), faults = useFleetFaults().levels;
  const target = state.goal ?? state.focus.level;
  // The rungs share one box on the 8 px grid; inside it each keeps its own width (44 px on a 320 px phone).
  const first = L.rungs[0], last = L.rungs[4], slim = first.w % 8 !== 0;
  const row = { x: first.x, y: first.y, w: Math.ceil((last.x + last.w - first.x) / 8) * 8, h: first.h };
  return <div className="ladder" role="group" aria-label="Zoom level">
    <div className="rungs" style={box(row)}>{LADDER.map((level, i) => {
      const open = unlocked[level] || level === state.focus.level;
      return <button key={level} type="button" className={`rung${open ? '' : ' locked'}${newLevels.has(level) ? ' newly-unlocked' : ''}`} data-level={level}
        style={{ width: L.rungs[i]!.w, height: L.rungs[i]!.h }}
        aria-pressed={level === target} title={open ? LEVEL_NAMES[level] : `${LEVEL_NAMES[level]}: opens with research`}
        aria-label={open ? `${LEVEL_NAMES[level]}${newLevels.has(level) ? ', newly unlocked' : ''}` : `${LEVEL_NAMES[level]}, locked. Opens research.`} data-qa-target={L.kind === 'phone' ? '' : undefined}
        onClick={() => view.dispatch(open ? { type: 'zoomTo', level } : { type: 'openResearch' })}>
        <ArtCanvas w={16} h={16} n={L.N} style={{ margin: (L.rungs[i]!.w - 16 * L.N) / 2 }} artKey={`${level}:${registry.has(level)}`}
          draw={g => { g.clearRect(0, 0, 16, 16); if (registry.has(level)) registry.level(level).icon(g); }} />
        {faults[level] && <i className={`rung-fault ${faults[level]}`} data-testid="rung-fault" data-free={slim ? 'art' : undefined} aria-hidden="true" />}
      </button>;
    })}</div>
    {L.kind === 'desktop' && <span className="rung-label" style={{ ...box(L.rungLabel), lineHeight: `${L.lh}px` }} data-testid="place">
      <b>{state.focus.level === 'chip' ? `CPU ${(state.focus.socket ?? 0) + 1}` : LEVEL_NAMES[state.focus.level]}</b></span>}
  </div>;
}

/** D90: the share of work value kept after energy, under the level name. Out of a round it is the last round's. */
function Efficiency() {
  const L = useLayout(), r = useRates();
  if (L.kind !== 'desktop' || !r) return null;
  const at = { x: L.rungLabel.x, y: L.rungLabel.y + L.lh, w: L.rungLabel.w, h: L.lh };
  const text = efficiencyText(r.efficiency);
  return <span className={`t clip${r.efficiency !== null && r.efficiency < 0 ? ' bad' : ''}`} style={box(at)} data-testid="efficiency"
    title={r.live ? 'Share of work value kept after energy, over the last 2 seconds' : 'Share of work value kept after energy, last round'}
    aria-label={`${r.live ? 'Efficiency' : 'Last round efficiency'} ${text}`}><span className="mute">{r.live ? 'Efficiency' : 'Last round'}</span> {text}</span>;
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

/**
 * Data over Credits at the band's right (user, 25 Oct), the same size, as one key that opens the currency
 * history. The key has no face or rim: the figures stand on the band, right-aligned in a fixed slot, so nothing
 * shifts. Negative Credits turn red and name the state: the history it opens holds bankruptcy (spec §11.4).
 */
function Wallet() {
  const L = useLayout(), spent = useSpent(), d = L.kind === 'desktop';
  const { view } = useShell(), rates = useRates();
  const w = useGameSelector(s => ({ credits: s.hud.credits, data: s.hud.data }), shallowEqual, 100);
  // The slot's width picks the dress, never the game state: header-size figures under 88 px, and under 64 px the
  // figures alone, in their colours.
  const box0 = L.wallet, bare = box0.w < 64, snug = box0.w < 88, debt = w.credits.startsWith('-');
  const credits = amountText(w.credits), data = amountText(w.data);
  return <button type="button" className={`wallet-key${debt ? ' debt' : ''}${bare ? ' bare' : snug ? ' snug' : ''}`} data-qa-target
    style={{ right: L.w - (box0.x + box0.w), top: box0.y + (d ? Math.max(0, (box0.h - 48) / 2) : 0), height: Math.min(48, box0.h), width: box0.w }}
    aria-label={`${data} Data, ${credits} Credits${debt ? ', in debt' : ''}. ${d && rates ? ratesWords(rates) + '. ' : ''}View history${debt ? ' and bankruptcy' : ''}`} aria-haspopup="dialog"
    onClick={() => view.dispatch({ type: 'toggleSheet', sheet: 'creditsHistory' })}>
    <span className="wallet-row">
      {!bare && <CurrencyIcon kind="data" n={L.N} />}<b className="fig mid data" data-testid="data">{data}</b>{d && <span className="wallet-label data" data-testid="data-rate">{rates ? rateText(rates.dataPerSec) : ''}</span>}
    </span>
    <span className="wallet-row">
      {debt && !d && box0.w >= 128 && <span className="wallet-debt">Debt</span>}
      {!bare && <CurrencyIcon kind="credits" n={L.N} />}<b className="fig mid gold" data-testid="credits">{credits}</b>
      {d && <span className={`wallet-label ${rates && rates.creditsPerSec < 0 ? 'bad' : 'gold'}`} data-testid="credits-rate">{rates ? rateText(rates.creditsPerSec) : ''}</span>}
    </span>
    {spent !== null && <span className="wallet-spent dim" data-testid="spent">−<CoinIcon />{wholeText(spent)}</span>}
  </button>;
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
  if (phase === 'ended') return <button type="button" className={`skey end-round${compact ? ' compact' : ''}`} style={box(k)} disabled data-testid="end-round" aria-label="End round"><span className="end-round-label">End round</span></button>;
  if (!running) return <button type="button" className={`skey end-round${compact ? ' compact' : ''}`} style={box(k)} disabled={!canReturn} data-testid="end-round"
    data-qa-target={k.h >= 44 ? "" : undefined} aria-label="Return to market" onPointerDown={e => e.stopPropagation()} onClick={() => returnToMarket(shell)}><span className="end-round-label">Return</span></button>;
  return <button type="button" className={`skey end-round${compact ? ' compact' : ''}${armed ? ' warn' : ''}`} style={box(k)} data-testid="end-round"
    data-qa-target={k.h >= 44 ? "" : undefined} aria-label={armed ? "End round? Tap again" : "End round"} onPointerDown={e => e.stopPropagation()} onClick={press}>
    <span className="end-round-label">{armed ? 'End round?' : 'End round'}</span></button>;
}

export function Hud() {
  const L = useLayout();
  // Landscape: the band heads the left column, clear of the world, so it needs no backing or rules.
  return <header className={`band${L.kind === 'phone' && !hasTaskDock(L) ? ' side' : ''}`} aria-label="Status">
    <div className="band-bg" style={box(L.band)} />
    <Ladder />
    <Sla />
    <EndRound />
    <Wallet />
    <Efficiency />
  </header>;
}
