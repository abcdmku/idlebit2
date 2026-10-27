// Round over: an in-world plate over the paused, veiled world (program §12). It leads with the reach
// against the frontier (D40: tasks done, the goal ruler, the best and the next era), then the details:
// end reason, Net and Data against the last round, earned, energy, counts, causes (all seven, zeros
// dimmed so the grid never moves), failures by type. One Return to market key. Closing it dismisses the report.
import { useEffect, useLayoutEffect, useRef, type CSSProperties } from 'react';
import { FAIL_CAUSES, formatOps } from '../game';
import type { EnergyBreakdown, FailCause, RoundEndedBy, RoundReport, RoundTypeTally } from '../game';
import { P, drawCause, typeColor, typeName } from '../render/core';
import { CoinIcon } from './plates/icons';
import { AutoReturnControl } from './AutoReturnControl';
import { useDialogFocus } from './hooks/useDialogFocus';
import { CAUSE_NAME } from './hooks/feedModel';
import { amountText, clockText, wholeText } from './hooks/format';
import { returnToMarket } from './input/commands';
import type { ShellLayout } from './layout';
import { useLayout } from './shell/geometry';
import { useGameSelector, useShell } from './storeHooks';
import { GoalBar, GoalRows, ReachDetails, reportBadge, RunwayValue } from './frontier/Reach';
import { useRunway } from './frontier/Runway';

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

/** Where the plate sits: centred over the free world; on phone below the queue strip, clear of the head (A15). */
function plateStyle(L: ShellLayout): CSSProperties {
  const v = L.kind === 'desktop' ? L.lab : L.view, gap = L.kind === 'desktop' ? L.lat : 8;
  return L.kind === 'desktop'
    ? { left: v.x + v.w / 2, top: v.y + v.h / 2, transform: 'translate(-50%, -50%)', maxHeight: v.h - 2 * gap }
    : { left: v.x + v.w / 2, top: v.y + gap, transform: 'translateX(-50%)', maxHeight: v.h - 2 * gap };
}

