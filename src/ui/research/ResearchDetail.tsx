// A research tile's details, shown inside the tile when it opens: the effect and before → after,
// the price and when you can pay it, the work and how long it holds your hardware, what it needs
// and leads to (both links), the D27 line note, and the key (with Pause while it runs).
import type { CSSProperties } from 'react';
import type { GameAction, ResearchId, ResearchNodeView, ResearchTreeView } from '../../game';
import { formatOps } from '../../game';
import { wholeText } from '../plates/format';
import { etaSpan } from '../hooks/format';
import { holdSeconds } from './estimate';
import { leadsTo, type Board } from './model';
import { CURRENCY_NAME, priceOf } from './money';
import { PriceTag } from './price';
import { keyFor, NO_INCOME, secondsLeft, type KeyContext, type NodeStatus } from './status';

/** What a tile's details read from the screen. */
export interface DetailContext {
  readonly tree: ResearchTreeView;
  readonly board: Board;
  readonly ctx: KeyContext;
  readonly onAction: (action: GameAction) => void;
  readonly onJump: (id: ResearchId) => void;
}

const isPaid = (s: NodeStatus) => ['done', 'running', 'next', 'stopped', 'paused'].includes(s.kind);

/** A project link, the underlined name only: jumps to it, switching tab when needed, and opens it. */
function Link({ n, onJump }: { n: ResearchNodeView; onJump: (id: ResearchId) => void }) {
  return <button type="button" className="rlink" data-goto={n.id} onClick={() => onJump(n.id)}>{n.name}</button>;
}

/** "Cores per CPU 1 → 2". */
function Change({ n }: { n: ResearchNodeView }) {
  if (!n.change) return null;
  return <p className="ld-change"><span>{n.change.label}</span><b>{n.change.before}</b><i>→</i><b className="after">{n.change.after}</b></p>;
}

/** Work, and how long it holds your hardware (D27: work over takenOpsPerSec, the rate once systems take it). */
function timeText(n: ResearchNodeView, s: NodeStatus, p: DetailContext): string {
  const ops = formatOps(n.workOps);
  if (s.kind === 'done') return ops;
  if (s.kind === 'running') { const left = secondsLeft(n, p.ctx.line); return left === null ? ops : `${ops} · ${etaSpan(left)} left`; }
  const hold = holdSeconds(n.workOps * (1 - n.progress), p.tree.takenOpsPerSec);
  return hold === null ? ops : `${ops} · holds your hardware ${etaSpan(hold)}`;
}

/** The line note (D27): what starting it does to the market. */
function lineNote(s: NodeStatus, p: DetailContext): string {
  if (s.kind === 'done') return '';
  const cpm = Number(p.tree.creditsPerMinute);
  if (s.kind === 'running' || s.kind === 'next' || s.kind === 'stopped') {
    return p.ctx.between ? (cpm > 0 ? `Runs on paused servers. Its energy costs ${wholeText(cpm)} Credits/min.` : 'Runs on paused servers.')
      : 'It holds the front of the market line: tasks behind it wait.';
  }
  return p.ctx.between ? 'Between rounds it runs on paused servers: no SLA cost, energy only.'
    : 'Starting cuts the market line: tasks behind it wait while it runs.';
}

/** The key, and Pause or Remove beside it. */
function DetailKey({ n, s, p }: { n: ResearchNodeView; s: NodeStatus; p: DetailContext }) {
  const k = keyFor(n, s, p.ctx);
  const tap = () => { if (k.action) p.onAction(k.action); else if (k.jump) p.onJump(k.jump); };
  return <div className={`ld-keys${k.aside ? ' two' : ''}`}>
    <button type="button" className={`ld-key ${k.tone}${k.progress === null ? '' : ' fill'}`} data-qa-target data-key={k.tone}
      style={k.progress === null ? undefined : { '--fill': `${Math.floor(k.progress * 100)}%` } as CSSProperties}
      disabled={!k.action && !k.jump} onClick={tap}><span>{k.label}</span></button>
    {k.aside && <button type="button" className="ld-aside" data-qa-target onClick={() => p.onAction(k.aside!.action)}>{k.aside.label}</button>}
  </div>;
}

/** Everything about one project, inside its open tile. */
export function TileDetail({ n, s, p }: { n: ResearchNodeView; s: NodeStatus; p: DetailContext }) {
  const byId = p.ctx.byId, next = leadsTo(p.tree, p.board, n.id);
  const shown = (id: ResearchId) => p.board.where.has(id);
  const note = lineNote(s, p);
  return <div className="ld-body">
    <p className="ld-effect">{n.effect || n.summary}</p>
    <Change n={n} />
    <dl className="ld-facts">
      <dt>Cost</dt>
      <dd className="col"><PriceTag price={priceOf(n)} short={s.kind === 'short' ? s.short.map(x => x.currency) : []} />
        {isPaid(s) && <span className="mute">Paid</span>}
        {s.kind === 'short' && s.short.map((x, i) => <span key={x.currency} className={i ? 'mute' : 'need'}>
          {i ? 'Also ' : 'Need '}{wholeText(x.need)} more {CURRENCY_NAME[x.currency]}{x.etaS === null ? `, ${NO_INCOME}` : `, in ${etaSpan(x.etaS)}`}</span>)}</dd>
      <dt>Work</dt>
      <dd>{timeText(n, s, p)}</dd>
      <dt>Needs</dt>
      <dd>{n.requires.length === 0 ? <span className="mute">Nothing</span> : n.requires.map(id => {
        const r = byId.get(id);
        if (!r) return null;
        return r.state === 'done' ? <span key={id} className="ld-met">✓ {r.name}</span>
          : shown(id) ? <Link key={id} n={r} onJump={p.onJump} /> : <span key={id} className="mute">{r.name}</span>;
      })}</dd>
      {(next.shown.length > 0 || next.later > 0) && <><dt>Leads to</dt>
        <dd>{next.shown.map(r => <Link key={r.id} n={r} onJump={p.onJump} />)}
          {next.later > 0 && <span className="mute">{next.shown.length ? `and ${next.later} later` : `${next.later} later ${next.later === 1 ? 'project' : 'projects'}`}</span>}</dd></>}
    </dl>
    {note && <p className="ld-note">{note}</p>}
    {s.kind !== 'done' && <DetailKey n={n} s={s} p={p} />}
  </div>;
}
