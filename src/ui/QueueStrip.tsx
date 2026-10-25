// The global queue at the top (D17.1, D10): five cards, the head first, marked by its state (its
// seconds left, "blocked", "in LB queue"). Tasks enter every level from here. Cards update in place,
// as the first release did (user, 25 Oct: the sliding was dizzying); a taken task just leaves its slot.
// The head's big card with its values and Dismiss sits at the bottom, above the deck (deck/NowCard.tsx).
import type { CSSProperties } from 'react';
import type { QueueEntryView, RenderSnapshot } from '../game';
import { MIN_VISIBLE_TRANSFER_S, type Rect } from '../render/core';
import { TaskAccent, taskTypeStyle } from './art/TaskType';
import { RimClock } from './hooks/headClock';
import { familyName, payoutShort, payoutText } from './hooks/feedModel';
import type { ShellLayout } from './layout';
import { headRisk } from './queue/risk';
import { fits, HeadClock, InQueue, needShort, shortSeconds, TaskIcon, taskTitle, windowText } from './queue/taskText';
import { box, T, useLayout } from './shell/geometry';
import { shallowEqual, useGameSelector } from './storeHooks';

export { TaskIcon } from './queue/taskText';

/** One task in its slot: the head reads its name and state, a card its name, payout and what it needs. */
function Tag({ L, t, slot, running, risk }: { L: ShellLayout; t: QueueEntryView; slot: number; running: boolean; risk: boolean }) {
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
    const name = familyName(t.family), full = payoutText(t), oneLine = head || fits(`${name} ${full}`, w, L.body);
    const pay = full;
    const lands = running && t.transferS !== null && t.transferS >= MIN_VISIBLE_TRANSFER_S;
    const extra = !running ? '' : blocked ? `needs ${needShort(t)}`
      : t.deadline !== null ? `· ${windowText(t.deadline)}` : lands ? `· ${shortSeconds(t.transferS!)}` : '';
    const room = (more: string) => fits(oneLine ? `${name} ${pay} ${more}` : `${pay} ${more}`, w, L.body);
    const tail = !head && extra && room(extra)
      ? <span className={blocked ? 'warn' : t.deadline !== null ? 'mute' : 'net'}> {extra}</span> : null;
    const values = <><span className={running ? 'gold' : 'dim'}>{pay}</span>{tail}</>;
    body = <>
      <span className="aic" style={{ left: L.lat, top: (rect.h - icon) / 2 }}><TaskIcon task={t} n={n} /></span>
      {oneLine ? <T x={tx} y={0} h={rect.h} w={w}><b>{name}</b> {head ? state : values}</T> : <>
        <T x={tx} y={0} w={w}><b>{name}</b></T>
        <T x={tx} y={L.lh} w={w}>{values}</T>
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
      <T x={8} y={40} w={rect.w - 16} className={!running ? 'dim' : blocked ? 'warn' : 'gold'}>{blocked ? needShort(t, true) : payoutShort(t)}</T>
    </>;
  }
  return <div className={`tag${head ? ' is-head' : ''}${blocked ? ' blocked' : ''}`} style={{ left: 0, top: 0, width: rect.w, height: rect.h, ...taskTypeStyle(t.family) }}
    data-task={`${t.task.epoch}:${t.task.roundIndex}:${t.task.taskId}`} data-k={head ? 'head-task' : `card${slot - 1}`} title={taskTitle(t)}>
    <TaskAccent n={n} />
    {body}
  </div>;
}

export const stripOf = (s: RenderSnapshot) => ({ window: s.feed.window, frozen: s.feed.timing !== 'running' || s.round.state !== 'running',
  delivered: s.hud.sla.deliveredWork, failed: s.hud.sla.failedWork, grace: s.hud.sla.grace });

export function QueueStrip() {
  const L = useLayout();
  const q = useGameSelector(stripOf, shallowEqual);
  const running = !q.frozen, head = q.window[0] ?? null;
  const blocked = running && !!head && head.blockedBy !== null;
  const risk = running && !!head && !head.committed && headRisk(q.delivered, q.failed, q.grace, head.work);
  const first = L.cards[0], last = L.cards[3];
  return <section className="queue" aria-label="Task queue" data-testid="queue">
    <div className={`panel head-slot${blocked ? ' blocked' : ''}${risk ? ' risk' : ''}`}
      style={{ ...box(L.headSlot), ...taskTypeStyle(head?.family), ...(risk ? { '--rim': 'var(--fault)' } as CSSProperties : {}) }}
      data-k="head-slot" data-testid="head-slot" aria-label="Head task">
      {head && <Tag L={L} t={head} slot={0} running={running} risk={risk} />}
      {/* Desktop: the bar on the top edge above one centred line; phone: on the bottom edge, clear of the name. */}
      <RimClock w={L.headSlot.w} n={L.N} blocked={blocked} top={L.kind === 'phone' ? L.headSlot.h - 3 * L.N : undefined} />
    </div>
    <ol className="panel slots" aria-label="Next tasks" style={box({ x: first.x, y: first.y, w: last.x + last.w - first.x, h: first.h })}>
      {L.cards.map((c, i) => {
        const t = q.window[i + 1];
        return <li key={i} className="slot" style={box(c, first)} data-k={`slot${i}`}>
          {t && <Tag L={L} t={t} slot={i + 1} running={running} risk={false} />}
        </li>;
      })}
    </ol>
  </section>;
}
