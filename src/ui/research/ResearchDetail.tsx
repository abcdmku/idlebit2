// The research detail: a side panel on desktop, a bottom sheet on phone. Folded, the sheet holds the
// key facts and the key; open (and on desktop) it holds everything: the effect, before → after,
// the price and when you can pay it, the work and how long it holds your hardware, what it needs
// and leads to (both links), and the D27 line note.
import type { CSSProperties } from 'react';
import type { GameAction, ResearchId, ResearchNodeView, ResearchTreeView } from '../../game';
import { formatOps } from '../../game';
import { wholeText } from '../plates/format';
import { durationText, holdSeconds } from './estimate';
import { leadsTo, PART_NAMES, TAB_NAMES, type Board } from './model';
import { CURRENCY_NAME, priceOf } from './money';
import { PriceTag } from './ResearchTree';
import { keyFor, nodeStatus, secondsLeft, statusText, type KeyContext, type NodeStatus } from './status';

export interface DetailProps {
  readonly node: ResearchNodeView | null;
  readonly tree: ResearchTreeView;
  readonly board: Board;
  readonly ctx: KeyContext;
  readonly onAction: (action: GameAction) => void;
  readonly onJump: (id: ResearchId) => void;
}

const TONE: Readonly<Record<NodeStatus['kind'], string>> = {
  done: 'done', running: 'run', next: 'wait', stopped: 'warn', paused: 'wait', queued: 'wait', ready: 'go', after: 'off', short: 'off', locked: 'off',
};
const where = (n: ResearchNodeView) => n.part === 'structure' ? `Next level · ${TAB_NAMES[n.tab]}` : `${PART_NAMES[n.part]} · ${TAB_NAMES[n.tab]}`;
const isPaid = (s: NodeStatus) => ['done', 'running', 'next', 'stopped', 'paused'].includes(s.kind);

/** A project link: jumps to it, switching tab when needed. */
function Link({ n, onJump }: { n: ResearchNodeView; onJump: (id: ResearchId) => void }) {
  return <button type="button" className="ld-link" data-qa-target data-goto={n.id} onClick={() => onJump(n.id)}>{n.name}</button>;
}

/** "Cores per CPU 1 → 2". */
function Change({ n }: { n: ResearchNodeView }) {
  if (!n.change) return null;
  return <p className="ld-change"><span>{n.change.label}</span><b>{n.change.before}</b><i>→</i><b className="after">{n.change.after}</b></p>;
}

/** Work, and how long it holds your hardware (D27: work over takenOpsPerSec, the rate once systems take it). */
function timeText(n: ResearchNodeView, s: NodeStatus, p: DetailProps): string {
  const ops = formatOps(n.workOps);
  if (s.kind === 'done') return ops;
  if (s.kind === 'running') { const left = secondsLeft(n, p.ctx.line); return left === null ? ops : `${ops} · ${durationText(left)} left`; }
  const hold = holdSeconds(n.workOps * (1 - n.progress), p.tree.takenOpsPerSec);
  if (hold !== null) return `${ops} · holds your hardware ${durationText(hold)}`;
  return ops;
}

/** The line note (D27): what starting it does to the market. */
function lineNote(s: NodeStatus, p: DetailProps): string {
  if (s.kind === 'done') return '';
  const cpm = Number(p.tree.creditsPerMinute);
  if (s.kind === 'running' || s.kind === 'next' || s.kind === 'stopped') {
    return p.ctx.between ? (cpm > 0 ? `Runs on paused servers. Its energy costs ${wholeText(cpm)} Credits/min.` : 'Runs on paused servers.')
      : 'It holds the front of the market line: tasks behind it wait.';
  }
  return p.ctx.between ? 'Between rounds it runs on paused servers: no SLA cost, energy only.'
    : 'Starting cuts the market line: tasks behind it wait while it runs.';
}

