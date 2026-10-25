// One tab's parts and rows (concept C: projects hang off the parts you own). A row is the project's
// name and price over its one truthful state; a locked row's "Needs X" is a link that jumps to X.
import type { CSSProperties } from 'react';
import type { ResearchId, ResearchNodeView } from '../../game';
import { ArtCanvas } from '../art/ArtCanvas';
import { drawPartIcon } from '../art/deckArt';
import { CoinIcon, GemIcon, LockIcon } from '../plates/icons';
import { wholeText } from '../plates/format';
import { PART_ICON, PART_NAMES, type PartGroup } from './model';
import { priceOf, type Currency, type Price, type Wallet } from './money';
import { nodeStatus, statusAside, statusText, type NodeStatus, type StatusContext } from './status';

/** Data and Credits as the node costs them; a currency the wallet is short of reads dim. */
export function PriceTag({ price, short = [] }: { price: Price; short?: readonly Currency[] }) {
  return <span className="pt">
    {price.data && <span className={`pt-d${short.includes('data') ? ' short' : ''}`}><GemIcon />{wholeText(price.data)}</span>}
    {price.credits && <span className={`pt-c${short.includes('credits') ? ' short' : ''}`}><CoinIcon />{wholeText(price.credits)}</span>}
  </span>;
}

/** How far the wallet is toward the slowest shortfall, 0..1 (a real meter: it fills as income arrives). */
function shortFill(n: ResearchNodeView, s: NodeStatus, w: Wallet): number | null {
  if (s.kind !== 'short') return null;
  const c = s.short[0]!.currency, cost = Number(priceOf(n)[c] ?? 0), have = Number(w[c] ?? 0);
  return cost > 0 ? Math.max(0, Math.min(1, have / cost)) : null;
}

export interface TreeProps {
  readonly ctx: StatusContext;
  readonly selected: ResearchId | null;
  readonly onPick: (id: ResearchId) => void;
  readonly onJump: (id: ResearchId) => void;
}

export function ResearchRow({ n, ctx, selected, onPick, onJump }: TreeProps & { n: ResearchNodeView }) {
  const s = nodeStatus(n, ctx), locked = s.kind === 'locked';
  const fill = 'progress' in s ? s.progress : shortFill(n, s, ctx.wallet);
  const short = s.kind === 'short' ? s.short.map(x => x.currency) : [];
  const needs = locked ? ctx.byId.get(s.needs) : undefined;
  // The meter is drawn by the row's ::before and ::after at --fill: progress, or the wallet toward the price.
  const bar = fill === null ? '' : ` bar${s.kind === 'short' ? ` bar-${s.short[0]!.currency}` : ''}`;
  return <li className={`rw ${s.kind}`}>
    <button type="button" className={`lr${bar}`} style={fill === null ? undefined : { '--fill': `${Math.floor(fill * 100)}%` } as CSSProperties}
      data-qa-target data-project={n.id} aria-pressed={n.id === selected} onClick={() => onPick(n.id)}>
      <span className="lr-nm">{locked && <LockIcon />}<span>{n.name}</span></span>
      <span className="lr-st">{locked ? '' : statusText(s, ctx.byId)}</span>
      {n.state === 'done' ? <span className="lr-pc" /> : <span className="lr-pc"><PriceTag price={priceOf(n)} short={short} /></span>}
      <span className="lr-ax">{statusAside(n, s, ctx.line)}</span>
    </button>
    {locked && <button type="button" className="lr-link" data-qa-target data-needs={s.needs} onClick={() => onJump(s.needs)}>
      <span>Needs <b>{needs?.name ?? s.needs}</b></span></button>}
  </li>;
}

/** One part: its icon, name and current spec ("4 cores · 2 lanes"), the done count (opens the finished list), and its rows. */
export function PartSection({ g, spec, iconN, open, onFold, ...p }: TreeProps & { g: PartGroup; spec: string; iconN: 2 | 3; open: boolean; onFold: () => void }) {
  const next = g.part === 'structure';
  const count = `${g.done.length} of ${g.total} done`;
  return <section className={`lp${next ? ' next' : ''}`} aria-label={PART_NAMES[g.part]}>
    {next ? <h3 className="lp-rule">Next level</h3> : <header className="lp-head">
      <span className="lp-ico"><ArtCanvas w={16} h={16} n={iconN} artKey={`rp:${g.part}`} draw={c => drawPartIcon(c, PART_ICON[g.part])} /></span>
      <h3>{PART_NAMES[g.part]}</h3>
      <span className="lp-spec">{spec === 'none' ? '' : spec}</span>
      {g.done.length ? <button type="button" className="lp-done" data-qa-target aria-expanded={open} onClick={onFold}>
        <span>{count}</span><i className={`chev${open ? ' up' : ''}`} /></button> : <span className="lp-done none">{count}</span>}
    </header>}
    {(g.rows.length > 0 || open) && <ul className="br">
      {open && g.done.map(n => <ResearchRow key={n.id} n={n} {...p} />)}
      {g.rows.map(n => <ResearchRow key={n.id} n={n} {...p} />)}
    </ul>}
  </section>;
}
