import type { QueueEntryView } from '../../game';
import { wholeText } from '../hooks/format';
import { taskBits } from '../hooks/taskRequirements';
import { CoinIcon, GemIcon } from '../plates/icons';

/** Rewards use the task's frozen simulation values, including its exact Credit amount. */
export function TaskRewards({ task, label = false }: { task: QueueEntryView; label?: boolean }) {
  return <span className="task-rewards">
    {label && <span className="mute">Pays</span>}
    <span className="task-reward gold"><CoinIcon />{wholeText(task.cpuOps)}</span>
    <span className="task-reward data"><GemIcon />{wholeText(Math.floor(task.dataReward))}</span>
  </span>;
}

/** Utilization policies may start with fewer cores than this simulation-supplied width. */
export function TaskFacts({ task }: { task: QueueEntryView }) {
  return <div className="task-facts">
    {task.cpuCoresWanted !== undefined && <span>Up to <b>{wholeText(task.cpuCoresWanted)}</b> {task.cpuCoresWanted === 1 ? 'core' : 'cores'}</span>}
    <span><span className="mute">Cache</span> <b className="cyan">{taskBits(task.workingSetBits)}</b></span>
  </div>;
}
