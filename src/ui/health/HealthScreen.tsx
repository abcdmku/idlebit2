// Health: the SLA key's popup. This round's failures by cause, then every unit with a problem now, one row
// per unit, most severe first; a row jumps the view to its unit. The SLA figure stays on the key that opened it. The list and its words are the sim's
// (selectFleetHealth); nothing here decides what a problem is.
import { useMemo } from 'react';
import { HEALTH_LIMIT, researchId, selectFleetHealth, type FleetHealthView, type HealthProblem } from '../../game';
import { CAUSE_NAME, detailName } from '../hooks/feedModel';
import { wholeText } from '../hooks/format';
import { PlateFrame } from '../plates/PlateFrame';
import { useLayout } from '../shell/geometry';
import { shallowEqual, useGameSelector, useShell, useViewState } from '../storeHooks';
import '../styles/health.css';

/** A hot rack's live reading after its words: "96°F · 60% speed". */
export const readingText = (p: HealthProblem): string =>
  p.issue === 'hot' ? `${Math.round(p.tempF ?? 0)}°F · ${Math.round((p.factor ?? 1) * 100)}% speed` : '';
/** The row's second line: the worst issue with its reading, then the unit's lesser issues. */
export const whatText = (p: HealthProblem): string => [p.text, readingText(p), ...p.also].filter(Boolean).join(' · ');
const rowKey = (p: HealthProblem) => `${p.unit.kind}:${p.unit.id}:${p.issue}:${p.text}:${p.also.join()}`;
const sameRows = (a: FleetHealthView, b: FleetHealthView) =>
  a.problems.length === b.problems.length && a.problems.every((p, i) => {
    const q = b.problems[i]!;
    return rowKey(p) === rowKey(q) && readingText(p) === readingText(q) && p.severity === q.severity;
  }) && shallowEqual(a.counts, b.counts) && a.round.met === b.round.met && a.round.failed === b.round.failed
  && (a.round.byCause?.length ?? -1) === (b.round.byCause?.length ?? -1)
  && (a.round.byCause ?? []).every((c, i) => c.cause === b.round.byCause![i]!.cause && c.count === b.round.byCause![i]!.count && c.detail === b.round.byCause![i]!.detail);

function Contents() {
  const shell = useShell(), L = useLayout();
  const health = useGameSelector(() => selectFleetHealth(shell.store.getState(), HEALTH_LIMIT), sameRows, 250);
  const area = useMemo(() => ({ x: L.view.x + 8, y: L.view.y + 8, w: L.view.w - 16, h: L.view.h - 16 }), [L]);
  const spill = useMemo(() => [{ x: 8, y: L.band.y + L.band.h + 8, w: L.w - 16, h: L.h - L.band.y - L.band.h - 24 }], [L]);
  const close = () => shell.view.dispatch({ type: 'back' });
  const jump = (p: HealthProblem) => {
    shell.view.dispatch({ type: 'drill', ref: p.target });
    // Already looking at that unit: the view did not move, so only the popup closes.
    if (shell.view.getState().sheet === 'health') close();
  };
  const { problems, counts, round } = health;
  const total = counts.risk + counts.idle, more = total - problems.length;
  return <PlateFrame title="Health" className="health-plate" bounds={area} spill={spill} onClose={close}>
    <dl className="health-facts">
      <dt>This round</dt><dd data-testid="health-round">{wholeText(round.met)} met · <span className={round.failed > 0 ? 'bad' : undefined}>{wholeText(round.failed)} failed</span></dd>
    </dl>
    {round.failed > 0 && (round.byCause
      ? <ul className="health-causes" aria-label="Failures this round by cause" data-testid="health-causes">
        {round.byCause.map(c => <li key={c.cause}><span>{CAUSE_NAME[c.cause]}{c.detail ? ` · ${detailName(c.detail)}` : ''}</span><b>{wholeText(c.count)}</b></li>)}
      </ul>
      : <button type="button" className="component-link health-link" data-qa-target
        onClick={() => shell.view.dispatch({ type: 'openResearch', project: researchId('telemetry') })}>Telemetry counts failures by cause →</button>)}
    {total === 0
      ? <p className="health-ok ok" role="status" data-testid="health-ok">No faults</p>
      : <ul className="health-list" aria-label="Units with a problem" data-testid="health-list">
        {problems.map(p => {
          const what = whatText(p), where = p.path.join(' › ');
          return <li key={rowKey(p)}>
            <button type="button" className={`health-row ${p.severity}`} data-qa-target data-testid="health-row"
              aria-label={`${where}: ${what}. Go to it.`} onClick={() => jump(p)}>
              <i className={`health-lamp ${p.severity}`} aria-hidden="true" />
              <span className="health-where"><b>{where}</b><span className="health-what">{what}</span></span>
              <span className="health-go" aria-hidden="true">→</span>
            </button>
          </li>;
        })}
        {more > 0 && <li className="health-more mute" data-testid="health-more">+{wholeText(more)} more</li>}
      </ul>}
  </PlateFrame>;
}

export function HealthScreen() {
  return useViewState().sheet === 'health' ? <Contents /> : null;
}
