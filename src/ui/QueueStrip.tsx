// The global queue at the top (D17.1, D10): five cards, the head first, marked by its state (its
// seconds left, "blocked", "in LB queue"). Tasks enter every level from here. Cards update in place,
// as the first release did (user, 25 Oct: the sliding was dizzying); a taken task just leaves its slot.
// The head's big card with its values and Dismiss sits at the bottom, above the deck (deck/NowCard.tsx).
import type { CSSProperties } from 'react';
import { formatOps, type QueueEntryView, type RenderSnapshot, type ResearchQueueEntryView } from '../game';
import { ArtCanvas } from './art/ArtCanvas';
import { drawFlask } from './art/deckArt';
import { MIN_VISIBLE_TRANSFER_S, type Rect } from '../render/core';
import { TaskAccent, taskTypeStyle } from './art/TaskType';
import { RimClock } from './hooks/headClock';
import { familyName, payoutShort, payoutText } from './hooks/feedModel';
import type { ShellLayout } from './layout';
import { headRisk, SLA_WINDOW } from './queue/risk';
import { fits, HeadClock, InQueue, needShort, shortSeconds, TaskIcon, taskTitle, windowText } from './queue/taskText';
import { box, T, useLayout } from './shell/geometry';
import { shallowEqual, useGameSelector } from './storeHooks';

export { TaskIcon } from './queue/taskText';

/** One task in its slot: the head reads its name and state, a card its name, payout and what it needs. */
function Tag({ L, t, slot, running, risk, waiting = false }: { L: ShellLayout; t: QueueEntryView; slot: number; running: boolean; risk: boolean;
  /** D27: research waits at the front, so the market's head waits behind it. */ waiting?: boolean }) {
  const head = slot === 0, d = L.kind === 'desktop', n = L.N, icon = 16 * n;
  const rect: Rect = head ? L.headSlot : L.cards[slot - 1]!;
  const blocked = running && t.blockedBy !== null;
  let body;
  if (d) {
    const tx = L.lat + icon + 8, w = rect.w - tx - 8;
    const state = !running ? <span className="dim">next</span>
      : t.committed ? <InQueue task={t} short testId="strip-state" />
      : <HeadClock blocked={blocked} risk={risk} short testId="strip-state" />;
    // One centred line per card, as in the first release: the head reads its name and state (its values
    // are on the big card below); a card its name and payout, then what it needs, its completion window
    // or its transfer time, only when that fits whole.
    // A card whose name and payout won't share a line takes two (cards have no clock bar to clear).
    // The head's name never gets cut: with its longest state word it either fits one line or takes two.
    const name = familyName(t.family), full = payoutText(t);
    const oneLine = head ? fits(`${name} ${!running ? 'next' : t.committed ? 'restarting 10 s' : 'blocked'}`, w, L.body) : fits(`${name} ${full}`, w, L.body);
    const pay = full;
    const lands = running && t.transferS !== null && t.transferS >= MIN_VISIBLE_TRANSFER_S;
    const extra = !running ? '' : waiting ? '· waiting' : blocked ? `needs ${needShort(t)}`
      : t.deadline !== null ? `· ${windowText(t.deadline)}` : lands ? `· ${shortSeconds(t.transferS!)}` : '';
    const room = (more: string) => fits(oneLine ? `${name} ${pay} ${more}` : `${pay} ${more}`, w, L.body);
    const tail = !head && extra && room(extra)
      ? <span className={waiting ? 'dim' : blocked ? 'warn' : t.deadline !== null ? 'mute' : 'net'}> {extra}</span> : null;
    const values = <><span className={running ? 'gold' : 'dim'}>{pay}</span>{tail}</>;
    body = <>
      <span className="aic" style={{ left: L.lat, top: (rect.h - icon) / 2 }}><TaskIcon task={t} n={n} /></span>
      {oneLine ? <T x={tx} y={0} h={rect.h} w={w}><b>{name}</b> {head ? state : values}</T> : <>
        <T x={tx} y={0} w={w}><b>{name}</b></T>
        <T x={tx} y={L.lh} w={w}>{head ? state : values}</T>
      </>}
    </>;
  } else if (head) {
    const state = !running ? <span className="dim">next</span>
      : t.committed ? <InQueue task={t} short testId="strip-state" />
      : <HeadClock blocked={blocked} risk={risk} short testId="strip-state" />;
    body = <>
      <span className="aic" style={{ left: 8, top: 8 }}><TaskIcon task={t} n={n} /></span>
      <T x={48} y={16} w={rect.w - 48 - 4}>{state}</T>
      <T x={8} y={40} w={rect.w - 16}>{familyName(t.family)}</T>
    </>;
  } else {
    body = <>
      <span className="aic" style={{ left: Math.round((rect.w - icon) / 16) * 8, top: 8 }}><TaskIcon task={t} n={n} /></span>
      <T x={8} y={40} w={rect.w - 8} className={!running ? 'dim' : blocked ? 'warn' : 'gold'}>{blocked ? needShort(t, true) : payoutShort(t)}</T>
    </>;
  }
  return <div className={`tag${head ? ' is-head' : ''}${blocked ? ' blocked' : ''}`} style={{ left: 0, top: 0, width: rect.w, height: rect.h, ...taskTypeStyle(t.family) }}
    data-task={`${t.task.epoch}:${t.task.roundIndex}:${t.task.taskId}`} data-k={head ? 'head-task' : `card${slot - 1}`} title={taskTitle(t)}>
    <TaskAccent n={n} />
    {body}
  </div>;
}

