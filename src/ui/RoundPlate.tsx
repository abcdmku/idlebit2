// Round over: an in-world plate over the paused, veiled world (program §12, mockup
// core/round-plate.js). Duration, SLA, met, failed by cause (all six, zeros dimmed so the grid
// never moves), the top failure details (D5.3), the fix for the top one with an inline Buy (A02,
// D20.3), failures by task type, Credits and Data earned, energy and net (spec §4.7), and one
// Return to market key. Closing it dismisses the report; the head's key then returns.
import { useContext, useEffect, useRef, type CSSProperties } from 'react';
import { FAIL_CAUSES, formatOps } from '../game';
import type { EnergyBreakdown, FailCause, FailDetail, RoundEndedBy, RoundReport, RoundTypeTally } from '../game';
import { P, drawCause, typeColor, typeName } from '../render/core';
import { ArtCanvas } from './art/ArtCanvas';
import { drawMiniIcon } from './art/deckArt';
import { OffersContext } from './deck/useOffers';
import { actionable, WALL_ROWS, type Offer, type Offers } from './deck/offers';
import { offerAction, PriceText, RightText } from './deck/offerUi';
import { CurrencyIcon } from './Hud';
import { useDialogFocus } from './hooks/useDialogFocus';
import { CAUSE_NAME, causeLine } from './hooks/feedModel';
import { amountText, clockText, slaFill, slaText, wholeText } from './hooks/format';
import { returnToMarket } from './input/commands';
import type { ShellLayout } from './layout';
import { useLayout } from './shell/geometry';
import { useGameSelector, useShell } from './storeHooks';

/** The SLA over the 60–100% band, so the 80% floor sits at the middle. */
export function SlaMeter({ percent }: { percent: number }) {
  return <i className="g-meter" aria-hidden="true"><b style={{ width: `${slaFill(percent).toFixed(1)}%` }} /><em /></i>;
}

function CauseIcon({ cause, lit }: { cause: FailCause; lit: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const g = ref.current?.getContext('2d');
    if (!g) return;
    g.imageSmoothingEnabled = false; g.fillStyle = P.ink; g.fillRect(0, 0, 7, 7);
    drawCause(g, cause, 1, 1, lit ? P.fault : P.silkLo);
  }, [cause, lit]);
  return <canvas ref={ref} width={7} height={7} aria-hidden="true" />;
}

/** "Can't run · cache ×2": the two most common (cause, detail) pairs, or a dash. Reserved one line either way. */
export function detailLine(report: RoundReport): string {
  const pairs = report.details.length ? report.details.slice(0, 2) : FAIL_CAUSES.filter(c => report.failedByCause[c] > 0)
    .sort((a, b) => report.failedByCause[b] - report.failedByCause[a]).slice(0, 2).map(c => ({ cause: c, detail: null, count: report.failedByCause[c] }));
  const top = pairs.map(d => `${causeLine(d.cause, d.detail)} ×${wholeText(d.count)}`);
  return top.length ? top.join(' · ') : '—';
}

/**
 * The build rows that answer a failure detail, best first, on the level the player is looking at.
 * Spill (D26): more RAM keeps work off the disk; a faster drive makes what still spills quicker.
 */
/** A timeout is too little speed: the clock on a CPU, the CPU on a system. */
const SLOW_ROWS = ['clock', 'cpu', 'core'];

/** The offer that fixes the round's top failure (A02), or null. */
export function fixOffer(report: RoundReport, offers: Offers | null): Offer | null {
  const top = report.details[0] ?? topCause(report);
  if (!top || !offers) return null;
  // Work that ran mostly from disk was slow because RAM was short (D26.2): a timeout or a late task is fixed by RAM first.
  const spilled = report.spill && report.deliveredWork > 0 && report.spill.diskWork / report.deliveredWork >= 0.25;
  const slow = top.cause === 'timeout' || top.cause === 'late';
  const keys = top.detail && WALL_ROWS[top.detail] ? WALL_ROWS[top.detail]!
    : slow ? (spilled || top.cause === 'late' ? ['ram', 'storage', ...SLOW_ROWS] : SLOW_ROWS) : [];
  // Never a dead end (QA-05): a maxed part or a lock with no research behind it is no fix.
  for (const k of keys) { const o = offers.rows.find(r => r.key === k && actionable(r)); if (o) return o; }
  return null;
}

/** The cause with the most failures, when the sim recorded no detail pairs. */
function topCause(report: RoundReport): { cause: FailCause; detail: FailDetail | null; count: number } | null {
  let best: FailCause | null = null;
  for (const c of FAIL_CAUSES) if (report.failedByCause[c] > 0 && (best === null || report.failedByCause[c] > report.failedByCause[best])) best = c;
  return best ? { cause: best, detail: null, count: report.failedByCause[best] } : null;
}

