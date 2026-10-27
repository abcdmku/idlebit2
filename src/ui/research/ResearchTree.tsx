import type { ResearchId, ResearchNodeView } from '../../game';
import { Expander } from './expand';
import { PriceTag } from './price';
import { priceOf } from './money';
import { TileDetail, type DetailContext } from './ResearchDetail';
import { nodeStatus } from './status';

export interface TreeProps {
  readonly detail: DetailContext;
  readonly open: ResearchId | null;
  readonly onToggle: (id: ResearchId) => void;
}
/** Locked research keeps the normal row geometry, with its light off. */
export function ResearchTile({ n, detail, open, onToggle }: TreeProps & { n: ResearchNodeView }) {
  const s = nodeStatus(n, detail.ctx), expanded = n.id === open, body = `rd-${n.id}`;
  return <li className={`rw ${s.kind}${expanded ? ' open' : ''}`} data-tile={n.id}>
    <button type="button" className="lr" data-project={n.id} data-qa-target
      aria-expanded={expanded} aria-controls={expanded ? body : undefined} onClick={() => onToggle(n.id)}>
      <span className="lr-nm">{n.name}{n.purchase ? ` · Level ${n.purchase.level}` : ''}</span>
      <span className="lr-pc" style={expanded ? { visibility: 'hidden' } : undefined} aria-hidden={expanded || undefined}><PriceTag price={priceOf(n)} /></span>
      <span className="lr-toggle" aria-hidden="true">{expanded ? '−' : '+'}</span>
    </button>
    <Expander open={expanded} id={body}>{() => <TileDetail n={n} s={s} p={detail} />}</Expander>
  </li>;
}
