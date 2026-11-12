import type { GameAction, ResearchId, ResearchNodeView, ResearchTreeView } from '../../game';
import { formatOps } from '../../game';
import { wholeText } from '../plates/format';
import { priceOf } from './money';
import { PriceTag, rounded } from './price';
import { keyFor, pct, type KeyContext, type NodeStatus } from './status';

export interface DetailContext {
  readonly tree: ResearchTreeView;
  readonly ctx: KeyContext;
  readonly onAction: (action: GameAction) => void;
  readonly onJump: (id: ResearchId) => void;
}

/** Full research information, without a second disclosure or timing forecasts. */
export function TileDetail({ n, s, p }: { n: ResearchNodeView; s: NodeStatus; p: DetailContext }) {
  const key = keyFor(n, s, p.ctx), price = priceOf(n);
  const begun = s.kind === 'running' || s.kind === 'next' || s.kind === 'stopped' || s.kind === 'paused';
  // The row above carries the price; it is written out here only when that compact figure is rounded.
  const unpaid = s.kind === 'ready' || s.kind === 'after' || s.kind === 'short' || s.kind === 'locked' || s.kind === 'milestone';
  const rate = s.kind === 'running' ? p.ctx.line.opsPerSec ?? 0 : 0;
  return <div className="ld-body">
    <p className="ld-effect">{n.effect || n.summary}</p>
    <dl className="ld-facts">
      {unpaid && (rounded(price.data) || rounded(price.credits)) && <><dt>Cost</dt>
        <dd><PriceTag price={price} exact short={s.kind === 'short' ? s.short.map(x => x.currency) : []} /></dd></>}
      {n.workOps > 0 && <><dt>Work</dt><dd>{begun ? `${pct(s.progress)} of ${formatOps(n.workOps)}` : formatOps(n.workOps)}
        {rate > 0 && <span className="ld-rate"> · {formatOps(rate)}/s</span>}
        {begun && <i className={`ld-bar ${s.kind}`} data-free="art" aria-hidden="true"><i style={{ width: `${s.progress * 100}%` }} /></i>}</dd></>}
      {s.kind === 'stopped' && <><dt className="warn">Stopped</dt><dd>Credits are below 0</dd></>}
      {s.kind === 'milestone' && <><dt className="warn">Needs</dt><dd>{wholeText(s.count)}-task round reward</dd></>}
      {n.requiredResearch.length > 0 && <><dt className="warn">Needs</dt><dd className="ld-needs">{n.requiredResearch.map(r => r &&
        <button type="button" className="rlink" data-qa-target data-goto={r.id} key={r.id} onClick={() => p.onJump(r.id)}>{r.name}</button>)}</dd></>}
    </dl>
    {key && <button type="button" className={`ld-key ${key.tone}`} data-qa-target data-key={key.tone}
      disabled={!key.action} onClick={() => key.action && p.onAction(key.action)}>{key.label}</button>}
  </div>;
}
