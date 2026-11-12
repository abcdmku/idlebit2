import type { ResearchId, ResearchNodeView } from '../../game';
import { Expander } from './expand';
import { PriceTag } from './price';
import { priceOf } from './money';
import { TileDetail, type DetailContext } from './ResearchDetail';
import { nodeStatus, rowTag } from './status';

export interface TreeProps {
  readonly detail: DetailContext;
  readonly open: ResearchId | null;
  readonly onToggle: (id: ResearchId) => void;
}
/**
 * One project row: name, state tag, price, and the real progress along its bottom edge. Every state
 * keeps the same geometry; a locked row is the same row with its light off.
 */
export function ResearchTile({ n, detail, open, onToggle }: TreeProps & { n: ResearchNodeView }) {
  const s = nodeStatus(n, detail.ctx), expanded = n.id === open, body = `rd-${n.id}`, tag = rowTag(s, detail.ctx);
  // A project that is paid for shows its state where the price was.
  const priced = s.kind === 'ready' || s.kind === 'after' || s.kind === 'short' || s.kind === 'locked' || s.kind === 'milestone';
  const progress = 'progress' in s ? s.progress : null;
  return <li className={`rw ${s.kind}${expanded ? ' open' : ''}`} data-tile={n.id} data-state={s.kind}>
    <button type="button" className="lr" data-project={n.id} data-qa-target
      aria-expanded={expanded} aria-controls={expanded ? body : undefined} onClick={() => onToggle(n.id)}>
      <span className="lr-nm">{n.name}{n.purchase ? ` · Level ${n.purchase.level}` : ''}</span>
      <span className={`lr-st${priced ? '' : ' paid'}`}>
        {tag && <span className={`lr-tag ${tag.tone}`}>{tag.text}</span>}
        {priced && <span className="lr-pc">
          <PriceTag price={priceOf(n)} short={s.kind === 'short' ? s.short.map(x => x.currency) : []} /></span>}
      </span>
      <span className="lr-toggle" aria-hidden="true">{expanded ? '−' : '+'}</span>
      {progress !== null && <i className="lr-bar" data-free="art" aria-hidden="true"><i style={{ width: `${progress * 100}%` }} /></i>}
    </button>
    <Expander open={expanded} id={body}>{() => <TileDetail n={n} s={s} p={detail} />}</Expander>
  </li>;
}
