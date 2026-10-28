import { regionName, type QueueEntryView } from '../../game';
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
export function TaskFacts({ task, detailed = false }: { task: QueueEntryView; detailed?: boolean }) {
  return <div className="task-facts">
    {task.cpuCoresWanted !== undefined && <span>Up to <b>{wholeText(task.cpuCoresWanted)}</b> {task.cpuCoresWanted === 1 ? 'core' : 'cores'}</span>}
    <span><span className="mute">Memory</span> <b className="cyan">{taskBits(task.workingSetBits)}</b></span>
    {detailed && <>
      {task.gpuCoresMin > 0 && <span>GPU <b>{wholeText(task.gpuCoresMin)}</b> {task.gpuCoresMin === 1 ? 'core' : 'cores'}</span>}
      {task.vramBits > 0 && <span>VRAM <b className="cyan">{taskBits(task.vramBits)}</b></span>}
      {task.members > 1 && <span><b>{wholeText(task.members)}</b> servers</span>}
      {task.minZones > 1 && <span><b>{wholeText(task.minZones)}</b> zones</span>}
      {task.region !== null && <span>{regionName(task.region)}</span>}
      {task.tensor && <span>Tensor compute</span>}
      {task.ecc && <span>ECC memory</span>}
    </>}
  </div>;
}
