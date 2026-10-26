// One reserved line at the bottom-left of the free world, clear of the pipe that runs along its top
// (it overlays the world, so nothing moves):
// save notices and offline catch-up first, then the failure ticker (A11, spec §4.2: each failure
// with its cause as it happens) and the round start (A16).
import { useEffect, useRef, useState } from 'react';
import type { FailCause, FailDetail, FamilyId, RenderSnapshot } from '../../game';
import { causeLine, familyName } from '../hooks/feedModel';
import { useGameSelector, usePlatformStatus, useShell } from '../storeHooks';
import { restartKey, restartOf, restartText } from '../queue/restart';
import { useLayout } from './geometry';
import { useNewVersion } from './version';

const FAIL_MS = 3000, ROUND_MS = 2000;

interface Flash { readonly text: string; readonly tone: 'bad' | 'cyan' }
export interface FailureNote { readonly family: FamilyId; readonly cause: FailCause; readonly detail: FailDetail | null }
/** How far the ticker has read: the failure stream and the event ring have separate sequences. */
export interface Seen { readonly failure: number; readonly event: number }
export interface News { readonly failure: FailureNote | null; readonly round: number | null; readonly seen: Seen }

/**
 * What happened since `seen`: the newest failure (from the sim's per-task failure stream, its detail
 * word from the same tick's cohort event) and the newest round start.
 */
export function newsSince(s: RenderSnapshot, seen: Seen): News {
  let failure: FailureNote | null = null, round: number | null = null, f = seen.failure, ev = seen.event;
  for (const x of s.failures) {
    if (x.seq <= seen.failure) continue;
    f = Math.max(f, x.seq);
    const cohort = s.events.find(e => e.kind === 'failed' && e.tick === x.tick && e.family === x.family && e.cause === x.cause);
    failure = { family: x.family, cause: x.cause, detail: cohort?.kind === 'failed' ? cohort.detail : null };
  }
  for (const e of s.events) {
    if (e.seq <= seen.event) continue;
    ev = Math.max(ev, e.seq);
    if (e.kind === 'roundStarted') round = e.round;
  }
  return { failure, round, seen: { failure: f, event: ev } };
}

/** "✕ AND Mask · Can't run · cache". */
export function failureText(f: FailureNote): string {
  return `✕ ${familyName(f.family)} · ${causeLine(f.cause, f.detail)}`;
}

function useFlash(): Flash | null {
  const { store } = useShell();
  const [flash, setFlash] = useState<Flash | null>(null);
  const seen = useRef<Seen | null>(null);
  useEffect(() => {
    const s0 = store.getSnapshot();
    seen.current ??= { failure: Math.max(0, ...s0.failures.map(x => x.seq)), event: s0.lastSeq };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const show = (next: Flash, ms: number) => { setFlash(next); clearTimeout(timer); timer = setTimeout(() => setFlash(null), ms); };
    const stop = store.subscribe(() => {
      const news = newsSince(store.getSnapshot(), seen.current!);
      seen.current = news.seen;
      if (news.failure) show({ text: failureText(news.failure), tone: 'bad' }, FAIL_MS);
      else if (news.round !== null) show({ text: `Round ${news.round} · SLA reset`, tone: 'cyan' }, ROUND_MS);
    });
    return () => { stop(); clearTimeout(timer); };
  }, [store]);
  return flash;
}

/** Platform notices in player words. A save reset is a one-time message, shown for a few seconds. */
export function noticeText(notice: string | null): { text: string; once: boolean } | null {
  if (!notice) return null;
  if (/^Save reset/i.test(notice)) return { text: 'New version: your save was reset.', once: true };
  return { text: notice, once: false };
}
const ONCE_MS = 4000;

/** A one-time notice shows for ONCE_MS from when it first appears, then never again. */
function useNotice(notice: string | null): string | null {
  const n = noticeText(notice), [hidden, setHidden] = useState<string | null>(null);
  useEffect(() => {
    if (!n?.once || hidden === n.text) return;
    const timer = setTimeout(() => setHidden(n.text), ONCE_MS);
    return () => clearTimeout(timer);
  }, [n?.once, n?.text, hidden]);
  return n && !(n.once && hidden === n.text) ? n.text : null;
}

export function PlatformLine({ saveNow }: { saveNow?: () => void } = {}) {
  const p = usePlatformStatus(), L = useLayout(), flash = useFlash(), notice = useNotice(p.notice), newer = useNewVersion();
  // The focused system restarting (a cold change, a boot) is said plainly in the world itself.
  const restart = useGameSelector(restartOf, (a, b) => restartKey(a) === restartKey(b), 250);
  const status = p.catchingUp ? `Catching up${p.progress === null ? '' : ` · ${p.progress}%`}` : notice ?? (restart.on ? restartText(restart) : null);
  const text = status ?? flash?.text ?? null;
  // A newer build is deployed: a quiet, stable banner in the same place, with a 48 px Reload that saves first.
  if (newer) return <div className="platform-line version" role="status" data-testid="new-version"
    style={{ left: L.view.x + L.lat, top: L.view.y + L.view.h - L.lat - 48, maxWidth: L.view.w - 2 * L.lat, height: 48 }}>
    <span>New version available</span>
    <button type="button" className="skey" data-qa-target style={{ position: 'relative', width: 96, height: 48 }}
      onClick={() => { saveNow?.(); window.location.reload(); }}>Reload</button>
  </div>;
  // The notice line sits in the head card's free fourth line, out of the world: payout pops draw on top of
  // everything in the world, and only menus may cover them (user, 26 Oct).
  const d = L.kind === 'desktop', tx = d ? L.lat + 16 * L.N + 8 : 8, y = d ? L.lat + 3 * L.lh : 64;
  return <p className={`platform-line${status ? '' : ` ${flash?.tone ?? ''}`}`} role="status" hidden={!text} data-testid="platform-line"
    style={{ left: L.now.x + tx, top: L.now.y + y, maxWidth: L.now.w - tx - 8, height: L.lh }}>{text}</p>;
}
