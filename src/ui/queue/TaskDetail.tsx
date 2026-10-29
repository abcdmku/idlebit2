// Task detail (user, 26 Oct): tapping any of the five strip cards opens what that task is, what it
// pays and needs, and whether it can run. A plate right under the tapped card, with a pointer to it (user, 26 Oct); over the
// bottom of the world. Back and Escape close it (viewState 'back'). No task numbers (D22).
import { useMemo } from 'react';
import { formatHertz, formatOps, type QueueEntryView } from '../../game';
import { typeColor, typeName, typeOf, type Rect } from '../../render/core';
import { CoinIcon, GemIcon } from '../plates/icons';
import { useShellOffers } from '../deck/useOffers';
import { actionable, WALL_ROWS, type Offer, type Offers } from '../deck/offers';
import { offerAction, useTapOffer } from '../deck/offerUi';
import { familyName, taskKey, transferText } from '../hooks/feedModel';
import { wholeText } from '../hooks/format';
import { blockedText, taskBits, waitingText } from '../hooks/taskRequirements';
import { pointAt, pointFix } from '../input/pointAt';
import { PlateFrame } from '../plates/PlateFrame';
import { useLayout } from '../shell/geometry';
import { shallowEqual, useGameSelector, useShell, useViewState } from '../storeHooks';
import { HeadClock, InQueue, TaskIcon } from './taskText';
import { useMeet } from './meet';
import { MeetKey } from './MeetKey';
import { TaskWork } from './TaskWork';
import { plateArea, plateSpill } from '../plates/PlateLayer';

/** Keeps every number with its unit on one line ("100 kHz", "1 ms", "2 b", "4 systems"): a no-break space between them. */
export const keepUnits = (s: string): string => s.replace(/([0-9][kMGTPEZY]?) (?=[A-Za-z%µ])/g, '$1\u00a0');

/** What the task needs, one plain line each: memory, GPU, shards, zones. */
export function needLines(t: QueueEntryView): string[] {
  const out: string[] = [];
  if (t.workingSetBits > 0) out.push(`${taskBits(t.workingSetBits)} memory`);
  if (t.gpuCoresMin > 0 || t.stages.some(s => s.resource === 'gpu')) out.push(t.gpuCoresMin > 0 ? `GPU · ${t.gpuCoresMin} cores` : t.tensor ? 'Tensor GPU' : 'GPU');
  if (t.vramBits > 0) out.push(`${taskBits(t.vramBits)} VRAM`);
  if (t.ecc) out.push('ECC RAM');
  if (t.members > 1) out.push(`${t.members} systems`);
  if (t.minZones > 1) out.push(`${t.minZones} zones`);
  return (out.length ? out : ['CPU']).map(keepUnits);
}

/** "1,000 ops · lands in 1 s on 1 kHz": its work, and its input over the current first link. */
export function workLine(t: QueueEntryView): string {
  const work = `${formatOps(t.work)}`;
  if (t.transferS === null || !(t.transferS > 0)) return keepUnits(work);
  return keepUnits(`${work} · lands in ${transferText(t.transferS)} on ${formatHertz(t.payloadBits / t.transferS)}`);
}

/** Whole Data contribution; fractions carry across tasks in the simulation's meter. */
export const dataOf = (t: QueueEntryView): number => Math.floor(t.dataReward);

/** How many online systems could run it at all (its fixed hardware, ignoring load). */
export const capableText = (n: number): string =>
  n === 0 ? 'No system can run it' : `${n} of your systems can run it`;

/** "Needs …" → "needs …", "Power supply down" → "power supply down"; "UPS down" keeps its capitals. */
const lowerFirst = (s: string) => (/^[A-Z][a-z]/.test(s) ? s[0]!.toLowerCase() + s.slice(1) : s);

