// Conveyor motion: each publish, every task tag slides from where it is on screen right now to its
// new slot. A move that lands mid-slide restarts from the current position, so several departures
// in one frame never stack lag. A taken head drops through the strip's bottom edge into the pipe, a
// dismissed one slides out, a failed one fades in the fault colour, and a task pushed out of the
// window slides out the back. Transforms only: no layout work.
import { useLayoutEffect, useMemo, useReducer, useRef, type RefObject } from 'react';
import type { Rect } from '../../render/core';
import { advanceConveyor, type Conveyor, type ConveyorInput, type Leave } from './conveyor';

export const MOVE_MS = 200, EXIT_MS = 220;
const EASE = 'cubic-bezier(0.2, 0.7, 0.3, 1)';

/** The translate an element shows right now, mid-animation included (CSS px). */
function translateNow(el: HTMLElement): [number, number] {
  const m = /matrix(3d)?\(([^)]+)\)/.exec(getComputedStyle(el).transform);
  if (!m) return [0, 0];
  const v = m[2]!.split(',').map(Number);
  return m[1] ? [v[12] ?? 0, v[13] ?? 0] : [v[4] ?? 0, v[5] ?? 0];
}
const at = (x: number, y: number) => `translate(${x}px, ${y}px)`;

function exit(el: HTMLElement, leave: Leave, rect: Rect): void {
  const [x, y] = translateNow(el);
  el.getAnimations().forEach(a => a.cancel());
  const end = leave === 'taken' ? { transform: at(x, y + rect.h), opacity: 1 }
    : leave === 'dismissed' ? { transform: at(x - rect.w / 2, y), opacity: 0 }
    : leave === 'pushed' ? { transform: at(x + rect.w, y), opacity: 1 } : { transform: at(x, y), opacity: 0 };
  el.animate([{ transform: at(x, y), opacity: 1 }, end], { duration: EXIT_MS, easing: EASE, fill: 'forwards' });
}

/**
 * A task promoted to the head: it lives on the head's own clipped belt, so it never crosses the cards
 * or the Dismiss key. It waits while the outgoing head clears, then eases in from the side it came
 * from: the right on desktop, from below on phone.
 */
function enterHead(el: HTMLElement, old: Rect | null, rect: Rect): void {
  const dx = old ? Math.sign(old.x - rect.x) * Math.min(48, Math.abs(old.x - rect.x)) : 0;
  const dy = old ? Math.sign(old.y - rect.y) * Math.min(24, Math.abs(old.y - rect.y)) : 0;
  el.getAnimations().forEach(a => a.cancel());
  el.animate([{ opacity: 0, transform: at(dx, dy) }, { opacity: 0, transform: at(dx, dy), offset: 0.3 }, { opacity: 1, transform: at(0, 0) }],
    { duration: MOVE_MS + 40, easing: EASE });
}

/** Start the motion from `prev` to `next` on the tags (`[data-key]`) under the belt. */
export function animateConveyor(tags: Iterable<HTMLElement>, prev: Conveyor | null, next: Conveyor, slotRect: (slot: number) => Rect): void {
  if (!prev || !next.animate) return;
  const wasLeaving = new Set(prev.items.filter(i => i.leave).map(i => i.key));
  const byKey = new Map(next.items.map(i => [i.key, i]));
  const back = next.items.reduce((m, i) => (i.leave ? m : Math.max(m, i.slot)), 0);
  for (const el of tags) {
    if (typeof el.animate !== 'function') return;
    const item = byKey.get(el.dataset.key ?? '');
    if (!item) continue;
    const rect = slotRect(item.slot);
    if (item.leave) { if (!wasLeaving.has(item.key)) exit(el, item.leave, rect); continue; }
    const from = next.from.get(item.key);
    if (from === item.slot) continue;
    if (item.slot === 0) { enterHead(el, from === undefined ? null : slotRect(from), rect); continue; }
    if (from === undefined) {
      // A new task joins at the back from beyond the strip's edge; anything else fades in where it lands.
      el.animate(item.slot === back && item.slot > 0 ? [{ transform: at(rect.w, 0) }, { transform: at(0, 0) }] : [{ opacity: 0 }, { opacity: 1 }],
        { duration: MOVE_MS, easing: EASE });
      continue;
    }
    const [x, y] = translateNow(el), old = slotRect(from);
    el.getAnimations().forEach(a => a.cancel());
    el.animate([{ transform: at(old.x - rect.x + x, old.y - rect.y + y) }, { transform: at(0, 0) }], { duration: MOVE_MS, easing: EASE });
  }
}

/**
 * The conveyor for the published window, animated on the tags under `belt`. Leaving tasks stay
 * mounted until their exit ends; with reduced motion they drop at once and nothing slides.
 */
export function useConveyor(input: ConveyorInput, belt: RefObject<HTMLElement | null>, slotRect: (slot: number) => Rect, reduced: boolean): Conveyor {
  const committed = useRef<Conveyor | null>(null), expired = useRef(new Set<string>());
  const [version, bump] = useReducer((n: number) => n + 1, 0);
  const { window, taken, dismissed, round, frozen } = input;
  const next = useMemo(() => advanceConveyor(committed.current, { window, taken, dismissed, round, frozen }, expired.current),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `version` re-reads the expired set
    [window, taken, dismissed, round, frozen, version]);
  useLayoutEffect(() => {
    const prev = committed.current;
    if (prev === next) return;
    committed.current = next;
    const live = new Set(next.items.map(i => i.key));
    for (const key of expired.current) if (!live.has(key)) expired.current.delete(key);
    if (!reduced && belt.current) animateConveyor(belt.current.querySelectorAll<HTMLElement>('[data-key]'), prev, next, slotRect);
    const fresh = next.items.filter(i => i.leave && !prev?.items.some(p => p.key === i.key && p.leave));
    // Not cleared by the next commit: an exit that outlives it must still expire.
    if (fresh.length) setTimeout(() => { for (const i of fresh) expired.current.add(i.key); bump(); }, reduced ? 0 : EXIT_MS);
  }, [next, reduced, belt, slotRect]);
  return reduced ? { ...next, items: next.items.filter(i => !i.leave) } : next;
}
