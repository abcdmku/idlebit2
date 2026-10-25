import { useRef, useState, type CSSProperties } from 'react';
import { formatOps, selectContextualResearchTree, type GameAction, type ResearchCategory, type ResearchId, type ResearchMode, type ResearchNodeView, type ResearchTreeView, type RoundPhase } from '../../game';
import { useDialogFocus } from '../hooks/useDialogFocus';
import { useGameSelector, useShell, useViewState } from '../storeHooks';
import { perMinuteText, wholeText } from '../plates/format';
import { GemIcon, LockIcon } from '../plates/icons';
import { box, useLayout } from '../shell/geometry';
import { exactAmount, lacksAmount } from '../plates/gpuModel';
import type { Amount } from '../../game';
import { ResearchSheet } from './ResearchSheet';
import { ResearchAnswers } from './ResearchAnswers';
import '../styles/research.css';

/**
 * Research opens as a drawer (desktop, over the world above the fixture) or sheet (phone). It shows
 * only the relevant projects (ResearchSheet); "All research" swaps in the full list below.
 */
/** The round priority, named with the share of compute research takes (A04; exec/research.ts task shares). */
export const PRIORITY: Readonly<Record<ResearchMode, { name: string; line: string }>> = {
  background: { name: 'Background 10%', line: 'Research takes 10% of compute. Tasks come first.' },
  shared: { name: 'Shared 25%', line: 'Research takes 25% of compute. SLA can dip.' },
  focus: { name: 'Focus 100%', line: 'Research takes all compute. SLA will fall.' },
};
export const PRIORITY_ORDER: readonly ResearchMode[] = ['background', 'shared', 'focus'];

export const CATEGORY_NAMES: Readonly<Record<ResearchCategory, string>> = {
  compute: 'Compute', memory: 'Memory', accel: 'Acceleration', storage: 'Storage', scheduling: 'Scheduling',
  network: 'Networking', power: 'Power', cooling: 'Cooling', structure: 'Structure', operations: 'Operations',
};
const STATE_TEXT: Readonly<Record<ResearchNodeView['state'], string>> = {
  done: 'Done', active: 'Printing', parked: 'Paused', queued: 'Queued', available: 'Available', locked: 'Locked',
};

/** The key a project row shows: what tapping it does. */
export function projectKey(n: ResearchNodeView, tree: Pick<ResearchTreeView, 'active' | 'queue' | 'queueSlots'>, credits?: Amount, data?: Amount):
  { label: string; action: GameAction | null } {
  switch (n.state) {
    case 'done': return { label: 'Done', action: null };
    case 'active': return { label: 'Cancel', action: { type: 'cancelResearch' } };
    case 'parked': return { label: 'Resume', action: { type: 'resumeResearch' } };
    case 'queued': return { label: 'Unqueue', action: { type: 'unqueueResearch', project: n.id } };
    case 'locked': return { label: 'Locked', action: null };
    case 'available':
      if (n.needsData || lacksAmount(data, n.dataCost)) return { label: 'Needs Data', action: null };
      if (n.needsCredits || lacksAmount(credits, n.creditCost)) return { label: 'Needs Credits', action: null };
      if (!tree.active) return { label: 'Start', action: { type: 'startResearch', project: n.id } };
      if (tree.queue.length < tree.queueSlots) return { label: 'Queue', action: { type: 'queueResearch', project: n.id } };
      return { label: tree.queueSlots ? 'Queue full' : 'One at a time', action: null };
  }
}

export interface ResearchListProps {
  tree: ResearchTreeView;
  phase: RoundPhase;
  focusProject: ResearchId | null;
  onAction: (action: GameAction) => void;
  onClose: () => void;
  credits?: Amount;
  data?: Amount;
  /** The drawer rect, stage px. */
  style?: CSSProperties;
}

