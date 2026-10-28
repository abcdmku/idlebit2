// The market head stays fixed while the next 50 tasks scroll only in response to player input.
import type { CSSProperties } from 'react';
import { type QueueEntryView, type RenderSnapshot, type ResearchQueueEntryView } from '../game';
import { ArtCanvas } from './art/ArtCanvas';
import { drawFlask } from './art/deckArt';
import { TaskAccent, taskTypeStyle } from './art/TaskType';
import { RimClock } from './hooks/headClock';
import { familyName, taskKey } from './hooks/feedModel';
import type { ShellLayout } from './layout';
import { headRisk, SLA_WINDOW } from './queue/risk';
import { TaskIcon, taskTitle } from './queue/taskText';
import { TaskRewards } from './queue/TaskFacts';
import { box, useLayout } from './shell/geometry';
import { shallowEqual, useGameSelector, useShell } from './storeHooks';
import { useQueueSlide } from './queue/useQueueSlide';
import './styles/task-cards.css';

export { TaskIcon } from './queue/taskText';

function Tag({ L, task, head = false, running }: { L: ShellLayout; task: QueueEntryView; head?: boolean; running: boolean }) {
  const { view } = useShell();
  return <button type="button" className={`tag market-task${head ? ' is-head' : ''}${running && task.blockedBy ? ' blocked' : ''}`}
    style={taskTypeStyle(task.family)} data-task={taskKey(task.task)} data-k={head ? 'head-task' : undefined}
    title={taskTitle(task)} aria-label={`${familyName(task.family)}: details`} data-qa-target
    onClick={() => view.dispatch({ type: 'openTask', task: taskKey(task.task) })}>
    <TaskAccent n={L.N} />
    <span className="market-task-heading"><TaskIcon task={task} n={L.N} /><b>{familyName(task.family)}</b></span>
    <TaskRewards task={task} />
  </button>;
}

function ResearchTag({ L, research }: { L: ShellLayout; research: ResearchQueueEntryView }) {
  return <div className="market-task research-market" data-k="head-task" data-testid="research-head" title={`${research.name}: next in line`}>
    <span className="market-task-heading"><ArtCanvas w={16} h={16} n={L.N} artKey="flask" draw={drawFlask} /><b>{research.name}</b></span>
    <span className="rnd">Next in line</span>
  </div>;
}

export const stripOf = (s: RenderSnapshot) => ({ window: s.feed.window, research: s.feed.research, frozen: s.feed.timing !== 'running' || s.round.state !== 'running',
  met: s.hud.sla.met, failed: s.hud.sla.failed, checking: s.hud.sla.checking, slaWindow: slaWindowOf(s) });

export const slaWindowOf = (s: RenderSnapshot): number => (s.hud.sla as { window?: number }).window ?? SLA_WINDOW;

export function QueueStrip() {
  const L = useLayout(), q = useGameSelector(stripOf, shallowEqual);
  const research = q.research && !q.research.running ? q.research : null;
  const running = !q.frozen, head = research ? null : q.window[0] ?? null;
  const blocked = running && !!head && head.blockedBy !== null;
  const risk = running && !!head && !head.committed && headRisk(q.met, q.failed, q.checking, q.slaWindow);
  const first = L.cards[0], width = L.strip.x + L.strip.w - first.x;
  const slide = useQueueSlide(width), incoming = q.window.slice(research ? 0 : 1, research ? 50 : 51);
  return <section className="queue task-market" aria-label="Task market" data-testid="queue">
    <div className={`panel head-slot${blocked ? ' blocked' : ''}${risk ? ' risk' : ''}${research ? ' research-head' : ''}`}
      style={{ ...box(L.headSlot), ...taskTypeStyle(head?.family), ...(risk ? { '--rim': 'var(--fault)' } as CSSProperties : {}) }}
      data-k="head-slot" data-testid="head-slot" aria-label="Next task">
      {research ? <ResearchTag L={L} research={research} /> : head && <Tag L={L} task={head} head running={running} />}
      <RimClock w={L.headSlot.w} n={L.N} blocked={blocked} top={L.headSlot.h - 3 * L.N} />
    </div>
    <ol className="panel slots market-incoming" aria-label="Next 50 market tasks. Swipe, drag or use arrow keys to browse." tabIndex={0}
      data-testid="incoming-tasks" style={box({ x: first.x, y: first.y, w: width, h: first.h })} {...slide.handlers}>
      {incoming.map((task, i) => {
        const page = Math.floor(i * first.w / width), visible = Math.abs(page - slide.page) <= 1;
        return <li key={i} className="slot" style={{ left: i * first.w, top: 0, width: first.w, height: first.h }}
          data-k={`slot${i}`} aria-posinset={i + 1} aria-setsize={incoming.length}>
          {visible && <Tag L={L} task={task} running={running} />}
        </li>;
      })}
    </ol>
  </section>;
}