/** Status in plain words. */
export function statusLine(t: QueueEntryView, running: boolean): { text: string; tone: '' | 'warn' | 'mute' } {
  if (!running) return { text: 'Next round', tone: 'mute' };
  if (t.blockedBy) return { text: keepUnits(`Blocked: ${lowerFirst(blockedText(t) ?? '')}`), tone: 'warn' };
  return { text: waitingText(t), tone: 'mute' };
}

/**
 * What fixes a blocked task, one line per missing component or research (user, 26 Oct). Today the sim
 * names the first missing requirement only, so this is at most one line from the same rule as the Fix line
 * (WALL_ROWS, never a dead end); the sim's `meet` quote will return every line, each at its minimal level.
 */
export function fixLines(t: QueueEntryView, offers: Offers | null): Offer[] {
  const one = fixFor(t, offers);
  return one ? [one] : [];
}

/** What a fix line says: research it, install it (from nothing), or buy the levels it needs. */
export function fixLabel(o: Offer): string {
  if (o.right.kind === 'research') return `Research ${o.right.node}`;
  const install = /^Add /.test(o.name) || o.quote?.action.type === 'replacePart' || o.quote?.action.type === 'addPart' || o.quote?.action.type === 'installGpu';
  return install ? `Install ${o.name.replace(/^Add /, '')}${o.change ? ` ${o.change}` : ''}` : `Buy ${o.name}${o.change ? ` ${o.change}` : ''}`;
}

/** The fix for a blocked task: the same rule as the Fix line and the featured buy (WALL_ROWS, never a dead end). */
export function fixFor(t: QueueEntryView, offers: Offers | null): Offer | null {
  const keys = t.blockedBy ? WALL_ROWS[t.blockedBy] ?? [] : [];
  for (const k of keys) { const o = offers?.rows.find(r => r.key === k && actionable(r)); if (o) return o; }
  return null;
}

/** The connected detail: null unless a card's task is open and still in the line. */
export function TaskDetail() {
  const v = useViewState();
  if (!v.task || v.sheet) return null;
  return <OpenTask taskKey={v.task} />;
}

