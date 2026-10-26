// Phone back and the browser's Back (user, 26 Oct): close the topmost menu, one per press; with nothing
// open, ask before leaving the game. One guard history entry (same URL, so query flags like ?fresh keep
// working) stands in front of the page: every back pops it, and we push it again unless the player leaves.
import { useEffect, useRef, useState } from 'react';
import { useDialogFocus } from '../hooks/useDialogFocus';
import type { ShellContextValue } from '../storeHooks';

export const GUARD = { idlebit2: 'guard' } as const;
const isGuard = (state: unknown) => (state as { idlebit2?: string } | null)?.idlebit2 === 'guard';

/** Close the topmost menu: view menus innermost first, then the round report. False when nothing was open. */
export function closeTopmost(shell: Pick<ShellContextValue, 'view' | 'store' | 'dispatch'>): boolean {
  const before = shell.view.getState();
  shell.view.dispatch({ type: 'back' });
  if (shell.view.getState() !== before) return true;
  const round = shell.store.getSnapshot().round;
  if (round.state === 'ended' && round.lastReport) { shell.dispatch({ type: 'dismissReport' }); return true; }
  return false;
}

export interface BackGuard {
  /** The leave dialog is up. */
  readonly leaving: boolean;
  stay(): void;
  leave(): void;
}

/** Installs the guard entry and the popstate handler; Escape (via the hotkeys) uses `closeTopmost` directly. */
export function useBackGuard(shell: ShellContextValue, saveNow?: () => void, win: Window = window): BackGuard {
  const [leaving, setLeaving] = useState(false);
  const leavingRef = useRef(false);
  leavingRef.current = leaving;
  const go = useRef<(steps: number) => void>(() => undefined);
  go.current = (steps: number) => { saveNow?.(); leavingRef.current = false; setLeaving(false); win.history.go(-steps); };
  useEffect(() => {
    const h = win.history;
    const guard = () => h.pushState(GUARD, '', win.location.href);
    if (!isGuard(h.state)) guard();
    const onPop = () => {
      // A second back while the dialog asks counts as Leave: the guard is already gone, step past the page.
      if (leavingRef.current) { go.current(1); return; }
      if (!closeTopmost(shell)) { leavingRef.current = true; setLeaving(true); }
      guard();
    };
    win.addEventListener('popstate', onPop);
    return () => win.removeEventListener('popstate', onPop);
  }, [shell, win]);
  return {
    leaving,
    stay: () => { leavingRef.current = false; setLeaving(false); },
    // From the dialog the guard is back in place: past it and the page.
    leave: () => go.current(2),
  };
}

/** The in-game leave dialog: Stay is the default and holds focus; Leave saves, then goes back for real. */
export function LeaveDialog({ guard }: { guard: BackGuard }) {
  if (!guard.leaving) return null;
  return <OpenLeave guard={guard} />;
}

function OpenLeave({ guard }: { guard: BackGuard }) {
  const ref = useRef<HTMLElement>(null), stay = useRef<HTMLButtonElement>(null);
  useDialogFocus(ref, guard.stay, stay);
  return <div className="leave-veil" onPointerDown={e => e.stopPropagation()}>
    <section ref={ref} className="v3-plate leave-dialog" role="alertdialog" aria-modal="true" aria-labelledby="leave-title" aria-describedby="leave-note" tabIndex={-1}
      data-testid="leave-dialog">
      <header className="p-head"><b className="p-title" id="leave-title">Leave idlebit2?</b></header>
      <p className="p-line muted" id="leave-note">Your progress is saved.</p>
      <div className="keys leave-keys">
        <button ref={stay} type="button" className="key go" data-qa-target onClick={guard.stay}>Stay</button>
        <button type="button" className="key quiet" data-qa-target onClick={guard.leave}>Leave</button>
      </div>
    </section>
  </div>;
}

