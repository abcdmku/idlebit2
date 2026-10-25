// Round over: an in-world plate over the paused, veiled world (program §12, mockup
// core/round-plate.js). Duration, SLA, met, failed by cause (all six, zeros dimmed so the grid
// never moves), the top failure details (D5.3), peak intensity, Credits and Data earned, and
// one Return to market key. Closing it dismisses the report; the now card's key then returns.
import { useEffect, useRef } from 'react';
import { FAIL_CAUSES } from '../game';
import type { FailCause, RoundReport } from '../game';
import { P, drawCause } from '../render/core';
import { CurrencyIcon } from './Hud';
import { useDialogFocus } from './hooks/useDialogFocus';
import { CAUSE_NAME, causeText } from './hooks/feedModel';
import { amountText, clockText, slaFill, slaText, wholeText } from './hooks/format';
import { returnToMarket } from './input/commands';
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

/** The two most common (cause, detail) pairs, or a dash. Reserved one line either way. */
export function detailLine(report: RoundReport): string {
  const top = report.details.slice(0, 2).map(d => `${causeText(d.cause, d.detail)} ${wholeText(d.count)}`);
  return top.length ? top.join(' · ') : '—';
}

export function RoundReportPlate({ report, percent, onReturn, onClose }: {
  report: RoundReport; percent: number; onReturn: () => void; onClose: () => void;
}) {
  const ref = useRef<HTMLElement>(null);
  useDialogFocus(ref, onClose);
  const failed = FAIL_CAUSES.reduce((sum, c) => sum + report.failedByCause[c], 0);
  return <section ref={ref} className="v3-plate round-plate" role="dialog" aria-modal="true" aria-label="Round over" tabIndex={-1}
    data-testid="round-plate" onPointerDown={e => e.stopPropagation()} onWheel={e => e.stopPropagation()}>
    <header className="p-head">
      <b className="p-title">Round over</b>
      <span className="p-sub">Round {report.index} · {clockText(report.durationMs)}</span>
      <button type="button" className="rp-x" aria-label="Close report" onClick={onClose}>×</button>
    </header>
    <div className="rp-sla"><span className="rp-k">SLA</span><span className="rp-v">{slaText(percent)}</span><SlaMeter percent={percent} /></div>
    <ul className="p-list rp-top">
      <li><span>Met</span><span className="v">{wholeText(report.met)}</span></li>
      <li className="bad"><span>Failed</span><span className="v" data-testid="rp-failed">{wholeText(failed)}</span></li>
    </ul>
    <div className="rp-causes">
      {FAIL_CAUSES.map(c => {
        const n = report.failedByCause[c];
        return <span key={c} className={`rp-c${n ? '' : ' zero'}`} data-cause={c}>
          <CauseIcon cause={c} lit={n > 0} /><span className="k">{CAUSE_NAME[c]}</span><span className="v">{wholeText(n)}</span>
        </span>;
      })}
    </div>
    <p className="rp-detail" data-testid="rp-detail">{detailLine(report)}</p>
    <ul className="p-list rp-bottom">
      <li><span>Peak intensity</span><span className="v">×{report.peakIntensity.toFixed(1)}</span></li>
      <li><span>Credits earned</span><span className="v gold"><CurrencyIcon kind="credits" n={2} />{amountText(report.gross)}</span></li>
      <li><span>Data earned</span><span className="v data"><CurrencyIcon kind="data" n={2} />{amountText(report.data)}</span></li>
    </ul>
    <div className="keys">
      <button type="button" className="key go" data-testid="rp-return" onClick={onReturn}>Return to market</button>
      <p className="need">Every online unit rejoins together.</p>
    </div>
  </section>;
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
