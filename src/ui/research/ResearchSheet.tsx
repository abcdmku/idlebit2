// The research sheet (L2 syncSheet 'research'): only what is relevant now, from the contextual tree.
// Two or three projects (the one printing, then the next ones the hardware can use, then the next
// unlock), the round priority, and a small link to every project.
import { formatOps, type GameAction, type ResearchId, type ResearchNodeView, type ResearchTreeView, type RoundPhase } from '../../game';
import type { Amount } from '../../game';
import { perMinuteText, wholeText } from '../plates/format';
import type { ShellLayout } from '../layout';
import { CloseKey } from '../shell/CloseKey';
import { box, T } from '../shell/geometry';
import { GemIcon } from '../plates/icons';
import { PRIORITY, PRIORITY_ORDER, projectKey } from './ResearchDrawer';
import { ResearchAnswers } from './ResearchAnswers';

const ORDER: Readonly<Record<ResearchNodeView['state'], number>> = { active: 0, parked: 1, queued: 2, available: 3, locked: 4, done: 5 };

/**
 * At most `max` projects: an explicitly opened one first, then active, parked and queued work, then
 * available projects cheapest first, then locked ones whose prerequisite is available (the next unlock).
 */
export function relevantProjects(tree: ResearchTreeView, focus: ResearchId | null, max = 3): ResearchNodeView[] {
  const byId = new Map(tree.nodes.map(n => [n.id, n]));
  const open = (n: ResearchNodeView) => n.state !== 'done' && n.state !== 'locked';
  const next = (n: ResearchNodeView) => n.state === 'locked' && n.lockedBy !== null && !!byId.get(n.lockedBy) && open(byId.get(n.lockedBy)!);
  const pool = tree.nodes.filter(n => open(n) || next(n))
    .sort((a, b) => ORDER[a.state] - ORDER[b.state] || Number(a.dataCost) - Number(b.dataCost) || a.workOps - b.workOps);
  const first = focus ? byId.get(focus) : undefined;
  const out = first && first.state !== 'done' ? [first] : [];
  for (const n of pool) if (out.length < max && !out.includes(n)) out.push(n);
  return out;
}

export interface ResearchSheetProps {
  L: ShellLayout;
  tree: ResearchTreeView;
  phase: RoundPhase;
  focusProject: ResearchId | null;
  credits?: Amount;
  data?: Amount;
  onAction: (action: GameAction) => void;
  onClose: () => void;
  onAll: () => void;
}

export function ResearchSheet({ L, tree, phase, focusProject, credits, data, onAction, onClose, onAll }: ResearchSheetProps) {
  const s = L.drawer, wide = L.lh === 24, pad = wide ? 24 : 16, lh = L.lh;
  const prioY = pad + lh + (wide ? 16 : 8), itemY = prioY + 48 + (wide ? 24 : 16);
  const bw = 128, textW = s.w - 2 * pad - bw - 16, between = phase !== 'running';
  const names = new Map(tree.nodes.map(n => [n.id, n.name]));
  const items = relevantProjects(tree, focusProject);
  const pw = Math.floor((s.w - 2 * pad - 16) / 3 / 8) * 8;
  return <section className="panel sheet research-sheet" style={box(s)} data-k="sheet" role="dialog" aria-label="Research" data-testid="research-drawer"
    onPointerDown={e => e.stopPropagation()}>
    <T x={pad} y={pad} className="head">Research</T>
    <CloseKey L={L} w={s.w} label="Close research" onClose={onClose} />
    {between
      ? <T x={pad} y={prioY + (wide ? 8 : 16)} className="mute">Full speed between rounds · <span className="gold">{perMinuteText(-Number(tree.creditsPerMinute), false)}</span></T>
      : PRIORITY_ORDER.map((m, i) => <button key={m} type="button" role="radio" aria-checked={m === tree.mode} title={PRIORITY[m].line}
        className={`skey prio${m === tree.mode ? ' on' : ''}`} data-qa-target style={{ left: pad + i * (pw + 8), top: prioY, width: pw, height: 48 }}
        onClick={() => onAction({ type: 'setResearchPriority', mode: m })}>{PRIORITY[m].name}</button>)}
    {items.length === 0 && <T x={pad} y={itemY} className="dim">Nothing to research yet.</T>}
    <div className="research-projects" style={{ left: pad, right: pad, top: itemY, bottom: pad + 48, lineHeight: `${lh}px` }}>
    {items.map(n => {
      const k = projectKey(n, tree, credits, data), active = n.state === 'active';
      const need = n.state === 'locked' && n.lockedBy ? `After ${names.get(n.lockedBy) ?? n.lockedBy}` : k.label;
      return <div key={n.id} className={`project ${n.state}`} data-project={n.id}>
        <div style={{ minHeight: 48 }}>
        <div className="project-copy" style={{ maxWidth: textW }}><b>{n.name}</b>{active && <span className="rnd"> {Math.floor(n.progress * 100)}%</span>}</div>
        <div className="project-copy data" style={{ maxWidth: textW }}>{wholeText(n.dataCost)} Data · {formatOps(n.workOps)}</div>
        </div>
        <div className="project-copy mute">{n.effect}</div>
        <ResearchAnswers answers={n.answers} />
        <div className="project-copy dim" style={{ minHeight: lh }}>{!k.action ? need : '\u00a0'}</div>
        {k.action && <button type="button" className={`skey ${k.label === 'Start' || k.label === 'Resume' ? 'go' : 'plain'}`} data-qa-target
          style={{ right: 0, top: 0, width: bw, height: 48 }} onClick={() => onAction(k.action!)}>{k.label === 'Start' || k.label === 'Queue' ? <>{k.label}&nbsp;<GemIcon />&nbsp;{wholeText(n.dataCost)}</> : k.label}</button>}
      </div>;
    })}
    </div>
    <button type="button" className="skey off all" style={{ left: pad, top: s.h - pad - 48, width: 176, height: 48 }}
      data-qa-target onClick={onAll}>All research ›</button>
  </section>;
}