/** The full facts: desktop panel and the open sheet. */
function DetailBody({ n, s, p }: { n: ResearchNodeView; s: NodeStatus; p: DetailProps }) {
  const byId = p.ctx.byId, next = leadsTo(p.tree, p.board, n.id);
  const shown = (id: ResearchId) => p.board.where.has(id);
  const note = lineNote(s, p);
  return <>
    <p className="ld-effect">{n.effect || n.summary}</p>
    <Change n={n} />
    <dl className="ld-facts">
      <dt>Cost</dt>
      <dd className="col"><PriceTag price={priceOf(n)} short={s.kind === 'short' ? s.short.map(x => x.currency) : []} />
        {isPaid(s) && <span className="mute">Paid</span>}
        {s.kind === 'short' && s.short.map((x, i) => <span key={x.currency} className={i ? 'mute' : 'need'}>
          {i ? 'Also ' : 'Need '}{wholeText(x.need)} more {CURRENCY_NAME[x.currency]}{x.etaS === null ? '' : `, in ${durationText(x.etaS)}`}</span>)}</dd>
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
  </>;
}

/** The key, and Pause or Remove beside it. */
export function DetailKey({ n, s, p }: { n: ResearchNodeView; s: NodeStatus; p: DetailProps }) {
  const k = keyFor(n, s, p.ctx);
  const tap = () => { if (k.action) p.onAction(k.action); else if (k.jump) p.onJump(k.jump); };
  return <div className={`ld-keys${k.aside ? ' two' : ''}`}>
    <button type="button" className={`ld-key ${k.tone}${k.progress === null ? '' : ' fill'}`} data-qa-target data-key={k.tone}
      style={k.progress === null ? undefined : { '--fill': `${Math.floor(k.progress * 100)}%` } as CSSProperties}
      disabled={!k.action && !k.jump} onClick={tap}><span>{k.label}</span></button>
    {k.aside && <button type="button" className="ld-aside" data-qa-target onClick={() => p.onAction(k.aside!.action)}>{k.aside.label}</button>}
  </div>;
}

function Head({ n, s, p }: { n: ResearchNodeView; s: NodeStatus; p: DetailProps }) {
  return <div className="ld-head">
    <h3>{n.name}</h3>
    <p className="ld-where"><span>{where(n)}</span><b className={`ld-state ${TONE[s.kind]}`}>{statusText(s, p.ctx.byId)}</b></p>
  </div>;
}

/** Desktop: the side panel. */
export function DetailPanel(p: DetailProps) {
  const n = p.node, s = n ? nodeStatus(n, p.ctx) : null;
  return <aside className="ld-panel" aria-label="Project">
    {!n || !s ? <p className="ld-empty">Pick a project to see what it does.</p> : <>
      <div className="ld-scroll"><Head n={n} s={s} p={p} /><DetailBody n={n} s={s} p={p} /></div>
      <DetailKey n={n} s={s} p={p} />
    </>}
  </aside>;
}

/** Phone: the bottom sheet. Folded: name, state, what it changes, price and hold, and the key. */
export function DetailSheet(p: DetailProps & { open: boolean; onToggle: () => void; height: number }) {
  const n = p.node, s = n ? nodeStatus(n, p.ctx) : null;
  const hold = n && s && !isPaid(s) ? holdSeconds(n.workOps, p.tree.takenOpsPerSec) : null;
  return <aside className={`ld-sheet${p.open ? ' open' : ''}`} style={{ height: p.height }} aria-label="Project">
    {!n || !s ? <p className="ld-empty">Pick a project to see what it does.</p> : <>
      <button type="button" className="ld-top" data-qa-target aria-expanded={p.open} aria-label={`${n.name}, ${p.open ? 'show less' : 'show more'}`} onClick={p.onToggle}>
        <span className="ld-name">{n.name}</span>
        <b className={`ld-state ${TONE[s.kind]}`}>{statusText(s, p.ctx.byId)}</b><i className={`chev${p.open ? '' : ' up'}`} /></button>
      {p.open ? <div className="ld-scroll"><p className="ld-where"><span>{where(n)}</span></p><DetailBody n={n} s={s} p={p} /></div>
        : <div className="ld-fold">
          {n.change ? <Change n={n} /> : <p className="ld-sum">{n.summary || n.effect}</p>}
          <p className="ld-line"><PriceTag price={priceOf(n)} short={s.kind === 'short' ? s.short.map(x => x.currency) : []} />
            <span className="mute">{isPaid(s) ? 'Paid' : hold !== null ? `holds ${durationText(hold)}` : ''}</span></p>
        </div>}
      <DetailKey n={n} s={s} p={p} />
    </>}
  </aside>;
}
