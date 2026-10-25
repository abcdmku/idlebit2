// The "now" card: the head task repeated in the deck with its free Dismiss (D10.3, D10.8), so the
// phone keeps Dismiss in the bottom-right thumb zone. Between rounds the same key returns to market.
import { clockTone, RimClock, useHeadSeconds } from '../hooks/headClock';
import { familyName, payoutText, sizeText } from '../hooks/feedModel';
import { clockText } from '../hooks/format';
import { blockedText } from '../hooks/taskRequirements';
import { returnToMarket } from '../input/commands';
import { TaskIcon } from '../QueueStrip';
import { TaskAccent, taskTypeStyle } from '../art/TaskType';
import { box, T, useLayout } from '../shell/geometry';
import { shallowEqual, useGameSelector, useShell } from '../storeHooks';

export function NowCard() {
  const L = useLayout(), shell = useShell(), seconds = useHeadSeconds();
  const head = useGameSelector(s => s.feed.window[0] ?? null);
  const r = useGameSelector(s => ({ phase: s.round.state, can: s.round.canReturn, auto: s.round.autoReturn.inMs }), shallowEqual, 250);
  const running = r.phase === 'running', blocked = running && !!head && head.blockedBy !== null;
  const d = L.kind === 'desktop', n = L.N, icon = 16 * n, tx = L.lat + icon + 8;
  const s = seconds ?? 10;
  const clock = !running ? (r.auto !== null ? `Auto return in ${clockText(r.auto)}` : 'Round over')
    : blocked ? `Blocked · ${s} s` : `${s} s to take`;
  const clockClass = !running ? 'dim' : blocked ? 'warn' : clockTone(s);
  const need = head ? (blocked ? blockedText(head) : sizeText(head)) : '';
  const key = box(L.dismiss, L.now);
  return <section className={`panel now${blocked ? ' blocked' : ''}`} style={{ ...box(L.now), ...taskTypeStyle(head?.family) }} data-k="now" aria-label="Head task" data-testid="now">
    <RimClock w={L.now.w} n={n} blocked={blocked} />
    {head && <>
      <TaskAccent n={n} />
      <span className="aic" style={{ left: L.lat, top: d ? L.lat : 2 * L.lat }}>
        <TaskIcon task={head} n={n} />
      </span>
      {d ? <>
        <T x={tx} y={L.lat} w={L.dismiss.x - L.now.x - tx - 8}><b>{familyName(head.family)}</b></T>
        <T x={tx} y={L.lat + L.lh} w={L.dismiss.x - L.now.x - tx - 8} className={`${blocked ? 'warn' : 'mute'}`}>{need}</T>
        <T x={L.lat} y={3 * L.lat}><span className="gold">{payoutText(head)}</span> <span className="dim">·</span> <span className={clockClass} data-testid="now-clock">{clock}</span></T>
      </> : <>
        <T x={tx} y={16} w={L.dismiss.x - L.now.x - tx - 8}><b>{familyName(head.family)}</b></T>
        <T x={tx} y={32} w={L.dismiss.x - L.now.x - tx - 8} className={`${blocked ? 'warn' : 'mute'}`}>{need}</T>
        <T x={tx} y={48} className={clockClass}><span data-testid="now-clock">{clock}</span></T>
      </>}
    </>}
    {running
      ? <button type="button" className={`skey${blocked ? ' warn' : ''}`} style={key} data-testid="dismiss" data-qa-target
        disabled={!head || !head.dismissible} title={head ? `Dismiss ${familyName(head.family)}: free, no SLA change` : undefined}
        onClick={() => { if (head?.dismissible) shell.dispatch({ type: 'dismissTask', task: head.task }); }}>Dismiss</button>
      : <button type="button" className="skey go two" style={key} data-testid="return" data-qa-target
        disabled={!r.can} onClick={() => returnToMarket(shell)}><span>Return to</span><span>market</span></button>}
  </section>;
}