/** D27: research at the front of the line: the flask, its name and work, "next in line"; no clock, no Dismiss. */
function ResearchTag({ L, r }: { L: ShellLayout; r: ResearchQueueEntryView }) {
  const d = L.kind === 'desktop', n = L.N, icon = 16 * n, rect = L.headSlot;
  const flask = <ArtCanvas w={16} h={16} n={n} artKey="flask" draw={drawFlask} />;
  if (!d) return <div className="tag is-head research" style={{ left: 0, top: 0, width: rect.w, height: rect.h }} data-k="head-task" data-testid="research-head" title={`${r.name}: next in line`}>
    <span className="aic" style={{ left: 8, top: 8 }}>{flask}</span>
    <T x={48} y={16} w={rect.w - 52} className="rnd">next</T>
    <T x={8} y={40} w={rect.w - 16}>{r.name}</T>
  </div>;
  const tx = L.lat + icon + 8, w = rect.w - tx - 8, ops = formatOps(r.work);
  return <div className="tag is-head research" style={{ left: 0, top: 0, width: rect.w, height: rect.h }} data-k="head-task" data-testid="research-head" title={`${r.name}: ${ops}, next in line`}>
    <span className="aic" style={{ left: L.lat, top: (rect.h - icon) / 2 }}>{flask}</span>
    <T x={tx} y={0} h={rect.h} w={w}><b>{r.name}</b> <span className="rnd">{fits(`${r.name} ${ops} next`, w, L.body) ? `${ops} · ` : ''}next</span></T>
  </div>;
}

export const stripOf = (s: RenderSnapshot) => ({ window: s.feed.window, research: s.feed.research, frozen: s.feed.timing !== 'running' || s.round.state !== 'running',
  // D28: the SLA counts tasks over the round's last `window` resolved; the floor applies once `checking`.
  met: s.hud.sla.met, failed: s.hud.sla.failed, checking: s.hud.sla.checking, slaWindow: slaWindowOf(s) });

/** D28: the rolling window, once the snapshot publishes it. */
export const slaWindowOf = (s: RenderSnapshot): number => (s.hud.sla as { window?: number }).window ?? SLA_WINDOW;

export function QueueStrip() {
  const L = useLayout();
  const q = useGameSelector(stripOf, shallowEqual);
  // D27: a started project waiting for room is the head; the market's tasks wait behind it, no clock runs.
  const rq = q.research && !q.research.running ? q.research : null;
  const running = !q.frozen, head = rq ? null : q.window[0] ?? null, behind = rq ? 0 : 1;
  const blocked = running && !!head && head.blockedBy !== null;
  const risk = running && !!head && !head.committed && headRisk(q.met, q.failed, q.checking, q.slaWindow);
  const first = L.cards[0], last = L.cards[3];
  return <section className="queue" aria-label="Task queue" data-testid="queue">
    <div className={`panel head-slot${blocked ? ' blocked' : ''}${risk ? ' risk' : ''}${rq ? ' research-head' : ''}`}
      style={{ ...box(L.headSlot), ...taskTypeStyle(head?.family), ...(risk ? { '--rim': 'var(--fault)' } as CSSProperties : {}) }}
      data-k="head-slot" data-testid="head-slot" aria-label="Head task">
      {rq ? <ResearchTag L={L} r={rq} /> : head && <Tag L={L} t={head} slot={0} running={running} risk={risk} />}
      {/* Desktop: the bar on the top edge above one centred line; phone: on the bottom edge, clear of the name. */}
      <RimClock w={L.headSlot.w} n={L.N} blocked={blocked} top={L.kind === 'phone' ? L.headSlot.h - 3 * L.N : undefined} />
    </div>
    <ol className="panel slots" aria-label="Next tasks" style={box({ x: first.x, y: first.y, w: last.x + last.w - first.x, h: first.h })}>
      {L.cards.map((c, i) => {
        const t = q.window[i + behind];
        return <li key={i} className="slot" style={box(c, first)} data-k={`slot${i}`}>
          {t && <Tag L={L} t={t} slot={i + 1} running={running} risk={false} waiting={!!rq && i === 0} />}
        </li>;
      })}
    </ol>
  </section>;
}
