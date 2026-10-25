// The global queue at the top (D17.1, D10, user 25 Oct): the head leads the strip with its 10 s on
// the rim, its values and Dismiss, then the next 4. Tasks enter every level from here: the strip is
// a conveyor, and a taken head drops through its bottom edge into the pipe.
// Frames and the Dismiss key stay fixed; only the task tags move (queue/motion.ts). The head and the
// cards have their own clipped belts, so a sliding card never crosses the head's text or its key.
import { useCallback, useRef, type CSSProperties } from 'react';
import { TICK_MS, type QueueEntryView, type RenderSnapshot } from '../game';
import { MIN_VISIBLE_TRANSFER_S, type Rect } from '../render/core';
import { ArtCanvas } from './art/ArtCanvas';
import { drawTaskIcon } from './art/deckArt';
import { TaskAccent, taskTypeStyle } from './art/TaskType';
import { clockTone, RimClock, useHeadSeconds, useWindowLeft, windowText } from './hooks/headClock';
import { familyName, payoutShort, payoutText, sizeText, transferText } from './hooks/feedModel';
import { clockText } from './hooks/format';
import { blockedText, taskBits } from './hooks/taskRequirements';
import { returnToMarket } from './input/commands';
import type { ShellLayout } from './layout';
import type { ConveyorItem, Leave } from './queue/conveyor';
import { useConveyor } from './queue/motion';
import { headRisk } from './queue/risk';
import { box, T, useLayout } from './shell/geometry';
import { shallowEqual, useGameSelector, useShell, useViewState } from './storeHooks';

export function TaskIcon({ task, n }: { task: QueueEntryView; n: number }) {
  return <ArtCanvas w={16} h={16} n={n} artKey={String(task.family)} draw={g => drawTaskIcon(g, task.family)} />;
}

/** Whether a line of body text fits w px (Chakra Petch averages about 0.48 em a character). */
const fits = (text: string, w: number, body: number): boolean => text.length * body * 0.48 <= w;

/** A transfer time on a narrow card (1280 desktop): "2.3 s", "12 s"; the wider cards say "lands 2.34 s". */
const shortSeconds = (s: number): string => (s < 10 ? `${s.toFixed(1)} s` : `${Math.round(s)} s`);

/** What a blocked task is missing, short: "2 bits" when the cache is short, else the reason. */
function needShort(task: QueueEntryView, tiny = false): string {
  switch (task.blockedBy) {
    case 'cache': case 'ram': case 'disk': return taskBits(task.workingSetBits);
    case 'vram': return tiny ? taskBits(task.vramBits) : `${taskBits(task.vramBits)} VRAM`;
    case 'gpu': return tiny ? 'GPU' : task.tensor ? 'tensor' : 'GPU';
    case 'gpuCores': return tiny ? 'GPU' : `${task.gpuCoresMin} cores`;
    case 'members': return tiny ? `${task.members} sys` : `${task.members} systems`;
    case 'zones': return `${task.minZones} zones`;
    default: return (blockedText(task) ?? '').replace(/^Needs /, '');
  }
}

function title(task: QueueEntryView): string {
  const blocked = blockedText(task);
  return `${familyName(task.family)}: ${sizeText(task)}${task.transferS === null ? '' : `, lands in ${transferText(task.transferS)}`}${blocked ? `. ${blocked}` : ''}`;
}

const roundOf = (s: RenderSnapshot) => ({ phase: s.round.state, can: s.round.canReturn, auto: s.round.autoReturn.inMs });

/** The head's clock: seconds left to be taken; `risk` when its failure alone would end the round (A12). */
function HeadClock({ blocked, risk }: { blocked: boolean; risk: boolean }) {
  const seconds = useHeadSeconds() ?? 10;
  const text = risk ? `${seconds} s · a fail ends the round` : blocked ? `${seconds} s` : `${seconds} s to take`;
  return <span className={risk ? 'bad' : blocked ? 'warn' : clockTone(seconds)} data-testid="head-clock">{text}</span>;
}

