import type { CSSProperties } from 'react';
import { selectRoundRewards } from '../../game';
import { slaText } from '../hooks/format';
import { shortCount } from '../plates/format';
import { box, useLayout } from '../shell/geometry';
import { shallowEqual, useGameSelector, useShell, useViewState } from '../storeHooks';
import { useFleetFaults } from '../health/useFleetHealth';
import '../styles/hud.css';
import '../styles/health.css';

/**
 * The rolling SLA, round completions and next unearned reward use simulation selectors. The SLA reading is the
 * Health key: its lamp is lit amber while a rack runs hot and it opens the list.
 */
export function Sla() {
  const L = useLayout(), shell = useShell(), health = useFleetFaults(), open = useViewState().sheet === 'health';
  const g = useGameSelector(s => {
    const rewards = selectRoundRewards(shell.store.getState());
    return { percent: s.hud.sla.percent, met: s.hud.sla.met, failed: s.hud.sla.failed,
      checking: s.hud.sla.checking, tasks: s.hud.sla.roundMet, ready: rewards.ready, next: rewards.next };
  }, shallowEqual, 250);
  const desktop = L.kind === 'desktop', compact = L.sla.h < 44;
  const rewardWidth = desktop ? L.N === 3 ? 104 : 88 : L.w < 360 ? 56 : 72;
  const readingWidth = desktop && L.N === 3 ? 112 : 88;
  const tone = !g.checking ? 'mute' : g.percent >= 90 ? 'ok' : g.percent >= 80 ? 'warn' : 'bad';
  const ratio = `${g.met} / ${g.met + g.failed}`;
  const taskLabel = `${g.tasks.toLocaleString('en-US')} completed tasks this round. Next reward at ${g.next.toLocaleString('en-US')} tasks.`;
  const faultLabel = health.faults === 0 ? 'No faults' : `${health.faults} unit${health.faults === 1 ? '' : 's'} with a fault`;
  const readyLabel = `${g.ready} reward${g.ready === 1 ? '' : 's'} ready. Open round rewards.`;
  const style = { ...box(L.sla), '--sla-reading': `${readingWidth}px`, '--reward-width': `${rewardWidth}px` } as CSSProperties;
  return <div className={`sla-gauge${compact ? ' compact' : ''}`} style={style} data-testid="sla-gauge">
    <button type="button" className="sla-reading sla-key" data-testid="sla-key" aria-haspopup="dialog" aria-expanded={open}
      aria-label={`SLA ${slaText(g.percent)}, ${ratio} completed${g.checking ? '' : ', warming up'}. ${faultLabel}. Open health.`}
      title="Completed tasks out of the last 50 resolved. Below 80% ends the round after 10 tasks. Dismissals do not count."
      onPointerDown={e => e.stopPropagation()} onClick={() => shell.view.dispatch({ type: 'toggleSheet', sheet: 'health' })}>
      <span className="sla-title mute" data-qa-label><i className={`sla-lamp ${health.fault ?? ''}`} data-testid="sla-lamp" data-fault={health.fault ?? 'none'} aria-hidden="true" />
        <span>SLA</span><span data-testid="sla-counts">{ratio}</span></span>
      <b className={`fig big ${tone}`} data-testid="sla">{slaText(g.percent)}</b>
    </button>
    <span className="hud-tasks" data-testid="hud-tasks" role="group" title={taskLabel} aria-label={taskLabel}>
      <span className="mute">Tasks</span><b data-testid="hud-task-count">{shortCount(g.tasks)}</b>
      <span className="dim" aria-hidden="true">·</span><span className="mute" data-testid="hud-next-milestone">{shortCount(g.next)}</span>
    </span>
    <button type="button" className={`round-rewards-key${g.ready ? ' ready' : ''}`} data-testid="round-rewards-key"
      data-qa-target={compact ? undefined : ''} aria-label={readyLabel} title={readyLabel}
      onClick={() => shell.view.dispatch({ type: 'openRoundRewards' })}>
      {g.ready > 0 && <b className="round-rewards-count" data-testid="round-rewards-count">{g.ready > 99 ? '99+' : g.ready}</b>}
      <span>{g.ready === 0 ? 'Rewards' : g.ready === 1 ? 'reward' : 'rewards'}</span>
    </button>
  </div>;
}
