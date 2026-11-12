import type { CSSProperties } from 'react';
import { selectSystemQueue, type SchedulerView, type SystemId, type SystemQueueTaskView } from '../../game';
import { useShell } from '../storeHooks';
import { useLayout } from '../shell/geometry';
import { ArtCanvas } from '../art/ArtCanvas';
import { drawTaskIcon } from '../art/deckArt';
import { PlateFrame } from './PlateFrame';
import { PartKeys, generationKey, partLevel } from './PartKeys';
import { QueueControls } from './QueueControls';
import { CoinIcon, GemIcon } from './icons';
import { bits, wholeText } from './format';
import type { PlateCommon } from './types';
import '../styles/hardware-queue.css';

/** What a queued task is doing or held by. Plain waiting for a free core says nothing: that is what a queue is. */
function readiness(t: SystemQueueTaskView): string {
  if (t.preloading) return `Loading ${bits(t.loadedBits)} / ${bits(t.cacheTargetBits)}`;
  if (t.waitingFor === 'cores') return t.coresAvailable > 0 ? `${t.coresAvailable} of ${t.coresWanted} cores free` : '';
  if (t.waitingFor === 'memory') return 'Memory busy';
  if (t.waitingFor === 'device') return 'Device busy';
  if (t.loadedBits > 0) return `${bits(t.loadedBits)} cached`;
  return '';
}

function QueuedRow({ task, position, n }: { task: SystemQueueTaskView; position: number; n: number }) {
  return <li className={`hardware-task${task.preloading ? ' loading' : ''}`} data-queued-task={task.key}>
    <span className="hardware-position">{position}</span>
      <ArtCanvas w={16} h={16} n={n} artKey={String(task.family)} draw={g => drawTaskIcon(g, task.family)} />
      <div className="hardware-task-info">
        <div className="hardware-task-title"><b title={task.label}>{task.label}</b>
          <span className="hardware-rewards"><span className="gold"><CoinIcon />{wholeText(task.credits)}</span>
            <span className="data"><GemIcon />{wholeText(Math.floor(task.dataReward))}</span></span>
        </div>
        <div className="hardware-task-facts"><span>{task.coresWanted} {task.coresWanted === 1 ? 'core' : 'cores'} · {bits(task.workingSetBits)}</span>
          <span className={task.preloading ? 'hardware-preload' : 'mute'}>{readiness(task)}</span></div>
      </div>
      {task.preloading && <i className="hardware-load-track" aria-hidden="true"><i style={{ width: `${task.cacheTargetBits > 0 ? 100 * task.loadedBits / task.cacheTargetBits : 0}%` }} /></i>}
  </li>;
}

export function QueuePlate({ system, view, quotes, onAction, onResearch, researchName, bootS: _boot, ...frame }:
  PlateCommon & { system: SystemId; view: SchedulerView }) {
  const shell = useShell(), layout = useLayout();
  const tasks = selectSystemQueue(shell.store.getState(), system);
  const keys = { quotes, level: view.level, onAction, onResearch, researchName };
  // The list is as tall as the queue's slots (whole rows, up to the visible few) whatever it holds, so the plate keeps
  // its height while tasks come and go. Free slots are blank; an empty queue says so once.
  const slots = Math.max(view.q, tasks.length);
  return <PlateFrame {...frame} title="Queue" sub={`${tasks.length} / ${view.q}`} className="hardware-queue"
    footer={partLevel(quotes?.quotes ?? [], view.level) && <PartKeys {...keys} />} generation={generationKey(keys)}>
    <QueueControls system={system} view={view} onAction={onAction} onResearch={onResearch} />
    <section className="component-section queue-tasks">
      <ol className="hardware-task-list scroll-list" aria-label="Queued tasks" style={{ '--slots': slots } as CSSProperties}>
        {tasks.map((task, i) => <QueuedRow key={task.key} task={task} position={i + 1} n={layout.N} />)}
        {tasks.length === 0 && <li className="hardware-queue-empty">No tasks queued</li>}
      </ol>
    </section>
  </PlateFrame>;
}