/** A taken task back at the front: no take clock, but its completion window runs (D25.7, D26.5). */
function InQueue({ task }: { task: QueueEntryView }) {
  const left = useWindowLeft(task.windowEndTick);
  if (left === null || task.deadline === null) return <span className="cyan" data-testid="head-clock">In LB queue</span>;
  const low = left * 1000 <= task.deadline * TICK_MS / 4;
  return <span className={low ? 'warn' : 'cyan'} data-testid="head-clock">In LB queue · {clockText(left * 1000)} left</span>;
}

/** Between rounds the queue is frozen until Return (spec §4.1.5). */
function AutoReturn() {
  const r = useGameSelector(roundOf, shallowEqual, 250);
  return r.auto !== null ? <span className="dim" data-testid="head-clock">Auto return in {clockText(r.auto)}</span> : null;
}

const LEFT: Readonly<Record<Leave, [string, string]>> = { taken: ['Taken', 'cyan'], dismissed: ['Dismissed', 'dim'], failed: ['Failed', 'bad'], pushed: ['', 'dim'] };

interface Belt { readonly head: Rect; readonly cards: Rect }

/** One task on its belt: the head reads its values and clock, a card its payout and what it needs. */
function Tag({ L, belt, item, running, risk }: { L: ShellLayout; belt: Belt; item: ConveyorItem; running: boolean; risk: boolean }) {
  const t = item.task, head = item.slot === 0, d = L.kind === 'desktop', n = L.N, icon = 16 * n;
  const rect = head ? belt.head : L.cards[item.slot - 1]!, origin = head ? belt.head : belt.cards;
  const blocked = running && t.blockedBy !== null;
  const ix = d ? L.lat : 8, iy = d ? L.lat : head ? 16 : 8, tx = d ? ix + icon + 8 : 48;
  const w = rect.w - tx - 8;
  const cls = `tag${head ? ' is-head' : ''}${blocked ? ' blocked' : ''}${item.leave ? ` left-${item.leave}` : ''}`;
  let body;
  if (head) {
    const lines = d ? (L.N === 3 ? [16, 40, 64] : [8, 24, 40]) : [8, 24, 40];
    const third = item.leave ? <span className={LEFT[item.leave][1]}>{LEFT[item.leave][0]}</span>
      // A taken entry back at the front (returned, or held for a router queue) has no clock (D25.7).
      : running && t.committed ? <InQueue task={t} />
      : running ? <>{<HeadClock blocked={blocked} risk={risk} />}{t.deadline !== null && !risk && <span className="mute"> · done in {windowText(t.deadline)}</span>}</>
      : <AutoReturn />;
    body = <>
      <T x={tx} y={lines[0]!} w={w}><b>{familyName(t.family)}</b> <span className="gold">{payoutText(t)}</span></T>
      <T x={tx} y={lines[1]!} w={w}>{!running ? <span className="dim">Starts after Return</span>
        : <span className={blocked ? 'warn' : 'mute'}>{blocked ? blockedText(t) : sizeText(t)}</span>}</T>
      <T x={tx} y={lines[2]!} w={w}>{third}</T>
    </>;
  } else if (d) {
    const lands = running && t.transferS !== null && t.transferS >= MIN_VISIBLE_TRANSFER_S;
    // A narrow card (1280) gives the name two lines rather than cut it; a wide one keeps name over values.
    const narrow = w < 144, nameY = narrow ? (L.N === 3 ? 16 : 8) : L.lat, infoY = narrow ? nameY + 2 * L.lh : L.lat + L.lh;
    body = <>
      <T x={tx} y={nameY} w={w} className={narrow ? 'wrap2' : undefined}><b>{familyName(t.family)}</b></T>
      <T x={tx} y={infoY} w={w}>{!running ? <span className="dim">after Return</span>
        : blocked ? <span className="warn">{w >= 144 ? 'needs ' : ''}{needShort(t)}</span>
        // A completion window (D26.5) says more than the transfer time, which the pipe already shows.
        : <><span className="gold">{payoutText(t)}</span>{t.deadline !== null ? <> <span className="mute">· {fits(`${payoutText(t)} · done in ${windowText(t.deadline)}`, w, L.body) ? 'done in ' : ''}{windowText(t.deadline)}</span></>
          : lands && <> <span className="net">{w >= 144 ? `lands ${transferText(t.transferS!)}` : `· ${shortSeconds(t.transferS!)}`}</span></>}</>}</T>
    </>;
  } else {
    body = <T x={tx} y={16} w={rect.w - tx} className={!running ? 'dim' : blocked ? 'warn' : 'gold'}>{blocked ? needShort(t, true) : payoutShort(t)}</T>;
  }
  return <div className={cls} style={{ ...box(rect, origin), ...taskTypeStyle(t.family) }} data-key={item.key} data-task={item.key}
    data-k={head ? 'head-task' : `card${item.slot - 1}`} title={title(t)}>
    <TaskAccent n={n} />
    <span className="aic" style={{ left: ix, top: iy }}><TaskIcon task={t} n={n} /></span>
    {body}
  </div>;
}