export function ResearchList({ tree, phase, focusProject, onAction, onClose, credits, data, style }: ResearchListProps) {
  const ref = useRef<HTMLElement>(null);
  useDialogFocus(ref, onClose);
  const names = new Map(tree.nodes.map((n) => [n.id, n.name]));
  const visible = tree.nodes.filter((n) => n.state !== 'done');
  const groups = (Object.keys(CATEGORY_NAMES) as ResearchCategory[])
    .map((c) => ({ c, nodes: visible.filter((n) => n.category === c) })).filter((g) => g.nodes.length);
  const between = phase !== 'running', active = tree.nodes.find((n) => n.id === tree.active);
  const done = tree.nodes.length - visible.length;
  return <section ref={ref} className="rlist" style={style} data-k="sheet" data-testid="research-drawer" role="dialog" aria-modal="true" aria-label="Research" tabIndex={-1} onPointerDown={(e) => e.stopPropagation()}>
    <header className="rl-head">
      <div><b>Research</b><span>{done} of {tree.nodes.length} done</span></div>
      <button type="button" className="rl-close" onClick={onClose}>Back</button>
    </header>
    <div className="rl-fab">
      <div className="rl-row"><b>{active ? active.name : 'No project printing'}</b><span>{active ? `${Math.floor(active.progress * 100)}% · ${formatOps(tree.opsPerSec)}/s` : ''}</span></div>
      <i className="rl-bar"><b style={{ width: `${Math.round((active?.progress ?? 0) * 100)}%` }} /></i>
      {between
        ? <div className="rl-energy"><span>Full speed between rounds</span><b>{perMinuteText(-Number(tree.creditsPerMinute), false)}</b></div>
        : <div className="rl-prio" role="radiogroup" aria-label="Research priority during a round">
          {PRIORITY_ORDER.map((m: ResearchMode) => <button key={m} type="button" role="radio" aria-checked={m === tree.mode}
            onClick={() => onAction({ type: 'setResearchPriority', mode: m })}>{PRIORITY[m].name}</button>)}
        </div>}
    </div>
    <div className="rl-scroll">
      {groups.length === 0 && <p className="rl-empty">Nothing left to research yet.</p>}
      {groups.map(({ c, nodes }) => <section key={c} className="rl-cat" aria-label={CATEGORY_NAMES[c]}>
        <h3>{CATEGORY_NAMES[c]}</h3>
        {nodes.map((n) => {
          const k = projectKey(n, tree, credits, data);
          const unpaid = n.state === 'available' || n.state === 'locked' || n.state === 'queued';
          return <div key={n.id} className={`rl-item ${n.state}${n.id === focusProject ? ' focus' : ''}`}>
            <div className="rl-text">
              <div className="rl-row"><b>{n.name}</b><span className="rl-state">{STATE_TEXT[n.state]}{n.state === 'active' ? ` ${Math.floor(n.progress * 100)}%` : ''}</span></div>
              {n.effect && <p className="rl-effect">{n.effect}</p>}
              <ResearchAnswers answers={n.answers} />
              <p className="rl-meta">Work {formatOps(n.workOps)} · <span className="rl-data"><GemIcon /> {wholeText(n.dataCost)} Data</span>
                {n.creditCost && n.creditCost !== '0' && <> + <span className="rl-credits">{exactAmount(n.creditCost)} Credits</span></>}
                {!unpaid && <span> · fees paid</span>}</p>
              <p className="rl-lock">{n.state === 'locked' && n.lockedBy && <><LockIcon /> Needs {names.get(n.lockedBy) ?? String(n.lockedBy)}</>}
                {(n.needsData || unpaid && lacksAmount(data, n.dataCost)) && <span> Needs Data.</span>}
                {(n.needsCredits || unpaid && lacksAmount(credits, n.creditCost)) && <span> Needs Credits.</span>}</p>
            </div>
            <button type="button" className="rl-go" disabled={!k.action} onClick={() => k.action && onAction(k.action)}>{k.label}</button>
          </div>;
        })}
      </section>)}
    </div>
  </section>;
}

/** Connected drawer: null unless research is open. */
export function ResearchDrawer() {
  const v = useViewState();
  if (v.sheet !== 'research') return null;
  return <OpenResearch project={v.researchProject} />;
}

function OpenResearch({ project }: { project: ResearchId | null }) {
  const shell = useShell(), L = useLayout(), [all, setAll] = useState(false);
  // Hardware changes can reveal projects even when the research badge is unchanged.
  const key = useGameSelector((s) => `${s.epoch}|${shell.store.getState().build.revision}|${s.research.active}|${Math.floor(s.research.progress * 100)}|${s.research.mode}|${s.research.queued}|${s.hud.data}|${s.hud.credits}|${s.hud.roundState}`, Object.is, 250);
  const phase = useGameSelector((s) => s.hud.roundState);
  void key;
  const tree = selectContextualResearchTree(shell.store.getState(), project);
  const { credits, data } = shell.store.getSnapshot().hud;
  const onAction = (a: GameAction) => { shell.dispatch(a); };
  if (all) return <ResearchList style={box(L.drawer)} tree={tree} phase={phase} focusProject={project} credits={credits} data={data}
    onAction={onAction} onClose={() => setAll(false)} />;
  return <ResearchSheet L={L} tree={tree} phase={phase} focusProject={project} credits={credits} data={data} onAction={onAction}
    onClose={() => shell.view.dispatch({ type: 'cancel' })} onAll={() => setAll(true)} />;
}