/** "From disk: 18% of work · RAM 40%": where met work's memory traffic ran (D26.7). Reserved one line. */
export function spillLine(report: RoundReport): string {
  const total = report.deliveredWork, sp = report.spill;
  if (!sp || total <= 0) return 'From disk: 0% of work';
  const pct = (w: number) => `${Math.round(w / total * 100)}%`;
  return `From disk: ${pct(sp.diskWork)} of work${sp.ramWork > 0 ? ` · RAM ${pct(sp.ramWork)}` : ''}`;
}

/** Failed tasks (or failed work, until the sim counts tasks per type) for each type that failed. */
function failedByType(rows: readonly RoundTypeTally[]): { type: RoundTypeTally['type']; text: string }[] {
  return rows.flatMap(r => {
    const count = (r as RoundTypeTally & { failed?: number }).failed;
    if (count !== undefined) return count > 0 ? [{ type: r.type, text: wholeText(count) }] : [];
    return r.failedWork > 0 ? [{ type: r.type, text: formatOps(r.failedWork) }] : [];
  });
}

function FixLine({ offer, n }: { offer: Offer | null; n: number }) {
  const shell = useShell(), act = offer ? offerAction(offer) : null;
  if (!offer) return <div className="rp-fix" data-testid="rp-fix"><span className="dim">Fix: —</span></div>;
  return <div className="rp-fix" data-testid="rp-fix">
    <ArtCanvas w={8} h={8} n={n} artKey={`fix:${offer.icon}:${offer.affordable}`} draw={g => drawMiniIcon(g, offer.icon, !offer.affordable)} />
    <span className="rp-fix-t"><b>{offer.name}</b> <span className="mute">{offer.change}</span></span>
    <span className="v">{offer.price !== null ? <PriceText offer={offer} n={n} /> : <RightText offer={offer} n={n} />}</span>
    {act && <button type="button" className={`key${offer.affordable ? '' : ' ghost'}`} data-testid="rp-fix-buy"
      onClick={() => { if ('action' in act) shell.dispatch(act.action); else shell.view.dispatch({ type: 'openResearch', project: act.research.node }); }}>
      {'action' in act ? 'Buy' : 'Research'}</button>}
  </div>;
}

/** Where the plate sits: centred over the free world; on phone below the queue strip, clear of the head (A15). */
function plateStyle(L: ShellLayout): CSSProperties {
  const v = L.view, gap = L.kind === 'desktop' ? L.lat : 8;
  return L.kind === 'desktop'
    ? { left: v.x + v.w / 2, top: v.y + v.h / 2, transform: 'translate(-50%, -50%)', maxHeight: v.h - 2 * gap }
    : { left: v.x + v.w / 2, top: v.y + gap, transform: 'translateX(-50%)', maxHeight: v.h - 2 * gap };
}

