// The global queue at the top (D17.1, D10): the head leads the strip with its 10 s on the rim,
// then the next 4. Tasks enter every level from here; the pipe drops from under the head's icon.
import type { QueueEntryView } from '../game';
import { ArtCanvas } from './art/ArtCanvas';
import { drawTaskIcon } from './art/deckArt';
import { TaskAccent, taskTypeStyle } from './art/TaskType';
import { clockTone, RimClock, useHeadSeconds } from './hooks/headClock';
import { familyName, feedView, payoutText, sizeText, taskKey, transferText } from './hooks/feedModel';
import { blockedText, taskBits } from './hooks/taskRequirements';
import type { ShellLayout } from './layout';
import { box, T, useLayout } from './shell/geometry';
import { shallowEqual, useGameSelector } from './storeHooks';

export function TaskIcon({ task, n }: { task: QueueEntryView; n: number }) {
  return <ArtCanvas w={16} h={16} n={n} artKey={String(task.family)} draw={g => drawTaskIcon(g, task.family)} />;
}

/** "needs 16 bits" when the cache is short (L2), else the blocked reason. */
function needText(task: QueueEntryView): string {
  return task.blockedBy === 'cache' ? `needs ${taskBits(task.workingSetBits)}` : (blockedText(task) ?? '').replace(/^Needs/, 'needs');
}

function title(task: QueueEntryView): string {
  const blocked = blockedText(task);
  return `${familyName(task.family)}: ${sizeText(task)}${task.transferS === null ? '' : `, lands in ${transferText(task.transferS)}`}${blocked ? `. ${blocked}` : ''}`;
}

function HeadSlot({ L, head, running }: { L: ShellLayout; head: QueueEntryView | null; running: boolean }) {
  const seconds = useHeadSeconds();
  const blocked = !!head && head.blockedBy !== null, d = L.kind === 'desktop', n = L.N, icon = 16 * n;
  const clock = !head ? '' : !running ? 'paused' : blocked ? 'blocked' : `${seconds ?? 10} s`;
  const tone = !running ? 'dim' : blocked ? 'warn' : clockTone(seconds ?? 10);
  return <div className={`panel head-slot${blocked ? ' blocked' : ''}`} style={{ ...box(L.headSlot), ...taskTypeStyle(head?.family) }} data-k="head-slot"
    data-testid="head-slot" title={head ? `Head of the line: ${title(head)}` : undefined}>
    <RimClock w={L.headSlot.w} n={n} blocked={blocked} />
    {head && <>
      <TaskAccent n={n} />
      <span className="aic" style={{ left: L.lat, top: d ? 0 : L.lat }}><TaskIcon task={head} n={n} /></span>
      {d ? <>
        <T x={L.lat + icon + 8} y={0} h={L.headSlot.h} w={L.headSlot.w - L.lat - icon - 8 - 16}><b>{familyName(head.family)}</b></T>
      </> : <>
        <T x={48} y={16} className={tone}><span data-testid="head-clock">{clock}</span></T>
        <T x={8} y={40} w={L.headSlot.w - 16}>{familyName(head.family)}</T>
      </>}
    </>}
  </div>;
}

function Card({ L, task, i }: { L: ShellLayout; task: QueueEntryView | undefined; i: number }) {
  const c = L.cards[i]!, d = L.kind === 'desktop', n = L.N, icon = 16 * n;
  const blocked = !!task && task.blockedBy !== null;
  return <li className={`card${blocked ? ' blocked' : ''}`} style={{ ...box(c, L.cards[0]), ...taskTypeStyle(task?.family) }} data-k={`card${i}`}
    data-task={task ? taskKey(task.task) : undefined} title={task ? title(task) : undefined}>
    {task && <TaskAccent n={n} />}
    {task && (d ? <>
      <span className="aic" style={{ left: L.lat, top: 0 }}><TaskIcon task={task} n={n} /></span>
      <T x={L.lat + icon + 8} y={0} h={c.h} w={c.w - L.lat - icon - 16}><b>{familyName(task.family)}</b> <span className="gold">{payoutText(task)}</span>{' '}
        {blocked ? <span className="warn">{needText(task)}</span> : task.transferS !== null && <span className="net">{transferText(task.transferS)}</span>}</T>
    </> : <>
      <span className="aic" style={{ left: (c.w - icon) / 2, top: 8 }}><TaskIcon task={task} n={n} /></span>
      <T x={8} y={40} w={c.w - 16} className="gold">{payoutText(task)}</T>
    </>)}
  </li>;
}

export function QueueStrip() {
  const L = useLayout();
  const v = useGameSelector(feedView, shallowEqual);
  const first = L.cards[0], last = L.cards[3];
  return <section className="queue" aria-label="Task queue" data-testid="queue">
    <HeadSlot L={L} head={v.head} running={v.running} />
    <ol className="panel cards" aria-label="Next tasks" style={box({ x: first.x, y: first.y, w: last.x + last.w - first.x, h: first.h })}>
      {[0, 1, 2, 3].map(i => <Card key={i} L={L} task={v.window[i + 1]} i={i} />)}
    </ol>
  </section>;
}
