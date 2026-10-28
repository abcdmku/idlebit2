import { useEffect, useRef, useState } from 'react';
import type { QueueEntryView, ResearchQueueEntryView } from '../../game';
import { taskBits, waitingShort } from '../hooks/taskRequirements';
import { clockTone, useHeadSeconds } from '../hooks/headClock';
import { box, useLayout } from '../shell/geometry';
import { useShell, useViewState } from '../storeHooks';
import { useInnerBack } from '../shell/backGuard';
import { useDialogFocus } from '../hooks/useDialogFocus';
import { TaskFacts, TaskRewards } from '../queue/TaskFacts';
import { returnToMarket } from '../input/commands';
import { roundOf } from '../queue/taskText';
import { ArtCanvas } from '../art/ArtCanvas';
import { drawMiniIcon, type PartIconKind } from '../art/deckArt';
import '../styles/task-dock.css';

interface DockProps {
  head: QueueEntryView | null;
  research: ResearchQueueEntryView | null;
  running: boolean;
  blocked: boolean;
  status: string;
  round: ReturnType<typeof roundOf>;
  primaryLabel: string;
  onPrimary(): void;
}

function shortStatus(t: QueueEntryView): string {
  switch (t.blockedBy) {
    case 'gpu': return t.tensor ? 'Needs tensor' : 'Needs GPU';
    case 'gpuCores': return 'GPU too small';
    case 'vram': return 'Needs VRAM';
    case 'cache': case 'ram': case 'disk': return 'Needs memory';
    case 'members': return 'Needs servers';
    case 'zones': return 'Needs zones';
    default: return t.blockedBy ? 'Blocked' : t.waitingFor === 'queue' ? 'Queue full' : waitingShort(t, true);
  }
}

function resource(t: QueueEntryView): { label: string; value: string; icon: PartIconKind } {
  if (t.blockedBy === 'vram') return { label: 'VRAM', value: taskBits(t.vramBits), icon: 'gpu' };
  if (t.blockedBy === 'gpuCores' || t.blockedBy === 'gpu') return { label: t.tensor ? 'GPU' : 'GPU cores',
    value: t.tensor ? 'Tensor' : t.gpuCoresMin > 0 ? String(t.gpuCoresMin) : 'Required', icon: 'gpu' };
  return { label: 'Memory', value: taskBits(t.workingSetBits), icon: 'cache' };
}

