// A stable task card: rewards, hardware facts, pickup state, and two full-sized actions.
import type { CSSProperties } from 'react';
import { formatOps } from '../../game';
import { RimClock } from '../hooks/headClock';
import { familyName, taskKey } from '../hooks/feedModel';
import { blockedText, waitingText } from '../hooks/taskRequirements';
import { returnToMarket } from '../input/commands';
import { TaskAccent, taskTypeStyle } from '../art/TaskType';
import { ArtCanvas } from '../art/ArtCanvas';
import { drawFlask } from '../art/deckArt';
import { stripOf } from '../QueueStrip';
import { headRisk } from '../queue/risk';
import { restartKey, restartOf, restartText } from '../queue/restart';
import { AutoReturn, HeadClock, InQueue, roundOf, TaskIcon } from '../queue/taskText';
import { TaskFacts, TaskRewards } from '../queue/TaskFacts';
import { box, useLayout } from '../shell/geometry';
import { shallowEqual, useGameSelector, useShell, useViewState } from '../storeHooks';
import { meetLabel, useMeet } from '../queue/meet';
import { amountText } from '../hooks/format';
import { CoinIcon } from '../plates/icons';
import '../styles/task-cards.css';
import { hasTaskDock } from '../layout';
import { TaskDock } from './TaskDock';

export function NowCard() {
  const L = useLayout(), shell = useShell(), taskOpen = useViewState().task !== null;
  const q = useGameSelector(stripOf, shallowEqual), round = useGameSelector(roundOf, shallowEqual, 250);
  const restart = useGameSelector(restartOf, (a, b) => restartKey(a) === restartKey(b), 250);
  const research = q.research && !q.research.running ? q.research : null;
  const head = research ? null : q.window[0] ?? null, running = !q.frozen && round.phase === 'running';
  const blocked = running && !!head && head.blockedBy !== null;
  const meet = useMeet(blocked && !head.committed ? head : null);
  const buy = meet.filter(quote => quote.currency === 'credits' && !quote.locked && quote.affordable && !quote.cold && !quote.overSupply && BigInt(quote.cost) > 0n)
    .sort((a, b) => BigInt(a.cost) < BigInt(b.cost) ? -1 : BigInt(a.cost) > BigInt(b.cost) ? 1 : 0)[0] ?? null;
  const risk = running && !!head && !head.committed && headRisk(q.met, q.failed, q.checking, q.slaWindow);
  const open = () => { if (head) shell.view.dispatch({ type: 'openTask', task: taskKey(head.task) }); };
  const status = !running ? 'Next round' : head ? blocked ? blockedText(head) ?? waitingText(head)
    : head.waitingFor === 'restart' && restart.on && !head.committed ? restartText(restart) : waitingText(head) : 'Waiting for tasks';
  if (hasTaskDock(L)) return <TaskDock head={head} research={research} running={running} blocked={blocked} status={status} round={round}
    primaryLabel={blocked ? buy ? meetLabel(buy) : 'View fix' : 'Task details'}
    onPrimary={() => { if (blocked && buy) shell.dispatch(buy.action); else open(); }} />;
  return <section className={`panel now task-now${blocked ? ' blocked' : ''}`} data-k="now" aria-label={research ? 'Research next in line' : 'Next task'} data-testid="now"
    style={{ ...box(L.now), ...taskTypeStyle(head?.family), ...(risk ? { '--rim': 'var(--fault)' } : {}) } as CSSProperties}>
    <RimClock w={L.now.w} n={L.N} blocked={blocked} />
    {head && <TaskAccent n={L.N} />}
    <div className="task-now-content">
      <div className="task-identity">
        <div className="task-heading">
          {research ? <ArtCanvas w={16} h={16} n={L.N} artKey="flask" draw={drawFlask} /> : head && <TaskIcon task={head} n={L.N} />}
          <b>{research?.name ?? (head ? familyName(head.family) : 'No task in line')}</b>
        </div>
        {head ? <TaskRewards task={head} label /> : research && <span className="rnd">{formatOps(research.work)}</span>}
      </div>
      <div className="task-hardware">{head && <TaskFacts task={head} />}</div>
      <div className="task-state">
        <span className={blocked ? 'warn' : 'mute'} data-testid="now-wait">{research ? 'Research next in line' : status}</span>
        <span className="task-clock">{research ? research.progress > 0 ? `${Math.floor(research.progress * 100)}% done` : null
          : !running ? round.phase !== 'ended' && <AutoReturn compact />
          : head?.committed ? <InQueue task={head} short={L.kind === 'phone'} />
          : head && <HeadClock blocked={blocked} risk={risk && L.kind === 'desktop'} />}</span>
      </div>
      <div className="task-actions">
        <button type="button" className={`skey task-action${blocked ? ' warn' : ''}`} data-testid="now-detail" data-qa-target
          disabled={!head || !running || taskOpen} title={blocked && buy ? meetLabel(buy) : undefined}
          aria-label={blocked && buy ? `Fix ${head ? familyName(head.family) : 'task'} for ${amountText(buy.cost)} Credits` : head ? `${familyName(head.family)}: details` : 'Task details'}
          onClick={() => { if (blocked && buy) shell.dispatch(buy.action); else open(); }}>
          {blocked ? buy ? <><span>{meetLabel(buy).split(' ')[0]}</span><span className="task-reward"><CoinIcon />{amountText(buy.cost)}</span></> : 'View fix' : 'Details'}
        </button>
        {running || round.phase === 'ended' ? <button type="button" className="skey task-action" data-testid="dismiss" data-qa-target
          disabled={!running || !head?.dismissible || taskOpen} title={head ? `Dismiss ${familyName(head.family)}: free, no SLA change` : undefined}
          onClick={() => { if (head?.dismissible) shell.dispatch({ type: 'dismissTask', task: head.task }); }}>Dismiss</button>
          : <button type="button" className="skey task-action primary" data-testid="return" data-qa-target disabled={!round.can}
            title="Return to market: the next round starts" onClick={() => returnToMarket(shell)}>Return</button>}
      </div>
    </div>
  </section>;
}