export function RoundReportPlate({ report, percent, onReturn, onClose }: {
  report: RoundReport; percent: number; onReturn: () => void; onClose: () => void;
}) {
  const ref = useRef<HTMLElement>(null), L = useLayout(), n = L.N, offers = useContext(OffersContext);
  useDialogFocus(ref, onClose);
  const failed = FAIL_CAUSES.reduce((sum, c) => sum + report.failedByCause[c], 0);
  const chips = failedByType(report.byType ?? []);
  const energy = report.energy ?? null, net = report.net ?? null;
  return <section ref={ref} className="v3-plate round-plate has-x" role="dialog" aria-modal="true" aria-label="Round over" tabIndex={-1}
    data-testid="round-plate" style={{ ...plateStyle(L), overflowY: 'auto' }} onPointerDown={e => e.stopPropagation()} onWheel={e => e.stopPropagation()}>
    <header className="p-head">
      <b className="p-title">Round over</b>
      <span className="p-sub">Round {report.index} · {clockText(report.durationMs)} · {ENDED_BY[report.endedBy]}</span>
      <button type="button" className="p-x" aria-label="Close report" onClick={onClose}>
        <i className="x-glyph" aria-hidden="true" style={{ width: 12, height: 12, '--x-w': '1px' } as CSSProperties} /></button>
    </header>
    <div className="rp-sla"><span className="rp-k">SLA</span><span className="rp-v">{slaText(percent)}</span><SlaMeter percent={percent} /></div>
    {/* D28: the whole round's counts. Dismissed tasks never count toward SLA; this is the one place they show. */}
    <ul className="p-list rp-top">
      <li><span>Completed</span><span className="v" data-testid="rp-met">{wholeText(report.met)}</span></li>
      <li className="bad"><span>Failed</span><span className="v" data-testid="rp-failed">{wholeText(failed)}</span></li>
      <li><span>Dismissed</span><span className="v mute" data-testid="rp-dismissed">{wholeText(report.dismissed)}</span></li>
    </ul>
    <div className="rp-causes">
      {FAIL_CAUSES.map(c => {
        const k = report.failedByCause[c];
        return <span key={c} className={`rp-c${k ? '' : ' zero'}`} data-cause={c}>
          <CauseIcon cause={c} lit={k > 0} /><span className="k">{CAUSE_NAME[c]}</span><span className="v">{wholeText(k)}</span>
        </span>;
      })}
    </div>
    <p className="rp-detail" data-testid="rp-detail">{detailLine(report)}</p>
    <FixLine offer={fixOffer(report, offers)} n={n} />
    <p className="rp-spill mute" data-testid="rp-spill">{spillLine(report)}</p>
    <p className="rp-types" data-testid="rp-types"><span className="mute">Failed:</span>
      {chips.length ? chips.map(c => <span key={c.type} className="rp-chip" data-task-type={c.type}>
        <b style={{ color: typeColor(c.type) }}>{typeName(c.type)}</b> {c.text}</span>) : <span className="dim"> none</span>}</p>
    {/* Earned, energy and net as a 2 × 2 grid, so the plate fits the view with its Return key in sight. */}
    <ul className="p-list rp-bottom">
      <li><span>Credits earned</span><span className="v gold"><CurrencyIcon kind="credits" n={n} />{amountText(report.gross)}</span></li>
      <li><span>Data earned</span><span className="v data"><CurrencyIcon kind="data" n={n} />{amountText(report.data)}</span></li>
      {energy !== null && <li><span>Energy</span><span className="v mute" data-testid="rp-energy">−<CurrencyIcon kind="credits" n={n} />{amountText(energy)}</span></li>}
      {net !== null && <li><span>Net</span><span className="v gold" data-testid="rp-net"><CurrencyIcon kind="credits" n={n} />{amountText(net)}</span></li>}
    </ul>
    {/* D31: where the energy came from. Unbilled lines read as saved; billed ones as spent. */}
    {energyLines(report.energyBreakdown).length > 0 && <ul className="p-list rp-bottom rp-energy" data-testid="rp-energy-lines">
      {energyLines(report.energyBreakdown).map(l => <li key={l.key} data-line={l.key}><span>{l.label}</span>
        <span className={`v ${l.paid ? 'mute' : 'ben'}`}>{l.paid ? '−' : ''}<CurrencyIcon kind="credits" n={n} />{amountText(report.energyBreakdown[l.key])}{l.paid ? '' : ' saved'}</span></li>)}
    </ul>}
    <div className="keys">
      <button type="button" className="key go" data-testid="rp-return" onClick={onReturn}>Return to market</button>
    </div>
  </section>;
}

/** Why the round ended, in the report's subtitle (spec §4.1, D33). */
export const ENDED_BY: Readonly<Record<RoundEndedBy, string>> = {
  sla: 'SLA under 80%', player: 'Ended by you', stall: 'Stalled · nothing completed for 2 min',
};

/** D31 energy lines: billed and paid (−), unbilled (saved by batteries and generation). */
const ENERGY_LINES: readonly { key: keyof EnergyBreakdown; label: string; paid: boolean }[] = [
  { key: 'billed', label: 'Billed', paid: true }, { key: 'fromBattery', label: 'From battery', paid: false },
  { key: 'batteryRefill', label: 'Battery refill', paid: true }, { key: 'fromGeneration', label: 'From generation', paid: false },
  { key: 'fuel', label: 'Fuel', paid: true },
];

/** The non-zero lines; none when the bill is the only one (the Energy line already says it). */
export function energyLines(e: EnergyBreakdown | null | undefined): typeof ENERGY_LINES {
  if (!e) return [];
  const lines = ENERGY_LINES.filter(l => Number(e[l.key]) !== 0);
  return lines.length === 1 && lines[0]!.key === 'billed' ? [] : lines;
}

/** Mounted by the shell: shows while the round state is `ended`. */
export function RoundPlate() {
  const shell = useShell();
  const r = useGameSelector(s => (s.round.state === 'ended' && s.round.lastReport ? s.round.lastReport : null));
  const percent = useGameSelector(s => s.hud.sla.percent);
  if (!r) return null;
  return <RoundReportPlate report={r} percent={percent}
    onReturn={() => returnToMarket(shell)} onClose={() => shell.dispatch({ type: 'dismissReport' })} />;
}