export function TaskDock(props: DockProps) {
  const { head, research, running, blocked, status, round } = props;
  const L = useLayout(), shell = useShell(), view = useViewState(), seconds = useHeadSeconds();
  const [expanded, setExpanded] = useState(false), peek = useRef<HTMLButtonElement>(null);
  const otherOpen = view.sheet !== null || view.task !== null || view.selected !== null;
  useEffect(() => { if (otherOpen) setExpanded(false); }, [otherOpen]);
  const close = () => { setExpanded(false); peek.current?.focus(); };
  useInnerBack(() => { if (!expanded || otherOpen) return false; close(); return true; });
  const fact = head ? resource(head) : null;
  const cores = head?.cpuCoresWanted ?? 1;
  const toggle = () => { shell.view.dispatch({ type: 'cancel' }); setExpanded(!expanded); };
  const onPrimary = () => { setExpanded(false); props.onPrimary(); };
  return <>
    <section className={`panel task-dock${blocked ? ' blocked' : ''}`} style={box(L.now)} aria-label="Next task">
      <button ref={peek} type="button" className="task-peek" data-testid="task-peek" data-qa-target
        style={{ left: 120, top: 0, width: L.now.w - 200, height: L.now.h }} disabled={!head && !research}
        aria-expanded={expanded && !otherOpen} aria-controls="task-drawer" aria-haspopup="dialog"
        aria-label={`${research?.name ?? head?.label ?? 'Next task'}: ${head ? `up to ${cores} CPU cores, ${fact?.label} ${fact?.value}. ` : ''}${status}. Open requirements and details.`}
        title={head ? `Up to ${cores} CPU cores. ${fact?.label} ${fact?.value}. ${status}` : status}
        onClick={toggle}>
        {head && fact ? <span className="task-peek-resources">
          <span title={`Up to ${cores} CPU cores`}><ArtCanvas w={8} h={8} n={2} artKey="core" draw={g => drawMiniIcon(g, 'core')} /><b>{cores}</b></span>
          <span title={`${fact.label} ${fact.value}`}><ArtCanvas w={8} h={8} n={2} artKey={fact.icon} draw={g => drawMiniIcon(g, fact.icon)} /><b className="cyan">{fact.value.replace(/\s/g, '')}</b></span>
        </span> : <span className="task-peek-resources"><b>{research ? 'Research' : 'No task'}</b>{research && <span className="rnd">{Math.floor(research.progress * 100)}%</span>}</span>}
        <span className="task-peek-state"><span className={blocked ? 'warn' : 'mute'}>{head && running ? shortStatus(head) : research ? 'Next in line' : status}</span>
          {head && running && !head.committed && seconds !== null && <span className={clockTone(seconds)}>{seconds}s</span>}</span>
        <ArtCanvas w={4} h={4} n={2} artKey={String(expanded)} className="task-drawer-chevron" draw={g => {
          g.clearRect(0, 0, 4, 4); g.fillStyle = '#96efff';
          for (let x = 0; x < 3; x++) { const y = Math.abs(x - 1); g.fillRect(x, expanded ? 2 - y : 1 + y, 1, 1); }
        }} />
      </button>
      {running || round.phase === 'ended' ? <button type="button" className="skey task-dock-action" style={box(L.dismiss, L.now)}
        data-testid="dismiss" data-qa-target disabled={!running || !head?.dismissible || view.task !== null}
        onClick={() => { if (head?.dismissible) shell.dispatch({ type: 'dismissTask', task: head.task }); }}>Dismiss</button>
        : <button type="button" className="skey task-dock-action primary" style={box(L.dismiss, L.now)} data-testid="return" data-qa-target
          disabled={!round.can} onClick={() => returnToMarket(shell)}>Return</button>}
    </section>
    {expanded && !otherOpen && <TaskDrawer {...props} onClose={close} onPrimary={onPrimary} />}
  </>;
}

function TaskDrawer({ head, research, status, blocked, running, primaryLabel, onPrimary, onClose }: DockProps & { onClose(): void }) {
  const L = useLayout(), ref = useRef<HTMLElement>(null);
  useDialogFocus(ref, onClose);
  return <section ref={ref} id="task-drawer" className={`panel task-drawer${blocked ? ' blocked' : ''}`} role="dialog" aria-modal="true"
    aria-label="Next task requirements" data-testid="task-drawer"
    style={{ left: L.now.x, bottom: L.h - L.now.y + 8, width: L.now.w, height: Math.min(280, L.view.h - 16) }}
    onPointerDown={e => e.stopPropagation()} onWheel={e => e.stopPropagation()}>
    <header><b>{research?.name ?? head?.label ?? 'Next task'}</b><button type="button" className="skey task-drawer-close" onClick={onClose} aria-label="Close task drawer" data-qa-target><i className="x-glyph" /></button></header>
    <div className="task-drawer-body">
      {head && <><TaskRewards task={head} label /><div className="task-drawer-requirements"><TaskFacts task={head} detailed /></div></>}
      {research && <p className="rnd">Research {Math.floor(research.progress * 100)}% done</p>}
      <p className={blocked ? 'warn' : 'mute'} data-testid="now-wait">{status}</p>
    </div>
    {head && <button type="button" className={`skey task-drawer-details${blocked ? ' warn' : ''}`} disabled={!running}
      data-testid="now-detail" data-qa-target onClick={onPrimary}>{primaryLabel}</button>}
  </section>;
}
