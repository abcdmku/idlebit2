// Round over: a compact in-world report over the paused world. The main view is the goal ruler, Net and
// Data against the last round, auto return and Return to market. The Details key opens the rest in place:
// earned, energy, counts, causes (all seven, zeros dimmed so the grid never moves) and failures by type.
// The title names why the round ended. Closing it dismisses the report.
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { FAIL_CAUSES, formatOps } from '../game';
import type { EnergyBreakdown, FailCause, RoundReport, RoundTypeTally } from '../game';
import { P, drawCause, typeColor, typeName } from '../render/core';
import { CoinIcon } from './plates/icons';
import { AutoReturnControl } from './AutoReturnControl';
import { useDialogFocus } from './hooks/useDialogFocus';
import { CAUSE_NAME } from './hooks/feedModel';
import { amountText, wholeText } from './hooks/format';
import { returnToMarket } from './input/commands';
import type { ShellLayout } from './layout';
import { useLayout } from './shell/geometry';
import { useGameSelector, useOfflineStatus, useShell, useViewState } from './storeHooks';
import { offlineLayerUp } from './offline/OfflineLayer';
import { GoalBar, RoundTotals, reportBadge } from './frontier/Reach';

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

/**
 * Where the plate sits: on desktop the closed report is centred over the free world; on phone it hangs below
 * the queue strip, clear of the head (A15). Open, it grows downward from the same top edge, then rises only as
 * far as the details need: on desktop to the top of the sheet area, on a portrait phone over the queue strip.
 * What still does not fit scrolls inside.
 */
function plateStyle(L: ShellLayout, size: PlateSize | null): CSSProperties {
  const v = L.kind === 'desktop' ? L.lab : L.view, gap = L.kind === 'desktop' ? L.lat : 8;
  const closedTop = v.y + (L.kind === 'desktop' ? Math.max(gap, Math.floor((v.h - (size?.closed ?? v.h)) / 2)) : gap);
  // Portrait phone: the strip sits above the view in the same column, and an open report may cover it.
  const ceiling = (L.kind === 'phone' && L.strip.x === v.x ? L.strip.y : v.y) + gap;
  const top = size ? Math.max(ceiling, Math.min(closedTop, v.y + v.h - gap - size.full)) : closedTop;
  // Never wider than its view: in landscape the report stays clear of the left column.
  return { left: v.x + v.w / 2, top, transform: 'translateX(-50%)', maxWidth: v.w - 2 * gap, maxHeight: v.y + v.h - gap - top };
}

/** Why the round ended (spec §4.7), after "Round over": short enough for a 320 px report with the NEW BEST badge. */
const END_REASON: Readonly<Record<RoundReport['endedBy'], { text: string; label: string }>> = {
  sla: { text: 'SLA', label: 'SLA fell below 80%' }, player: { text: 'by you', label: 'ended by you' },
  stall: { text: 'stalled', label: 'no task completed for two minutes' },
};

/** The report's height with Details closed, and as it is now. */
interface PlateSize { readonly closed: number; readonly full: number }

/** Details stay as the player left them until the page reloads. */
let detailsOpen = false;

export function RoundReportPlate({ report, onReturn, onClose }: {
  report: RoundReport; onReturn: () => void; onClose: () => void;
}) {
  const ref = useRef<HTMLElement>(null), contentRef = useRef<HTMLDivElement>(null), L = useLayout();
  const shell = useShell();
  const [open, setOpen] = useState(detailsOpen), [size, setSize] = useState<PlateSize | null>(null);
  const toggle = () => { detailsOpen = !open; setOpen(detailsOpen); };
  useDialogFocus(ref, onClose);
  const updateMore = () => {
    const root = ref.current, body = contentRef.current;
    if (!root || !body) return;
    const css = getComputedStyle(root), keys = root.querySelector<HTMLElement>('.keys');
    const head = root.querySelector<HTMLElement>('.p-head')?.offsetHeight ?? 0;
    const chrome = head + (keys?.offsetHeight ?? 0) + parseFloat(css.paddingTop) + parseFloat(css.paddingBottom)
      + parseFloat(css.borderTopWidth) + parseFloat(css.borderBottomWidth);
    // The closed report's own height: everything above the details panel, measured even while it is open.
    const details = body.querySelector<HTMLElement>('.round-details');
    const full = Math.ceil(chrome + body.scrollHeight), closed = full - (details?.offsetHeight ?? 0);
    setSize(was => was && was.closed === closed && was.full === full ? was : { closed, full });
    root.dataset.scrollable = String(full > parseFloat(css.maxHeight) + 2);
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
  }, [L, report, open, size]);
  // Opening Details in a short plate brings its key to the top of the scroller, so the details show at once.
  useLayoutEffect(() => {
    const body = contentRef.current, key = body?.querySelector<HTMLElement>('.rp-details-key');
    if (body && key) body.scrollTop = open ? key.offsetTop - body.offsetTop : 0;
  }, [open, size]);
  const failed = FAIL_CAUSES.reduce((sum, c) => sum + report.failedByCause[c], 0);
  const chips = failedByType(report.byType ?? []);
  const energy = report.energy ?? null;
  const prev = shell.store.getState().round.reports.find(r => r.index === report.index - 1) ?? null;
  const badge = reportBadge(report), why = END_REASON[report.endedBy];
  return <section ref={ref} className="v3-plate round-plate has-x" role="dialog" aria-modal="true" aria-label={`Round over: ${why.label}`} tabIndex={-1}
    data-testid="round-plate" style={plateStyle(L, size)} onPointerDown={e => e.stopPropagation()} onWheel={e => e.stopPropagation()}>
    <header className="p-head">
      <b className="p-title">Round over<span className="rp-why" data-testid="rp-why" data-reason={report.endedBy} title={why.label}> · {why.text}</span></b>
      {badge && <span className="rp-badge" data-testid="rp-badge">{badge}</span>}
      <button type="button" className="p-x" aria-label="Close report" onClick={onClose}>
        <i className="x-glyph" aria-hidden="true" style={{ width: 12, height: 12, '--x-w': '1px' } as CSSProperties} /></button>
    </header>
    <div className="round-content" ref={contentRef} onScroll={updateMore}>
    <GoalBar report={report} />
    <RoundTotals report={report} prev={prev} />
    <button type="button" className="rp-details-key" data-testid="rp-details" data-qa-target aria-expanded={open}
      aria-controls="round-details" onClick={toggle}><span>Details</span><i className="disclosure" aria-hidden="true" /></button>
    {open && <section className="round-details" id="round-details" aria-label="Round details">
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
    </section>}
    </div>
    <div className="keys">
      <AutoReturnControl />
      <button type="button" className="key go" data-testid="rp-return" onClick={onReturn}>Return to market</button>
    </div>
  </section>;
}

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
  const shell = useShell(), view = useViewState(), offline = useOfflineStatus();
  const r = useGameSelector(s => (s.round.state === 'ended' && s.round.lastReport ? s.round.lastReport : null));
  // One dialog at a time: a round may end while a sheet (Settings, Research, Health, the wallet, rewards) is open,
  // and a sheet may open over the report; the report shows again when the sheet closes. It also waits under the
  // offline return report (a round that ended while away).
  if (!r || view.sheet !== null || offlineLayerUp(offline, false)) return null;
  return <RoundReportPlate report={r}
    onReturn={() => returnToMarket(shell)} onClose={() => shell.dispatch({ type: 'dismissReport' })} />;
}
