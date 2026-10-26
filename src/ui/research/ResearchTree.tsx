// One tab's parts and tiles (concept C: projects hang off the parts you own). A tile's header is the
// project's name and price over its one truthful state; tapping it opens the tile in place with
// everything about the project (ResearchDetail). A locked tile's "Needs X" is a link that jumps to X.
import type { CSSProperties } from 'react';
import type { ResearchId, ResearchNodeView } from '../../game';
import { ArtCanvas } from '../art/ArtCanvas';
import { drawPartIcon } from '../art/deckArt';
import { LockIcon } from '../plates/icons';
import { Expander } from './expand';
import { PART_ICON, PART_NAMES, type PartGroup } from './model';
import { priceOf, type Wallet } from './money';
import { PriceTag } from './price';
import { TileDetail, type DetailContext } from './ResearchDetail';
import { nodeStatus, statusAside, statusText, type NodeStatus } from './status';

/** How far the wallet is toward the slowest shortfall, 0..1 (a real meter: it fills as income arrives). */
function shortFill(n: ResearchNodeView, s: NodeStatus, w: Wallet): number | null {
  if (s.kind !== 'short') return null;
  const c = s.short[0]!.currency, cost = Number(priceOf(n)[c] ?? 0), have = Number(w[c] ?? 0);
  return cost > 0 ? Math.max(0, Math.min(1, have / cost)) : null;
}

export interface TreeProps {
  readonly detail: DetailContext;
  /** The open tile, or null. */
  readonly open: ResearchId | null;
  /** Tap on a tile's header: opens it, or shuts it when it is the open one. */
  readonly onToggle: (id: ResearchId) => void;
}

export function ResearchTile({ n, detail, open, onToggle }: TreeProps & { n: ResearchNodeView }) {
  const ctx = detail.ctx, s = nodeStatus(n, ctx), locked = s.kind === 'locked', isOpen = n.id === open;
  const fill = 'progress' in s ? s.progress : shortFill(n, s, ctx.wallet);
  const short = s.kind === 'short' ? s.short.map(x => x.currency) : [];
  const needs = locked ? ctx.byId.get(s.needs) : undefined;
  // The meter is drawn by the header's ::before and ::after at --fill: progress, or the wallet toward the price.
  const bar = fill === null ? '' : ` bar${s.kind === 'short' ? ` bar-${s.short[0]!.currency}` : ''}`;
  const body = `rd-${n.id}`;
  return <li className={`rw ${s.kind}${isOpen ? ' open' : ''}`} data-tile={n.id}><div className="tile">
    <div className="tile-head">
      <button type="button" className={`lr${bar}`} style={fill === null ? undefined : { '--fill': `${Math.floor(fill * 100)}%` } as CSSProperties}
        data-qa-target data-project={n.id} aria-expanded={isOpen} aria-controls={isOpen ? body : undefined} onClick={() => onToggle(n.id)}>
        <span className="lr-nm">{locked && <LockIcon />}<span>{n.name}</span></span>
        <span className="lr-st">{locked ? '' : statusText(s, ctx.byId)}</span>
        {n.state === 'done' ? <span className="lr-pc" /> : <span className="lr-pc"><PriceTag price={priceOf(n)} short={short} /></span>}
        <span className="lr-ax">{statusAside(n, s, ctx.line)}</span>
      </button>
      {locked && <button type="button" className="lr-link" data-qa-target data-needs={s.needs} onClick={() => detail.onJump(s.needs)}>
        <span>Needs <b>{needs?.name ?? s.needs}</b></span></button>}
    </div>
    <Expander open={isOpen} id={body}>{() => <TileDetail n={n} s={s} p={detail} />}</Expander>
  </div></li>;
}

/** One part: its icon, name and current spec ("4 cores · 2 lanes"), the done count (opens the finished list), and its tiles. */
export function PartSection({ g, spec, iconN, folded, onFold, ...p }: TreeProps & { g: PartGroup; spec: string; iconN: 2 | 3; folded: boolean; onFold: () => void }) {
  const next = g.part === 'structure', showDone = !folded;
  const count = `${g.done.length} of ${g.total} done`;
  return <section className={`lp${next ? ' next' : ''}`} aria-label={PART_NAMES[g.part]}>
    {next ? <h3 className="lp-rule">Next level</h3> : <header className="lp-head">
      <span className="lp-ico"><ArtCanvas w={16} h={16} n={iconN} artKey={`rp:${g.part}`} draw={c => drawPartIcon(c, PART_ICON[g.part])} /></span>
      <h3>{PART_NAMES[g.part]}</h3>
      <span className="lp-spec">{spec === 'none' ? '' : spec}</span>
      {g.done.length ? <button type="button" className="lp-done" data-qa-target aria-expanded={showDone} onClick={onFold}>
        <span>{count}</span><i className={`chev${showDone ? ' up' : ''}`} /></button> : <span className="lp-done none">{count}</span>}
    </header>}
    {(g.rows.length > 0 || showDone) && <ul className="br">
      {showDone && g.done.map(n => <ResearchTile key={n.id} n={n} {...p} />)}
      {g.rows.map(n => <ResearchTile key={n.id} n={n} {...p} />)}
    </ul>}
  </section>;
}
