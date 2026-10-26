// Task detail (user, 26 Oct): tapping any of the five strip cards opens what that task is, what it
// pays and needs, and whether it can run. Desktop: a plate under the card; phone: a sheet over the
// bottom of the world. Back and Escape close it (viewState 'back'). No task numbers (D22).
import { FAMILIES, formatHertz, formatOps, type QueueEntryView } from '../../game';
import { typeColor, typeName, typeOf, type Rect } from '../../render/core';
import { CurrencyIcon } from '../Hud';
import { useShellOffers } from '../deck/useOffers';
import { actionable, WALL_ROWS, type Offer, type Offers } from '../deck/offers';
import { offerAction, useTapOffer } from '../deck/offerUi';
import { familyName, taskKey, transferText } from '../hooks/feedModel';
import { wholeText } from '../hooks/format';
import { blockedText, taskBits } from '../hooks/taskRequirements';
import type { ShellLayout } from '../layout';
import { PlateFrame } from '../plates/PlateFrame';
import { useLayout } from '../shell/geometry';
import { shallowEqual, useGameSelector, useShell, useViewState } from '../storeHooks';
import { HeadClock, InQueue, TaskIcon } from './taskText';

/** Keeps every number with its unit on one line ("100 kHz", "1 ms", "2 b", "4 systems"): a no-break space between them. */
export const keepUnits = (s: string): string => s.replace(/([0-9][kMGTPEZY]?) (?=[A-Za-z%µ])/g, '$1\u00a0');

/** What the task needs, one plain line each: memory, GPU, shards, zones. */
export function needLines(t: QueueEntryView): string[] {
  const out: string[] = [];
  if (t.workingSetBits > 0) out.push(`${taskBits(t.workingSetBits)} working memory (cache, then RAM, then disk)`);
  if (t.gpuCoresMin > 0 || t.stages.some(s => s.resource === 'gpu')) out.push(t.gpuCoresMin > 0 ? `A GPU with ${t.gpuCoresMin} cores` : t.tensor ? 'A GPU with tensor cores' : 'A GPU');
  if (t.vramBits > 0) out.push(`${taskBits(t.vramBits)} VRAM`);
  if (t.ecc) out.push('ECC RAM');
  if (t.members > 1) out.push(`${t.members} systems at once (it splits into shards)`);
  if (t.minZones > 1) out.push(`Systems in ${t.minZones} zones`);
  return (out.length ? out : ['Nothing beyond a free CPU']).map(keepUnits);
}

/** "1,000 ops · lands in 1 s on 1 kHz": its work, and its input over the current first link. */
export function workLine(t: QueueEntryView): string {
  const work = `${formatOps(t.work)}`;
  if (t.transferS === null || !(t.transferS > 0)) return keepUnits(work);
  return keepUnits(`${work} · lands in ${transferText(t.transferS)} on ${formatHertz(t.work / t.transferS)}`);
}

/** Data a task pays: its Credits over the family's Data ratio (spec §9.8, D2.2). */
export const dataOf = (t: QueueEntryView): number => {
  const ratio = FAMILIES[t.family]?.dataRatio ?? 0;
  return ratio > 0 ? Math.floor(t.work / ratio) : 0;
};

/** How many online systems could run it at all (its fixed hardware, ignoring load). */
export const capableText = (n: number): string =>
  n === 0 ? 'none of your systems can run it' : `${n} of your systems can run it`;

/** Status in plain words. */
export function statusLine(t: QueueEntryView, head: boolean, running: boolean): { text: string; tone: '' | 'warn' | 'mute' } {
  if (!running) return { text: 'Starts after Return', tone: 'mute' };
  if (t.blockedBy) return { text: keepUnits(`Blocked: ${(blockedText(t) ?? '').replace(/^Needs/, 'needs')}`), tone: 'warn' };
  if (t.committed) return { text: 'Waiting for a free system', tone: '' };
  return { text: head ? 'Ready' : 'Ready when it reaches the front', tone: '' };
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
  if (!v.task) return null;
  return <OpenTask taskKey={v.task} />;
}

