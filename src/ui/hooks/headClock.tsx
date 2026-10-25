// The head's real 10 s (D10.3): only the head's clock runs. Read per frame from the presentation
// time the world draws with, so the rim and the seconds agree with the pipe.
import { useEffect, useRef, useState } from 'react';
import { HEAD_TICKS, TICK_MS } from '../../game';
import { deadlineMs } from './feedModel';
import { useGameSelector, useShell } from '../storeHooks';

export const HEAD_MS = HEAD_TICKS * TICK_MS;

/** Fraction of the head's window left, 0..1; null when no clock runs (between rounds). */
export function headFraction(deadlineTick: number | null, timeMs: number): number | null {
  return deadlineTick === null ? null : Math.max(0, Math.min(1, (deadlineMs(deadlineTick) - timeMs) / HEAD_MS));
}

export type ClockTone = 'cyan' | 'warn' | 'bad';
export const clockTone = (seconds: number): ClockTone => (seconds > 5 ? 'cyan' : seconds > 2 ? 'warn' : 'bad');

/** Whole seconds left on the head (ceil), re-rendering only when the number changes. */
export function useHeadSeconds(): number | null {
  const { surface } = useShell();
  const deadline = useGameSelector(s => s.feed.headDeadlineTick);
  const [seconds, setSeconds] = useState<number | null>(() => deadline === null ? null : Math.ceil(HEAD_MS / 1000));
  useEffect(() => {
    if (deadline === null) { setSeconds(null); return; }
    const listener = (timeMs: number) => {
      const f = headFraction(deadline, timeMs)!;
      setSeconds(Math.ceil(f * HEAD_MS / 1000 - 1e-6));
    };
    surface.frameListeners.add(listener);
    return () => { surface.frameListeners.delete(listener); };
  }, [surface, deadline]);
  return seconds;
}

/**
 * The head's 10 s along the top inside edge of its panel (L2 rimBar): `w` CSS px wide, filled in
 * whole art px, coloured by what is left. Width is written per frame, never through React.
 */
export function RimClock({ w, n, blocked }: { w: number; n: number; blocked: boolean }) {
  const { surface } = useShell();
  const deadline = useGameSelector(s => s.feed.headDeadlineTick);
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const inner = w / n - 2;
    const paint = (f: number) => {
      const width = `${Math.round(inner * f) * n}px`, tone = blocked ? 'warn' : f > 0.5 ? 'cyan' : f > 0.25 ? 'warn' : 'bad';
      if (el.style.width !== width) el.style.width = width;
      if (el.dataset.tone !== tone) el.dataset.tone = tone;
    };
    paint(deadline === null ? 0 : 1);
    if (deadline === null) return;
    const listener = (timeMs: number) => paint(headFraction(deadline, timeMs)!);
    surface.frameListeners.add(listener);
    return () => { surface.frameListeners.delete(listener); };
  }, [surface, deadline, w, n, blocked]);
  return <i className="rim-track" data-free="art" style={{ left: n, top: n, width: w - 2 * n, height: 2 * n }} aria-hidden="true">
    <b ref={ref} className="rim-fill" style={{ height: 2 * n }} /></i>;
}

/** "2 min", "45 s": a completion window (D26.5), floored to whole minutes from 90 s so it never overstates. */
export function windowText(ticks: number): string {
  const s = ticks * TICK_MS / 1000;
  return s < 90 ? `${Math.max(1, Math.round(s))} s` : `${Math.floor(s / 60)} min`;
}

/**
 * Seconds left in a taken task's completion window (D26.5), from `windowEndTick` (the last tick it may
 * be met in) at the presentation time the world draws with. Re-renders only when the number changes.
 */
export function useWindowLeft(endTick: number | null): number | null {
  const { surface } = useShell();
  const [left, setLeft] = useState<number | null>(null);
  useEffect(() => {
    if (endTick === null) { setLeft(null); return; }
    const listener = (timeMs: number) => setLeft(Math.max(0, Math.ceil(((endTick + 1) * TICK_MS - timeMs) / 1000)));
    surface.frameListeners.add(listener);
    return () => { surface.frameListeners.delete(listener); };
  }, [surface, endTick]);
  return left;
}