/** Dismiss the head (free, no SLA change); between rounds the same key reads Return, inert while the report is open. */
function HeadKey({ L, head }: { L: ShellLayout; head: QueueEntryView | null }) {
  const shell = useShell(), r = useGameSelector(roundOf, shallowEqual, 250);
  const blocked = !!head && head.blockedBy !== null;
  return r.phase === 'running'
    ? <button type="button" className={`skey${blocked ? ' warn' : ''}`} style={box(L.dismiss)} data-testid="dismiss" data-qa-target
      disabled={!head || !head.dismissible} title={head ? `Dismiss ${familyName(head.family)}: free, no SLA change` : undefined}
      onClick={() => { if (head?.dismissible) shell.dispatch({ type: 'dismissTask', task: head.task }); }}>Dismiss</button>
    : <button type="button" className="skey primary" style={box(L.dismiss)} data-testid="return" data-qa-target
      disabled={!r.can || r.phase === 'ended'} title="Return to market: the next round starts"
      onClick={() => returnToMarket(shell)}>Return</button>;
}

const stripOf = (s: RenderSnapshot) => ({ window: s.feed.window, taken: s.feed.taken, dismissed: s.feed.dismissed,
  round: `${s.epoch}:${s.feed.roundIndex}:${s.feed.timing}`, frozen: s.feed.timing !== 'running' || s.round.state !== 'running',
  delivered: s.hud.sla.deliveredWork, failed: s.hud.sla.failedWork, grace: s.hud.sla.grace });

export function QueueStrip() {
  const L = useLayout(), reduced = useViewState().reducedMotion;
  const q = useGameSelector(stripOf, shallowEqual), ref = useRef<HTMLDivElement>(null);
  const first = L.cards[0], last = L.cards[3];
  const belt: Belt = { head: { ...L.headSlot, w: L.dismiss.x - 8 - L.headSlot.x }, cards: { x: first.x, y: first.y, w: last.x + last.w - first.x, h: first.h } };
  const slotRect = useCallback((slot: number) => (slot === 0 ? { ...L.headSlot, w: L.dismiss.x - 8 - L.headSlot.x } : L.cards[slot - 1]!), [L]);
  const conveyor = useConveyor(q, ref, slotRect, reduced);
  const running = !q.frozen, head = q.window[0] ?? null;
  const blocked = running && !!head && head.blockedBy !== null;
  const risk = running && !!head && !head.committed && headRisk(q.delivered, q.failed, q.grace, head.work);
  const items = (slot0: boolean) => conveyor.items.filter(i => (i.slot === 0) === slot0)
    .map(item => <Tag key={item.key} L={L} belt={belt} item={item} running={running} risk={risk} />);
  return <section ref={ref} className="queue" aria-label="Task queue" data-testid="queue">
    <div className={`panel head-slot${blocked ? ' blocked' : ''}${risk ? ' risk' : ''}`} style={{ ...box(L.headSlot), ...taskTypeStyle(head?.family), ...(risk ? { '--rim': 'var(--fault)' } as CSSProperties : {}) }}
      data-k="head-slot" data-testid="head-slot" aria-label="Head task">
      <RimClock w={L.headSlot.w} n={L.N} blocked={blocked} />
    </div>
    <ol className="panel slots" aria-label="Next tasks" style={box(belt.cards)}>
      {L.cards.map((c, i) => <li key={i} className="slot" style={box(c, first)} data-k={`slot${i}`} />)}
    </ol>
    <div className="belt" style={box(belt.head)} data-belt="head">{items(true)}</div>
    <div className="belt" style={box(belt.cards)} data-belt="cards">{items(false)}</div>
    <HeadKey L={L} head={head} />
  </section>;
}