function OpenTask({ taskKey: key }: { taskKey: string }) {
  const shell = useShell(), L = useLayout(), offers = useShellOffers(), tap = useTapOffer();
  const f = useGameSelector(s => {
    const research = s.feed.research && !s.feed.research.running;
    const i = s.feed.window.findIndex(t => taskKey(t.task) === key);
    return { t: i >= 0 ? s.feed.window[i]! : null, slot: i < 0 ? -1 : research ? i + 1 : i, running: s.feed.timing === 'running' && s.round.state === 'running' };
  }, shallowEqual, 250);
  // A task that left the line (taken, met or dismissed) closes its detail.
  if (!f.t) { queueMicrotask(() => { if (shell.view.getState().task === key) shell.view.dispatch({ type: 'back' }); }); return null; }
  const t = f.t, head = f.slot === 0, color = typeColor(typeOf(t.family));
  const status = statusLine(t, head, f.running), fix = t.blockedBy ? fixFor(t, offers) : null, act = fix ? offerAction(fix) : null;
  const card = f.slot === 0 ? L.headSlot : L.cards[f.slot - 1] ?? L.headSlot;
  const close = () => shell.view.dispatch({ type: 'back' });
  return <PlateFrame title={familyName(t.family)} sub={<span style={{ color }}>{typeName(typeOf(t.family))}</span>}
    className={`task-detail${L.kind === 'phone' ? ' sheet' : ''}`} bounds={L.view} readAnchor={anchorOf(L, card)} onClose={close}
    head={<span className="td-ic"><TaskIcon task={t} n={L.N} /></span>}>
    <p className="p-line muted td-note">{FAMILIES[t.family]?.note ?? ''}</p>
    <dl className="td-facts">
      <dt>Work</dt><dd data-testid="td-work">{workLine(t)}</dd>
      <dt>Needs</dt><dd data-testid="td-needs">{needLines(t).map(l => <span key={l}>{l}</span>)}</dd>
      <dt>Pays</dt><dd data-testid="td-pays"><span className="gold"><CurrencyIcon kind="credits" n={L.N} />{wholeText(t.work)}</span>
        {dataOf(t) > 0 && <span className="data"><CurrencyIcon kind="data" n={L.N} />{wholeText(dataOf(t))}</span>}</dd>
      {head && f.running && !t.committed && <><dt>Pickup</dt><dd><HeadClock blocked={t.blockedBy !== null} risk={false} /></dd></>}
      {head && f.running && t.committed && <><dt>Taken</dt><dd><InQueue task={t} /></dd></>}
    </dl>
    <p className={`p-line td-status ${status.tone}`} data-testid="td-status">{status.text}
      {t.blockedBy && <span className="mute" data-testid="td-capable"> · {capableText(t.capableSystems)}</span>}</p>
    {(t.blockedBy || (head && f.running && t.dismissible)) && <div className="keys">
      {fix && <button type="button" className="key" data-qa-target data-testid="td-fix" disabled={!act} onClick={() => tap(fix)}>
        {fix.right.kind === 'research' ? <>Research {fix.right.node}</> : <>Buy {fix.name} {fix.change} <span className="pz"><CurrencyIcon kind="credits" n={L.N} />{wholeText(fix.price ?? 0)}</span></>}</button>}
      {t.blockedBy && !fix && <p className="key-slot">No upgrade here fixes it yet</p>}
      {head && f.running && t.dismissible && <button type="button" className="key quiet" data-qa-target data-testid="td-dismiss"
        onClick={() => { shell.dispatch({ type: 'dismissTask', task: t.task }); close(); }}>Dismiss <span className="mute">· No SLA cost</span></button>}
    </div>}
  </PlateFrame>;
}

/** Desktop: under the tapped card. Phone: a sheet resting on the bottom of the world. */
function anchorOf(L: ShellLayout, card: Rect) {
  return (out: Rect) => {
    if (L.kind === 'phone') { out.x = L.view.x; out.w = L.view.w; out.y = L.view.y + L.view.h; out.h = 0; }
    else { out.x = card.x; out.y = card.y; out.w = card.w; out.h = card.h; }
    return true;
  };
}