export function RoundReportPlate({ report, onReturn, onClose }: {
  report: RoundReport; onReturn: () => void; onClose: () => void;
}) {
  const ref = useRef<HTMLElement>(null), contentRef = useRef<HTMLDivElement>(null), L = useLayout();
  const shell = useShell();
  useDialogFocus(ref, onClose);
  const updateMore = () => {
    const root = ref.current, body = contentRef.current;
    if (!root || !body) return;
    const css = getComputedStyle(root), keys = root.querySelector<HTMLElement>('.keys');
    const fullHeight = (root.querySelector<HTMLElement>('.p-head')?.offsetHeight ?? 0) + body.scrollHeight
      + (keys?.offsetHeight ?? 0) + parseFloat(css.paddingTop) + parseFloat(css.paddingBottom);
    root.dataset.scrollable = String(fullHeight > parseFloat(css.maxHeight) + 2);
    root.dataset.more = String(body.scrollHeight - body.scrollTop - body.clientHeight > 2);
  };
  useLayoutEffect(() => {
    updateMore();
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateMore);
    if (contentRef.current) ro?.observe(contentRef.current);
    contentRef.current?.addEventListener('toggle', updateMore, true);
    const keys = ref.current?.querySelector('.keys');
    if (keys) ro?.observe(keys);
    const body = contentRef.current;
    return () => { ro?.disconnect(); body?.removeEventListener('toggle', updateMore, true); };
  }, [L, report]);
  const failed = FAIL_CAUSES.reduce((sum, c) => sum + report.failedByCause[c], 0);
  const chips = failedByType(report.byType ?? []);
  const energy = report.energy ?? null;
  const prev = shell.store.getState().round.reports.find(r => r.index === report.index - 1) ?? null;
  const eras = useRunway().eras, badge = reportBadge(report);
  return <section ref={ref} className="v3-plate round-plate has-x" role="dialog" aria-modal="true" aria-label="Round over" tabIndex={-1}
    data-testid="round-plate" style={plateStyle(L)} onPointerDown={e => e.stopPropagation()} onWheel={e => e.stopPropagation()}>
    <header className="p-head">
      <b className="p-title">Round {report.index} over</b>
      <span className="p-sub">{clockText(report.durationMs)}</span>
      {badge && <span className="rp-badge" data-testid="rp-badge">{badge}</span>}
      <button type="button" className="p-x" aria-label="Close report" onClick={onClose}>
        <i className="x-glyph" aria-hidden="true" style={{ width: 12, height: 12, '--x-w': '1px' } as CSSProperties} /></button>
    </header>
    <div className="round-content" ref={contentRef} onScroll={updateMore}>
    {/* D40: progress shows here only: the reach, its bar over the bands with the best before, and what is next. */}
    <p className="rp-reach" data-testid="rp-reach"><b className="rp-big">{wholeText(report.met)}</b> <span className="mute">tasks done this round</span></p>
    <GoalBar report={report} />
    <ul className="p-list rp-next">
      <GoalRows report={report} />
      {(report.frontier.runwayStart || report.frontier.runwayEnd) && <li data-testid="rp-runway"><span className="mute">Next era</span>
        <span className="v"><RunwayValue start={report.frontier.runwayStart} end={report.frontier.runwayEnd} eras={eras} /></span></li>}
    </ul>
    <details className="round-details"><summary>Round details</summary>
    <p className="mute">{ENDED_BY[report.endedBy]}</p>
    <ReachDetails report={report} prev={prev} />
    <ul className="p-list rp-bottom">
      <li><span>Earned</span><span className="v gold"><CoinIcon />{amountText(report.gross)}</span></li>
      {energy !== null && <li><span>Energy</span><span className="v mute" data-testid="rp-energy">−<CoinIcon />{amountText(energy)}</span></li>}
    </ul>
    {/* D28: the whole round's counts. Dismissed tasks never count toward SLA; this is the one place they show. */}
    <ul className="p-list rp-top">
      <li className="bad"><span>Failed</span><span className="v" data-testid="rp-failed">{wholeText(failed)}</span></li>
      <li><span>Dismissed</span><span className="v" data-testid="rp-dismissed">{wholeText(report.dismissed)}</span></li>
    </ul>
    <div className="rp-causes">
      {FAIL_CAUSES.map(c => {
        const k = report.failedByCause[c];
        return <span key={c} className={`rp-c${k ? '' : ' zero'}`} data-cause={c}>
          <CauseIcon cause={c} lit={k > 0} /><span className="k">{CAUSE_NAME[c]}</span><span className="v">{wholeText(k)}</span>
        </span>;
      })}
    </div>
    <p className="rp-spill mute" data-testid="rp-spill">Peak intensity {report.peakIntensity.toFixed(1)}{report.spill.diskWork > 0 ? ` · ${spillLine(report)}` : ''}</p>
    <p className="rp-types" data-testid="rp-types"><span className="mute">Failed by type</span>
      {chips.length ? chips.map(c => <span key={c.type} className="rp-chip" data-task-type={c.type}>
        <b style={{ color: typeColor(c.type) }}>{typeName(c.type)}</b> {c.text}</span>) : <span className="dim"> none</span>}</p>
    {/* D31: where the energy came from. Unbilled lines read as saved; billed ones as spent. */}
    {energyLines(report.energyBreakdown).length > 0 && <ul className="p-list rp-bottom rp-energy" data-testid="rp-energy-lines">
      {energyLines(report.energyBreakdown).map(l => <li key={l.key} data-line={l.key}><span>{l.label}</span>
        <span className={`v ${l.paid ? 'mute' : 'ben'}`}>{l.paid ? '−' : ''}<CoinIcon />{amountText(report.energyBreakdown[l.key])}{l.paid ? '' : ' saved'}</span></li>)}
    </ul>}
    </details>
    </div>
    <div className="report-more" aria-hidden="true">More ↓</div>
    <div className="keys">
      <AutoReturnControl />
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
  if (!r) return null;
  return <RoundReportPlate report={r}
    onReturn={() => returnToMarket(shell)} onClose={() => shell.dispatch({ type: 'dismissReport' })} />;
}
