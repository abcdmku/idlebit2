// Offline return (spec §15): a long catch-up sits behind a progress plate, then one compact report says what
// the absence earned. Both share one veil, so the hand-over is a change of plate, not a flash. The report waits
// while a sheet (Settings, Research, the wallet) is open, as the round report does, and shows nothing for a
// trivially short absence or one that earned nothing.
import { useEffect, useMemo, useRef } from 'react';
import { selectResearchTree } from '../../game';
import type { AdvanceReport, ResearchId } from '../../game';
import { CAUSE_NAME } from '../hooks/feedModel';
import { amountText, wholeText } from '../hooks/format';
import { useDialogFocus } from '../hooks/useDialogFocus';
import { CoinIcon, GemIcon } from '../plates/icons';
import { useInnerBack } from '../shell/backGuard';
import { useOfflineStatus, useShell, useViewState, type OfflineStatus } from '../storeHooks';
import { LONG_CATCH_UP_MS, cappedAwayMs, creditedMs, durationText, failedCauses, failedTotal, researchedText, worthShowing } from './model';
import '../styles/offline.css';

/** The progress plate covers a long catch-up unless a sheet is open; the notice line says it otherwise. */
export const showsCatchUpPlate = (o: OfflineStatus, sheetOpen: boolean): boolean =>
  o.catchingUp && o.totalMs >= LONG_CATCH_UP_MS && !sheetOpen;

/** The offline layer (its progress plate or its report) is up: the round report waits under it, so one dialog shows. */
export const offlineLayerUp = (o: OfflineStatus, sheetOpen: boolean): boolean =>
  showsCatchUpPlate(o, sheetOpen) || (!sheetOpen && o.report !== null && !o.catchingUp && worthShowing(o.report));

/** Mounted by the shell, above the round report and below the leave dialog. */
export function OfflineLayer() {
  const { store } = useShell(), view = useViewState(), o = useOfflineStatus();
  const sheetOpen = view.sheet !== null;
  const settled = o.report !== null && !o.catchingUp;
  const trivial = settled && !worthShowing(o.report);
  // A hiccup's report is dropped, so it never surfaces later.
  useEffect(() => { if (trivial) store.dismissOfflineReport(); }, [trivial, store]);
  const progress = showsCatchUpPlate(o, sheetOpen);
  const report = settled && !trivial && !sheetOpen ? o.report : null;
  if (!progress && !report) return null;
  return <div className="offline-veil" onPointerDown={e => e.stopPropagation()} onWheel={e => e.stopPropagation()}>
    {progress ? <CatchUpPlate o={o} /> : <ReportDialog report={report!} awayMs={cappedAwayMs(report!, store.getOfflineAbsence())} onClose={store.dismissOfflineReport} />}
  </div>;
}

function CatchUpPlate({ o }: { o: OfflineStatus }) {
  const capped = o.awayMs - o.totalMs >= 60_000;
  return <section className="v3-plate offline-plate" role="status" aria-label="Catching up" data-testid="catch-up-plate">
    <header className="p-head"><b className="p-title">Catching up</b><span className="off-time">{o.percent}%</span></header>
    <div className="off-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={o.percent}>
      <i style={{ width: `${o.percent}%` }} />
    </div>
    <p className="off-span">
      <span>{durationText(o.totalMs * o.percent / 100)} of {durationText(o.totalMs)}</span>
      {/* Reserved either way, so the plate is one height. */}
      <span className="off-cap">{capped ? `Away ${durationText(o.awayMs)}` : ''}</span>
    </p>
  </section>;
}

const signed = (text: string, negative: boolean, zero: boolean) => (negative ? '−' : zero ? '' : '+') + text;

function ReportDialog({ report, awayMs, onClose }: { report: AdvanceReport; awayMs: number | null; onClose: () => void }) {
  const ref = useRef<HTMLElement>(null), go = useRef<HTMLButtonElement>(null), { store } = useShell();
  useDialogFocus(ref, onClose, go);
  useInnerBack(() => { onClose(); return true; });
  const names = useMemo(() => new Map<ResearchId, string>(selectResearchTree(store.getState()).nodes.map(n => [n.id, n.name])), [store]);
  const net = Number(report.net), failed = failedTotal(report), causes = failedCauses(report);
  const research = researchedText([...new Set(report.researchCompleted)].map(id => names.get(id) ?? String(id)));
  const rounds = report.roundsEnded.length, gross = Number(report.gross), energy = Number(report.energy);
  return <section ref={ref} className="v3-plate offline-plate offline-report" role="dialog" aria-modal="true" aria-labelledby="offline-title" tabIndex={-1}
    data-testid="offline-report">
    <header className="p-head"><b className="p-title" id="offline-title">While away</b>
      <span className="off-time" data-testid="offline-time">{durationText(creditedMs(report))}</span></header>
    {awayMs !== null && <p className="off-capped" data-testid="offline-capped">Away {durationText(awayMs)} · credited up to the cap</p>}
    <div className="off-body">
      <div className="off-heads">
        <div className={`off-fig${net < 0 ? ' loss' : ''}`} data-testid="offline-net">
          <span className="k">Net</span>
          <b className="v"><CoinIcon />{signed(amountText(report.net).replace(/^[−-]/, ''), net < 0, Math.trunc(net) === 0)}</b>
        </div>
        <div className="off-fig data" data-testid="offline-data">
          <span className="k">Data</span>
          <b className="v"><GemIcon />{signed(amountText(report.data), false, Math.trunc(Number(report.data)) === 0)}</b>
        </div>
      </div>
      <ul className="off-rows">
        {rounds > 0 && <li><span>Rounds</span><span className="v">{wholeText(rounds)}</span></li>}
        {report.met > 0 && <li><span>Met</span><span className="v ok">{wholeText(report.met)}</span></li>}
        {failed > 0 && <li><span>Failed</span><span className="v bad">{wholeText(failed)}</span></li>}
        {causes.map(c => <li key={c.cause} className="sub"><span>{CAUSE_NAME[c.cause]}</span><span className="v">{wholeText(c.count)}</span></li>)}
        {gross !== 0 && <li><span>Earned</span><span className="v gold"><CoinIcon />{amountText(report.gross)}</span></li>}
        {energy !== 0 && <li><span>Energy</span><span className="v mute">−<CoinIcon />{amountText(report.energy)}</span></li>}
        {research && <li className="res"><span>Researched</span><span className="v cyan" data-testid="offline-research">{research}</span></li>}
      </ul>
    </div>
    <div className="keys">
      <button ref={go} type="button" className="key go" data-qa-target data-testid="offline-continue" onClick={onClose}>Continue</button>
    </div>
  </section>;
}
