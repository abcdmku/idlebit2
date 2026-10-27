// The head task's big card, at the bottom above the deck (user, 25 Oct: "the main running task below
// like the photo"). Its name and payout, what it needs or its size, its 10 s take clock (or its
// completion window once taken, D26.5), the round-risk warning (A12), and a big Dismiss, which reads
// Return between rounds. It updates in place when the head changes.
import type { CSSProperties } from 'react';
import { useHeadSeconds, RimClock } from '../hooks/headClock';
import { familyName, payoutShort, payoutText, sizeText } from '../hooks/feedModel';
import { Payout, payoutFit } from '../queue/Payout';
import { blockedText } from '../hooks/taskRequirements';
import { returnToMarket } from '../input/commands';
import { TaskAccent, taskTypeStyle } from '../art/TaskType';
import { ArtCanvas } from '../art/ArtCanvas';
import { drawFlask } from '../art/deckArt';
import { formatOps } from '../../game';
import { stripOf } from '../QueueStrip';
import { headRisk } from '../queue/risk';
import { restartKey, restartOf, restartText } from '../queue/restart';
import { AutoReturn, fits, HeadClock, InQueue, needShort, roundOf, TaskIcon, windowText } from '../queue/taskText';
import { box, T, useLayout } from '../shell/geometry';
import { nowRows } from '../layout';
import { shallowEqual, useGameSelector, useShell, useViewState } from '../storeHooks';
import { meetLabel, useMeet } from '../queue/meet';
import { taskKey } from '../hooks/feedModel';
import { amountText } from '../hooks/format';
import { CoinIcon } from '../plates/icons';

