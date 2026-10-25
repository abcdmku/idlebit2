// The queue strip as a conveyor: which task sits in which slot, where it was a publish ago, and
// which tasks just left and how. Pure; the strip animates the difference (motion.ts).
import type { QueueEntryView } from '../../game';
import { taskKey } from '../hooks/feedModel';

/**
 * Why a task left the window: taken by hardware (into the pipe), dismissed, or failed at the head;
 * or pushed out of the back when returned work rejoins the front.
 */
export type Leave = 'taken' | 'dismissed' | 'failed' | 'pushed';

/** Slot 0 is the head; 1–4 are the next tasks, front first. */
export interface ConveyorItem { readonly key: string; readonly task: QueueEntryView; readonly slot: number; readonly leave: Leave | null }

export interface ConveyorInput {
  readonly window: readonly QueueEntryView[];
  /** The round's take and dismiss counters: their growth says why tasks left. */
  readonly taken: number;
  readonly dismissed: number;
  /** Epoch, round and timing: a change replaces the window without motion. */
  readonly round: string;
  /** Between rounds the next round's queue is frozen (spec §4.1.5): nothing slides. */
  readonly frozen: boolean;
}

export interface Conveyor {
  /** Leaving tasks first (drawn under), then the window in slot order. */
  readonly items: readonly ConveyorItem[];
  /** The previous slot of each task that was in the previous window. */
  readonly from: ReadonlyMap<string, number>;
  /** False when the window was replaced outright (a new round, a frozen queue, or every task at once). */
  readonly animate: boolean;
  readonly taken: number;
  readonly dismissed: number;
  readonly round: string;
}

const NONE: ReadonlyMap<string, number> = new Map();

/**
 * Advance from the committed conveyor to the newly published window. `expired` holds leaving
 * tasks whose exit has finished. Idempotent: the same inputs give the same conveyor.
 */
export function advanceConveyor(prev: Conveyor | null, input: ConveyorInput, expired: ReadonlySet<string>): Conveyor {
  const current = input.window.map((task, slot): ConveyorItem => ({ key: taskKey(task.task), task, slot, leave: null }));
  const base = { taken: input.taken, dismissed: input.dismissed, round: input.round };
  if (!prev || prev.round !== input.round || input.frozen) return { ...base, items: current, from: NONE, animate: false };
  const keys = new Set(current.map(i => i.key));
  const present = prev.items.filter(i => !i.leave);
  const departed = present.filter(i => !keys.has(i.key));
  // Several tasks gone and none left over: the window turned over faster than motion can show.
  if (departed.length >= 2 && departed.length === present.length) return { ...base, items: current, from: NONE, animate: false };
  const took = Math.max(0, input.taken - prev.taken), skipped = Math.max(0, input.dismissed - prev.dismissed);
  // Tasks leave the front; the counters say how many of each, front first: taken, dismissed, then failed.
  // A task behind every survivor was pushed out of the back.
  const backmost = Math.max(-1, ...present.filter(i => keys.has(i.key)).map(i => i.slot));
  let k = 0;
  const fresh = departed.map((item): ConveyorItem => {
    if (item.slot > backmost) return { ...item, leave: 'pushed' };
    const i = k++;
    return { ...item, leave: i < took ? 'taken' : i < took + skipped ? 'dismissed' : 'failed' };
  });
  const leaving = [...prev.items.filter(i => i.leave), ...fresh].filter(i => !keys.has(i.key) && !expired.has(i.key));
  return { ...base, items: [...leaving, ...current], from: new Map(present.map(i => [i.key, i.slot])), animate: true };
}
