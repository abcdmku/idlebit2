import { selectSystemQueue, QUEUE_NAMES, type SchedulerView, type SystemId, type SystemQueueTaskView } from '../../game';
import { useShell } from '../storeHooks';
import { useLayout } from '../shell/geometry';
import { ArtCanvas } from '../art/ArtCanvas';
import { drawTaskIcon } from '../art/deckArt';
import { PlateFrame } from './PlateFrame';
import { PartKeys, partMain } from './PartKeys';
import { QueueControls } from './QueueControls';
import { CoinIcon, GemIcon } from './icons';
import { bits, wholeText } from './format';
import type { PlateCommon } from './types';
import '../styles/hardware-queue.css';

function readiness(t: SystemQueueTaskView): string {
  if (t.preloading) return `Loading ${bits(t.loadedBits)} / ${bits(t.cacheTargetBits)}`;
  if (t.waitingFor === 'cores') return `${t.coresAvailable} cores free`;
  if (t.waitingFor === 'memory') return 'Memory busy';
  if (t.waitingFor === 'device') return 'Device busy';
  if (t.waitingFor === 'slots') return 'Waiting to start';
  if (t.loadedBits > 0) return `${bits(t.loadedBits)} cached`;
  return 'Ready';
}

function QueuedRow({ task, position, n }: { task: SystemQueueTaskView | null; position: number; n: number }) {
  return <li className={`hardware-task${task?.preloading ? ' loading' : ''}${task ? '' : ' empty'}`} data-queued-task={task?.key}>
    <span className="hardware-position">{position}</span>
    {task ? <>
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
    </> : <span className="mute">Empty slot</span>}
  </li>;
}

export function QueuePlate({ system, view, quotes, onAction, onResearch, researchName, bootS: _boot, ...frame }:
  PlateCommon & { system: SystemId; view: SchedulerView }) {
  const shell = useShell(), layout = useLayout();
  const tasks = selectSystemQueue(shell.store.getState(), system);
  const keys = { quotes, level: view.level, onAction, onResearch, researchName };
  const main = partMain(quotes?.quotes ?? [], view.level);
  return <PlateFrame {...frame} title="Queue" sub={`${tasks.length} / ${view.q}`} className="hardware-queue"
    footer={main && <PartKeys {...keys} part="primary" />}>
    <details className="component-options"><summary>Waiting tasks</summary>
      <p className="hardware-queue-summary">{view.running} running · {view.reserved} incoming · {QUEUE_NAMES[view.strategy]}</p>
      <ol className="hardware-task-list" aria-label="Tasks waiting on this system">
        {tasks.map((task, i) => <QueuedRow key={task.key} task={task} position={i + 1} n={layout.N} />)}
      </ol>
    </details>
    <details className="component-options"><summary>Settings</summary>
      <QueueControls system={system} view={view} onAction={onAction} />
    </details>
    <PartKeys {...keys} part="rest" />
  </PlateFrame>;
}
