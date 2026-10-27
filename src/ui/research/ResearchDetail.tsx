import type { GameAction, ResearchId, ResearchNodeView, ResearchTreeView } from '../../game';
import { formatOps } from '../../game';
import { CoinIcon, GemIcon } from '../plates/icons';
import { keyFor, type KeyContext, type NodeStatus } from './status';

export interface DetailContext {
  readonly tree: ResearchTreeView;
  readonly ctx: KeyContext;
  readonly onAction: (action: GameAction) => void;
  readonly onJump: (id: ResearchId) => void;
}
const whole = (value: string) => BigInt(value).toLocaleString('en-US');

/** Full research information, without a second disclosure or timing forecasts. */
export function TileDetail({ n, s, p }: { n: ResearchNodeView; s: NodeStatus; p: DetailContext }) {
  const key = keyFor(n, s, p.ctx);
  const missing = n.requiredResearch;
  const pause = s.kind === 'running' || s.kind === 'next';
  const action = pause ? key.aside?.action : key.action ?? (s.kind === 'queued' ? key.aside?.action : null);
  const label = n.purchase ? 'Buy' : pause ? 'Pause' : s.kind === 'queued' ? 'Remove' : s.kind === 'paused' || s.kind === 'stopped' ? 'Resume' : action?.type === 'queueResearch' ? 'Queue' : 'Start';
  const work = formatOps(n.workOps);
  return <div className="ld-body">
    <p className="ld-effect">{n.effect || n.summary}</p>
    <dl className="ld-facts">
      <dt>Cost</dt><dd className="ld-cost">
        {BigInt(n.dataCost) > 0n && <span className="pt-d"><GemIcon />{whole(n.dataCost)}</span>}
        {BigInt(n.creditCost) > 0n && <span className="pt-c"><CoinIcon />{whole(n.creditCost)}</span>}
        {BigInt(n.dataCost) === 0n && BigInt(n.creditCost) === 0n && '0'}
      </dd>
      <dt>Work</dt><dd>{work}</dd>
      {missing.length > 0 && <><dt>Requires</dt><dd className="ld-needs">{missing.map(r => r &&
        <button type="button" className="rlink" data-qa-target data-goto={r.id} key={r.id} onClick={() => p.onJump(r.id)}>{r.name}</button>)}</dd></>}
    </dl>
    {s.kind !== 'done' && <button type="button" className="ld-key" data-qa-target data-key={action ? 'go' : 'off'}
      disabled={!action} onClick={() => action && p.onAction(action)}>{label}</button>}
  </div>;
}
