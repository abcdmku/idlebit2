// The report's lead (D40): progress shows only here, at round end (user, 26 Oct). One number, the tasks
// completed this round, and one bar: a ruler from 0 marked with the goals around this round on the endless
// ladder (10, 15, 20, 30, 50, 75, 100 … six per ×10), the counts themselves as labels. Under it
// the best round to beat and the next era. Totals against the last round wait in the report's details.
import type { ReactNode } from 'react';
import { tierOf, tierValue, type Amount, type ResearchId, type RoundReport, type RunwayMark, type RunwayView } from '../../game';
import { CoinIcon, GemIcon } from '../plates/icons';
import { amountText, wholeText } from '../hooks/format';
import { familyName } from '../hooks/feedModel';
import { useShell } from '../storeHooks';

/** Shorter labels for some milestones; every other milestone shows its research tree name. */
const ERA_SHORT: Readonly<Record<string, string>> = { fabKhz: 'kHz', fabMhz: 'MHz', fabGhz: 'GHz' };
export const eraName = (node: ResearchId | string, eras: RunwayView['eras']): string =>
  ERA_SHORT[node] ?? eras.find(e => e.node === node)?.name ?? node;
export const pctText = (p: number) => `${Math.floor(p * 100)}%`;

/** "NEW BEST" when the round beat every round before it (never on the first). */
export function reportBadge(report: RoundReport): string | null {
  const best = report.frontier.priorBestMet;
  return best > 0 && report.met > best ? 'NEW BEST' : null;
}

/**
 * The bar is a ruler from 0 to the second goal ahead. Its marks are the goals themselves (task counts on the
 * endless ladder 10, 15, 20, 30, 50, 75, 100 …): the one reached and the next two. Reached marks are lit.
 */
export function goalBar(met: number) {
  const t = Math.max(5, tierOf(met)), goals = [t, t + 1, t + 2].map(tierValue);
  return { hi: goals[2]!, marks: goals.map(at => ({ at, reached: met >= at })), next: tierValue(Math.max(4, tierOf(met)) + 1) };
}

/** This round's one bar: the counts above, an unbroken gold fill to this round's count, seams where the marks fall. */
export function GoalBar({ report }: { report: RoundReport }) {
  const shell = useShell();
  const met = report.met, bar = goalBar(met), pct = (v: number) => `${(Math.min(1, v / bar.hi) * 100).toFixed(2)}%`;
  return <div className="rb" data-testid="rp-goal-bar" role="group" aria-label={`${wholeText(met)} tasks this round; next goal ${wholeText(bar.next)}`}>
    <div className="rb-marks">{bar.marks.map((m, i) => <button type="button" key={m.at} className={`rb-mark${m.reached ? ' on' : ''}${i === bar.marks.length - 1 ? ' end' : ''}`}
      aria-label={`${wholeText(m.at)} tasks: view reward`} onClick={() => shell.view.dispatch({ type: 'openRoundRewards', milestone: m.at })}
      style={{ left: pct(m.at) }}>{wholeText(m.at)}</button>)}</div>
    <div className="rb-bar" data-free="art">
      <b className="rb-fill" style={{ width: pct(met) }} />
      {bar.marks.slice(0, -1).map(m => <i key={m.at} className={`rb-seam${m.reached ? ' on' : ''}`} style={{ left: pct(m.at) }} />)}
    </div>
  </div>;
}

/** The best round to beat (or the one just beaten), under the bar. */
export function GoalRows({ report }: { report: RoundReport }) {
  const best = report.frontier.priorBestMet;
  return best > 0 ? <li data-testid="rp-best"><span className="mute">{report.met > best ? 'Previous best' : 'Best'}</span>
    <span className="v">{wholeText(best)} tasks</span></li> : null;
}

/** "Rack 59% → 71%" (the end figure gold), "Rack research 10% → 34%", or the milestone that finished in the round. */
export function RunwayValue({ start, end, eras }: { start: RunwayMark | null; end: RunwayMark | null; eras: RunwayView['eras'] }) {
  const name = (m: RunwayMark) => <>{eraName(m.node, eras)}{m.phase === 'research' ? ' research' : ''}</>;
  if (!end) return start ? <>{eraName(start.node, eras)} done</> : null;
  if (start && start.node !== end.node) return <>{eraName(start.node, eras)} done · {name(end)} <b className="gold">{pctText(end.progress)}</b></>;
  // An unchanged figure reads once ("Rack 0%"), not as a move.
  if (start && start.phase === end.phase && pctText(start.progress) !== pctText(end.progress)) {
    return <>{name(end)} {pctText(start.progress)} → <b className="gold">{pctText(end.progress)}</b></>;
  }
  return <>{name(end)} <b className="gold">{pctText(end.progress)}</b></>;
}

/** A change from the last round: "▲ 69%" against a positive last value, else the signed difference; empty without one. */
export function changeText(now: number, before: number | null): { text: string; tone: 'ok' | 'bad' | 'mute' } {
  if (before === null) return { text: '', tone: 'mute' };
  const d = now - before, tone = d > 0 ? 'ok' : d < 0 ? 'bad' : 'mute', arrow = d > 0 ? '▲' : d < 0 ? '▼' : '';
  const size = before > 0 ? `${Math.abs(Math.round(d / before * 100))}%` : wholeText(Math.abs(d));
  return { text: d === 0 ? 'same' : `${arrow} ${size}`, tone };
}

/** Round details: Net and Data against the last round (tasks and peak intensity show elsewhere), and first-taken families. */
export function ReachDetails({ report, prev }: { report: RoundReport; prev: RoundReport | null }) {
  const num = (a: Amount) => Number(a), firsts = report.frontier.firstTaken;
  const row = (label: string, value: ReactNode, c: ReturnType<typeof changeText>) =>
    <li><span>{label}</span><span className="v">{value}{c.text && <span className={`rp-chg ${c.tone}`}>{c.text}</span>}</span></li>;
  return <>
    <ul className="p-list rp-vs" data-testid="rp-vs">
      {row('Net', <><CoinIcon />{amountText(report.net)}</>, changeText(num(report.net), prev ? num(prev.net) : null))}
      {row('Data', <><GemIcon />{amountText(report.data)}</>, changeText(num(report.data), prev ? num(prev.data) : null))}
    </ul>
    {firsts.length > 0 && <p className="mute" data-testid="rp-firsts">First taken: {firsts.map(familyName).join(', ')}</p>}
  </>;
}