function OpenTask({ taskKey: key }: { taskKey: string }) {
  const shell = useShell(), L = useLayout(), offers = useShellOffers(), tap = useTapOffer();
  const f = useGameSelector(s => {
    const research = s.feed.research && !s.feed.research.running;
    const i = s.feed.window.findIndex(t => taskKey(t.task) === key);
    return { t: i >= 0 ? s.feed.window[i]! : null, slot: i < 0 ? -1 : research ? i + 1 : i, running: s.feed.timing === 'running' && s.round.state === 'running' };
  }, shallowEqual, 250);
  // One line per missing component, each at its minimal level (the sim's meet quote).
  const meet = useMeet(f.t);
  const card = f.slot === 0 ? L.headSlot : L.cards[f.slot - 1] ?? L.cards[0];
  const readAnchor = useMemo(() => anchorOf(card, key), [card.x, card.y, card.w, card.h, key]);
  const primaryMeet = meet.find(q => !q.locked && q.affordable) ?? meet[0];
  // A task that left the line (taken, met or dismissed) closes its detail.
  if (!f.t) { queueMicrotask(() => { if (shell.view.getState().task === key) shell.view.dispatch({ type: 'back' }); }); return null; }
  const t = f.t, head = f.slot === 0, color = typeColor(typeOf(t.family));
  // The meet lines; when the sim has none for this gate (a link, zones), the Fix line's own rule.
  // A down power supply or a hot rack is a part to look at: its plate, not a row to buy (lead, 26 Oct).
  const point = pointFix(t.blockedBy);
  const status = statusLine(t, f.running), fixes = t.blockedBy && !meet.length && !point ? fixLines(t, offers) : [];
  const needs = needLines(t).filter((_, i) => !(i === 0 && t.workingSetBits > 0 && ['cache', 'ram', 'disk'].includes(t.blockedBy ?? '')));
  const close = () => shell.view.dispatch({ type: 'back' });
  const area = plateArea(L, L.view);
  return <PlateFrame title={familyName(t.family)} sub={<span style={{ color }}>{typeName(typeOf(t.family))}</span>}
    className="task-detail" bounds={area} spill={plateSpill(L, area)} readAnchor={readAnchor} tip onClose={close}
    head={<span className="td-ic"><TaskIcon task={t} n={L.N} /></span>}>
    <p className={`p-line td-status ${status.tone}`} data-testid="td-status">{status.text}</p>
    <dl className="td-facts">
      <dt>Pays</dt><dd data-testid="td-pays"><span className="gold" title={`${t.cpuOps} Credits`}><CoinIcon />{wholeText(t.cpuOps)}</span>
        {dataOf(t) > 0 && <span className="data" title="Whole Data contribution. Partial Data adds up across tasks."><GemIcon />{wholeText(dataOf(t))}</span>}</dd>
      {needs.length > 0 && <><dt>Needs</dt><dd data-testid="td-needs">{needs.map(l => <span key={l}>{l}</span>)}</dd></>}
      {head && f.running && !t.committed && <><dt>Pickup</dt><dd><HeadClock blocked={t.blockedBy !== null} risk={false} /></dd></>}
      {head && f.running && t.committed && <><dt>Taken</dt><dd><InQueue task={t} /></dd></>}
    </dl>
    {(t.blockedBy || t.dismissible) && <div className="keys">
      {/* One line per missing component or research; each buys every level it needs in one tap. */}
      {primaryMeet && <MeetKey quote={primaryMeet} n={L.N} onAction={a => shell.dispatch(a)}
        onResearch={id => shell.view.dispatch({ type: 'openResearch', project: id })} />}
      {fixes.map(o => <button key={o.key} type="button" className="key" data-qa-target data-testid="td-fix" disabled={!offerAction(o)} onClick={() => tap(o)}>
        {fixLabel(o)}{o.right.kind !== 'research' && o.price !== null && <span className="pz"> <CoinIcon />{wholeText(o.price)}</span>}</button>)}
      {point && !meet.length && <button type="button" className="key" data-qa-target data-testid="td-point" onClick={() => pointAt(shell, point.kind)}>Open {point.name}</button>}
      {t.blockedBy && !fixes.length && !meet.length && !point && <p className="key-slot">No fix yet</p>}
      {/* Every way to fix it is its own key here (R16: two taps from play), not behind Details. */}
      {meet.filter(q => q !== primaryMeet).map((q, i) => <MeetKey key={i} quote={q} n={L.N} onAction={a => shell.dispatch(a)}
        onResearch={id => shell.view.dispatch({ type: 'openResearch', project: id })} />)}
      {t.dismissible && <button type="button" className="key quiet" data-qa-target data-testid="td-dismiss"
        onClick={() => { shell.dispatch({ type: 'dismissTask', task: t.task }); close(); }}>Dismiss</button>}
    </div>}
    <TaskWork key={key} task={t} />
  </PlateFrame>;
}

/** Right under the tapped card, on phone and desktop alike (it never covers the strip: bounds are the world). */
function anchorOf(card: Rect, key: string) {
  return (out: Rect) => {
    const el = document.querySelector<HTMLElement>(`.tag[data-task="${key}"]`), stage = el?.closest('.stage');
    if (el && stage) {
      const r = el.getBoundingClientRect(), origin = stage.getBoundingClientRect();
      const viewport = el.closest('.slots')?.getBoundingClientRect() ?? r;
      const left = Math.max(r.left, viewport.left), right = Math.min(r.right, viewport.right);
      if (right > left) { out.x = left - origin.left; out.y = r.top - origin.top; out.w = right - left; out.h = r.height; return true; }
    }
    out.x = card.x; out.y = card.y; out.w = card.w; out.h = card.h; return true;
  };
}
