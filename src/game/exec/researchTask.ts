import { G } from '../core/buffers';
import { MODE } from '../core/timers';
import { dirtySystem, touchSystem } from '../core/touch';
import type { World } from '../core/world';
import { TREE_INDEX } from '../build/research/tree';
import { hwThreads } from './est';
import { researchesInMode } from './research';
import { canAdmit, hasLink, noteAdmit, noteAdmitted, noteTake, STORAGE_NODE } from './slots';

/**
 * D27: research is a task that cuts the line. Starting a project puts it at the front of the
 * market queue: while it waits there it is the head, has no clock, and the tasks behind it wait.
 * The next systems with room take it, each on all its free threads (a fine-grain divisible task,
 * D25), and hold one slot and those threads until the project completes. It carries no payload
 * and pays nothing. A holder that stops running (dark, crashed, cold, offline) lets go; when none
 * is left the project is back at the queue front with its progress kept. Between rounds the
 * market is paused but research still runs: every powered, linked server with a free thread takes it.
 *
 * State: hot.sys.researchThreads per holder, G.researchHolders, and G.researchProject (the
 * TREE_INDEX the holders work for). ResearchState.active and activeProgress stay the project.
 */

/** The TREE_INDEX of the project that should be in line or running, or -1. */
function wanted(w: World): number {
  const r = w.research;
  if (r.active === null || r.stoppedInsolvent) return -1;
  return TREE_INDEX.get(r.active) ?? -1;
}

/** The research task waits at the queue front: a project is active and nobody holds it. */
export function researchQueued(w: Pick<World, 'research' | 'hot'>): boolean {
  return w.research.active !== null && !w.research.stoppedInsolvent && w.hot.g[G.researchHolders]! === 0;
}

function hold(w: World, s: number, threads: number): void {
  const h = w.hot.sys;
  const before = canAdmit(w, s);
  h.researchThreads[s] = threads;
  h.busyThreads[s] = h.busyThreads[s]! + threads;
  w.hot.g[G.busyThreads] = w.hot.g[G.busyThreads]! + threads;
  w.hot.g[G.researchHolders] = w.hot.g[G.researchHolders]! + 1;
  noteAdmitted(w, s, 1);
  noteAdmit(w, s, before);
  dirtySystem(w, s);
}

/** A holder takes `more` free threads (between rounds only). */
function grow(w: World, s: number, more: number): void {
  const h = w.hot.sys;
  h.researchThreads[s] = h.researchThreads[s]! + more;
  h.busyThreads[s] = h.busyThreads[s]! + more;
  w.hot.g[G.busyThreads] = w.hot.g[G.busyThreads]! + more;
  touchSystem(w, s);
  dirtySystem(w, s);
}

function release(w: World, s: number): void {
  const h = w.hot.sys, threads = h.researchThreads[s]!;
  if (threads === 0) return;
  const before = canAdmit(w, s);
  h.researchThreads[s] = 0;
  h.busyThreads[s] = Math.max(0, h.busyThreads[s]! - threads);
  w.hot.g[G.busyThreads] = Math.max(0, w.hot.g[G.busyThreads]! - threads);
  w.hot.g[G.researchHolders] = w.hot.g[G.researchHolders]! - 1;
  noteAdmitted(w, s, -1);
  noteAdmit(w, s, before);
  dirtySystem(w, s);
}

/** Every holder lets go (project done, changed, cancelled or stopped). */
export function releaseResearch(w: World): void {
  const h = w.hot.sys;
  if (w.hot.g[G.researchHolders]! > 0) for (let s = 0; s < w.compiled.sys.len; s += 1) if (h.researchThreads[s]! > 0) release(w, s);
  w.hot.g[G.researchProject] = -1;
}

/** Round end freed every thread count (dropAllWork): holders keep holding, so their threads are counted again. */
export function recountResearchThreads(w: World): void {
  const h = w.hot.sys;
  if (w.hot.g[G.researchHolders]! === 0) return;
  let total = 0;
  for (let s = 0; s < w.compiled.sys.len; s += 1) {
    const t = h.researchThreads[s]!;
    if (t === 0) continue;
    h.busyThreads[s] = h.busyThreads[s]! + t;
    total += t;
  }
  w.hot.g[G.busyThreads] = w.hot.g[G.busyThreads]! + total;
}

/** Room to take the research task now: a slot like any task, and at least one free thread. */
function canTake(w: World, s: number): boolean {
  const c = w.compiled.sys, h = w.hot.sys;
  if (h.researchThreads[s]! > 0 || h.busyThreads[s]! >= hwThreads(w, s)) return false;
  if (w.round.phase === 'running') return canAdmit(w, s);
  // Between rounds the market is paused and nothing else runs: a powered, linked server takes it.
  return c.alive[s] === 1 && c.kind[s] !== STORAGE_NODE && h.mode[s] === MODE.paused && hasLink(w, s);
}

/**
 * Tick step 4 (route), before routing: holders that stopped running let go; a project that is no
 * longer wanted is released; a queued project is taken by every system with room, in index order.
 * Returns true when the research task was taken this tick (the next task becomes head with a fresh 10 s).
 */
export function researchTakePhase(w: World): boolean {
  const g = w.hot.g, h = w.hot.sys;
  const want = wanted(w);
  if (g[G.researchHolders]! > 0) {
    if (want !== g[G.researchProject]) releaseResearch(w);
    else for (let s = 0; s < w.compiled.sys.len; s += 1) if (h.researchThreads[s]! > 0 && !researchesInMode(h.mode[s]!)) release(w, s);
  }
  // Between rounds nothing else runs: holders spread over every thread, and idle servers join.
  if (w.round.phase !== 'running' && g[G.researchHolders]! > 0) {
    for (let s = 0; s < w.compiled.sys.len; s += 1) {
      const t = h.researchThreads[s]!;
      if (t > 0) { const free = hwThreads(w, s) - h.busyThreads[s]!; if (free > 0) grow(w, s, free); }
      else if (canTake(w, s)) hold(w, s, hwThreads(w, s) - h.busyThreads[s]!);
    }
  }
  if (want < 0 || g[G.researchHolders]! > 0) return false;
  for (let s = 0; s < w.compiled.sys.len; s += 1) {
    if (!canTake(w, s)) continue;
    hold(w, s, hwThreads(w, s) - h.busyThreads[s]!);
    if (w.round.phase === 'running') noteTake(w, s);
  }
  if (g[G.researchHolders]! === 0) return false;
  g[G.researchProject] = want;
  return true;
}
