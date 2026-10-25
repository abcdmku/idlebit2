// The head task's big card, at the bottom above the deck (user, 25 Oct: "the main running task below
// like the photo"). Its name and payout, what it needs or its size, its 10 s take clock (or its
// completion window once taken, D26.5), the round-risk warning (A12), and a big Dismiss, which reads
// Return between rounds. It updates in place when the head changes.
import type { CSSProperties } from 'react';
import { useHeadSeconds, RimClock } from '../hooks/headClock';
import { familyName, payoutText, sizeText } from '../hooks/feedModel';
import { blockedText } from '../hooks/taskRequirements';
import { returnToMarket } from '../input/commands';
import { TaskAccent, taskTypeStyle } from '../art/TaskType';
import { ArtCanvas } from '../art/ArtCanvas';
import { drawFlask } from '../art/deckArt';
import { formatOps } from '../../game';
import { stripOf } from '../QueueStrip';
import { headRisk } from '../queue/risk';
import { AutoReturn, fits, HeadClock, InQueue, roundOf, TaskIcon, windowText } from '../queue/taskText';
import { box, T, useLayout } from '../shell/geometry';
import { shallowEqual, useGameSelector, useShell } from '../storeHooks';

export function NowCard() {
  const L = useLayout(), shell = useShell(), seconds = useHeadSeconds() ?? 10;
  const q = useGameSelector(stripOf, shallowEqual), r = useGameSelector(roundOf, shallowEqual, 250);
  // D27: a started project waiting for room holds the front of the line; the card shows it instead.
  const rq = q.research && !q.research.running ? q.research : null;
  const head = rq ? null : q.window[0] ?? null, running = !q.frozen && r.phase === 'running';
  const blocked = running && !!head && head.blockedBy !== null;
  const risk = running && !!head && !head.committed && headRisk(q.met, q.failed, q.checking, q.slaWindow);
  const d = L.kind === 'desktop', n = L.N, icon = 16 * n;
  const ix = d ? L.lat : 8, iy = d ? L.lat : 16, tx = ix + icon + 8, w = L.dismiss.x - L.now.x - tx - 8;
  const lines = d ? [L.lat, L.lat + L.lh, L.lat + 2 * L.lh] : [16, 32, 48];
  const take = `${blocked ? `Blocked · ${seconds} s` : `${seconds} s to take`}`;
  const window = head?.deadline != null && !risk && fits(`${take} · done in ${windowText(head.deadline)}`, w, L.body) ? ` · done in ${windowText(head.deadline)}` : '';
  const key = box(L.dismiss, L.now);
  if (rq) return <section className="panel now research-now" data-k="now" aria-label="Research next in line" data-testid="now" style={box(L.now)}>
    <span className="aic" style={{ left: ix, top: iy }}><ArtCanvas w={16} h={16} n={n} artKey="flask" draw={drawFlask} /></span>
    <T x={tx} y={lines[0]!} w={L.now.w - tx - 8}><b>{rq.name}</b> <span className="rnd">{formatOps(rq.work)}</span></T>
    <T x={tx} y={lines[1]!} w={L.now.w - tx - 8} className="rnd"><span data-testid="head-clock">Next in line · runs on free threads</span></T>
    <T x={tx} y={lines[2]!} w={L.now.w - tx - 8} className="mute">{rq.progress > 0 ? `${Math.floor(rq.progress * 100)}% done · ` : ''}Tasks wait until a system takes it</T>
  </section>;
  return <section className={`panel now${blocked ? ' blocked' : ''}`} data-k="now" aria-label="Head task" data-testid="now"
    style={{ ...box(L.now), ...taskTypeStyle(head?.family), ...(risk ? { '--rim': 'var(--fault)' } : {}) } as CSSProperties}>
    <RimClock w={L.now.w} n={n} blocked={blocked} />
    {head && <>
      <TaskAccent n={n} />
      <span className="aic" style={{ left: ix, top: iy }}><TaskIcon task={head} n={n} /></span>
      <T x={tx} y={lines[0]!} w={w}><b>{familyName(head.family)}</b> <span className="gold">{payoutText(head)}</span></T>
      <T x={tx} y={lines[1]!} w={w}>{!running ? <span className="dim">Starts after Return</span>
        : <span className={blocked ? 'warn' : 'mute'}>{blocked ? blockedText(head) : sizeText(head)}</span>}</T>
      <T x={tx} y={lines[2]!} w={w}>{!running ? <AutoReturn />
        : head.committed ? <InQueue task={head} />
        : <><HeadClock blocked={blocked} risk={risk} />{window && <span className="mute">{window}</span>}</>}</T>
    </>}
    {running
      ? <button type="button" className={`skey${blocked ? ' warn' : ''}`} style={key} data-testid="dismiss" data-qa-target
        disabled={!head || !head.dismissible} title={head ? `Dismiss ${familyName(head.family)}: free, no SLA change` : undefined}
        onClick={() => { if (head?.dismissible) shell.dispatch({ type: 'dismissTask', task: head.task }); }}>Dismiss</button>
      : <button type="button" className={`skey primary${L.kind === 'phone' ? ' two' : ''}`} style={key} data-testid="return" data-qa-target
        disabled={!r.can || r.phase === 'ended'} title="Return to market: the next round starts" onClick={() => returnToMarket(shell)}>
        {/* Desktop fits one line; the phone key is 96 px, so the label is two deliberate lines. */}
        {L.kind === 'desktop' ? 'Return to market' : <><span>Return to</span><span>market</span></>}</button>}
  </section>;
}