export function NowCard() {
  const L = useLayout(), shell = useShell(), seconds = useHeadSeconds() ?? 10;
  const taskOpen = useViewState().task !== null;
  const q = useGameSelector(stripOf, shallowEqual), r = useGameSelector(roundOf, shallowEqual, 250);
  const restart = useGameSelector(restartOf, (a, b) => restartKey(a) === restartKey(b), 250);
  // D27: a started project waiting for room holds the front of the line; the card shows it instead.
  const rq = q.research && !q.research.running ? q.research : null;
  const head = rq ? null : q.window[0] ?? null, running = !q.frozen && r.phase === 'running';
  const blocked = running && !!head && head.blockedBy !== null;
  const needsFix = blocked && !head.committed && !taskOpen;
  const meet = useMeet(needsFix ? head : null);
  const buy = meet.filter(q => q.currency === 'credits' && !q.locked && q.affordable && !q.cold && !q.overSupply && BigInt(q.cost) > 0n)
    .sort((a, b) => BigInt(a.cost) < BigInt(b.cost) ? -1 : BigInt(a.cost) > BigInt(b.cost) ? 1 : 0)[0] ?? null;
  const risk = running && !!head && !head.committed && headRisk(q.met, q.failed, q.checking, q.slaWindow);
  const d = L.kind === 'desktop', n = L.N, icon = 16 * n;
  // Phone: the card shares its row with Research, so its text starts at the edge (no icon) and keeps the room.
  const ix = d ? L.lat : 8, iy = d ? nowRows(L).lines[0] : 16, tx = d ? ix + icon + 8 : 8, w = L.dismiss.x - L.now.x - tx - 8;
  // Reserved rows (R16): the name, the fix key under it, the failure line under that; the clock over Dismiss.
  const { lines, nameH, fixH } = nowRows(L);
  const take = blocked ? `${seconds} s left` : `${seconds} s to take`;
  const window = head?.deadline != null && !risk && fits(`${take} · done in ${windowText(head.deadline)}`, w, L.body) ? ` · done in ${windowText(head.deadline)}` : '';
  const key = box(L.dismiss, L.now);
  const payout = head ? fits(`${familyName(head.family)} ${payoutFit(payoutText(head))}`, w, L.body) ? payoutText(head)
    : fits(`${familyName(head.family)} ${payoutFit(payoutShort(head))}`, w, L.body) ? payoutShort(head) : '' : '';
  // A narrow key keeps its verb ("Upgrade") and lets the requirement line name the part, rather than clip the label (R17).
  const fullLabel = buy ? meetLabel(buy) : 'View fix', fixLabel = fits(fullLabel, w - 16, L.body) ? fullLabel : fullLabel.split(' ')[0]!;
  const fullSize = head ? sizeText(head) : '';
  const size = head && !fits(fullSize, w, L.body) ? formatOps(head.work) : fullSize;
  const priceFirst = !!buy && fits(`${fixLabel} ${amountText(buy.cost)}`, w - 24, L.body);
  const fixPrice = buy && <span className="fix-price"><CoinIcon />{amountText(buy.cost)}</span>;
  if (rq) return <section className="panel now research-now" data-k="now" aria-label="Research next in line" data-testid="now" style={box(L.now)}>
    {d && <span className="aic" style={{ left: ix, top: iy }}><ArtCanvas w={16} h={16} n={n} artKey="flask" draw={drawFlask} /></span>}
    <T x={tx} y={lines[0]!} h={nameH} w={L.now.w - tx - 8}><b>{rq.name}</b> <span className="rnd">{formatOps(rq.work)}</span></T>
    <T x={tx} y={lines[1]!} w={L.now.w - tx - 8} className="rnd"><span data-testid="head-clock">Next in line</span></T>
    <T x={tx} y={lines[2]!} w={L.now.w - tx - 8} className="mute">{rq.progress > 0 ? `${Math.floor(rq.progress * 100)}% done` : ''}</T>
  </section>;
  return <section className={`panel now${blocked ? ' blocked' : ''}`} data-k="now" aria-label="Head task" data-testid="now"
    style={{ ...box(L.now), ...taskTypeStyle(head?.family), ...(risk ? { '--rim': 'var(--fault)' } : {}) } as CSSProperties}>
    <RimClock w={L.now.w} n={n} blocked={blocked} />
    {head && <>
      <TaskAccent n={n} />
      {d && <span className="aic" style={{ left: ix, top: iy }}><TaskIcon task={head} n={n} /></span>}
      <T x={tx} y={lines[0]!} h={nameH} w={w}><b>{familyName(head.family)}</b>{payout && <> <span className="gold"><Payout text={payout} /></span></>}</T>
      {!needsFix && <T x={tx} y={lines[1]!} w={w}>{!running ? <span className="dim">Next round</span>
        // A restarting system holds no work: say so, so its 0 Hz cores aren't a mystery.
        : restart.on && !head.committed ? <span className="warn" data-testid="now-restart">{restartText(restart)}</span>
        : <span className={blocked ? 'warn' : 'mute'}>{blocked ? blockedText(head) : size}</span>}</T>}
      {!needsFix && <T x={tx} y={lines[2]!} w={w}>{!running ? r.phase === 'ended' ? null : <AutoReturn compact={w < 128} />
        : head.committed ? <InQueue task={head} short={!d} />
        : <><HeadClock blocked={blocked} risk={risk} short={!d && !blocked} />{window && <span className="mute">{window}</span>}</>}</T>}
    </>}
    {running && head && !taskOpen && <button type="button" data-testid="now-detail" data-qa-target
      className={`now-detail${needsFix ? ' now-fix' : ''}`} style={needsFix ? { left: tx, top: lines[1], width: Math.min(w, 320), height: fixH, lineHeight: `${(fixH - 8) / 2}px` } : { left: tx, top: lines[0], width: w, height: Math.max(48, 3 * L.lh) }}
      aria-label={needsFix ? buy ? `Fix ${familyName(head.family)} for ${amountText(buy.cost)} Credits` : `Fix ${familyName(head.family)}: open requirements` : `${familyName(head.family)}: details`}
      onClick={() => { if (needsFix && buy) shell.dispatch(buy.action); else shell.view.dispatch({ type: 'openTask', task: taskKey(head.task) }); }}>
      {needsFix && <><b>{fixLabel}{priceFirst && fixPrice}</b><span className="fix-note">{buy ? needShort(head) : blockedText(head)?.replace(/^Needs /, '')}{!priceFirst && fixPrice}</span></>}
    </button>}
    {needsFix && <T x={key.left as number} y={lines[0]} h={nameH} w={key.width as number} className={risk ? 'bad' : 'warn'}><span data-testid="head-clock">{seconds} s</span></T>}
    {running && !taskOpen
      ? <button type="button" className="skey" style={key} data-testid="dismiss" data-qa-target
        disabled={!head || !head.dismissible} title={head ? `Dismiss ${familyName(head.family)}: free, no SLA change` : undefined}
        onClick={() => { if (head?.dismissible) shell.dispatch({ type: 'dismissTask', task: head.task }); }}>Dismiss</button>
      // While the round report is up it carries the one Return key (QA-17).
      : running || r.phase === 'ended' ? null
      : <button type="button" className="skey primary" style={key} data-testid="return" data-qa-target
        disabled={!r.can} title="Return to market: the next round starts" onClick={() => returnToMarket(shell)}>
        Return</button>}
  </section>;
}
