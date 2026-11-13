// What a research project is right now, in one truthful state, the tag its row shows and the one key
// its open row shows. D27: Start pays the price and puts the project at the front of the market line;
// one project is in line or running at a time; Pause keeps its progress, and Resume is free.
import type { GameAction, ResearchId, ResearchNodeView, ResearchTreeView } from '../../game';
import { CURRENCY_NAME, priceOf, shortfalls, type Shortfall, type Wallet } from './money';
import { wholeText } from '../plates/format';

/** The project in the line: waiting at the front, running on a system, or stopped for Credits. */
export interface LineState {
  readonly id: ResearchId | null;
  readonly name: string;
  readonly running: boolean;
  /** Stopped because Credits ran out. */
  readonly stopped?: boolean;
  readonly progress: number;
  /** Research ops/s while it runs. */
  readonly opsPerSec?: number;
  /** No round is running. A project carried over waits for Return to market unless the player runs it now (spec §11.3). */
  readonly between?: boolean;
  /** Between rounds: Run now was pressed (the break request). Not running then means no server can take it. */
  readonly requested?: boolean;
}
export const NO_LINE: LineState = { id: null, name: '', running: false, stopped: false, progress: 0, opsPerSec: 0 };

export type NodeStatus =
  | { readonly kind: 'milestone'; readonly count: number }
  | { readonly kind: 'done' }
  /**
   * `waiting`: between rounds, held for Return to market; free until then. `idle`: between rounds,
   * asked to run now, but no paused, linked server can take it.
   */
  | { readonly kind: 'running' | 'next' | 'waiting' | 'idle' | 'stopped' | 'paused'; readonly progress: number }
  | { readonly kind: 'queued' }
  | { readonly kind: 'ready' }
  /** Affordable and its prerequisites met, but another project holds the line (D27: one at a time). */
  | { readonly kind: 'after'; readonly line: string }
  /** Startable once the wallet pays. */
  | { readonly kind: 'short'; readonly short: readonly Shortfall[] }
  | { readonly kind: 'locked' };

export interface StatusContext {
  readonly byId: ReadonlyMap<ResearchId, ResearchNodeView>;
  readonly line: LineState;
  readonly wallet: Wallet;
}
export interface KeyContext extends StatusContext {
  readonly tree: Pick<ResearchTreeView, 'queue' | 'queueSlots'>;
}

export function nodeStatus(n: ResearchNodeView, c: StatusContext): NodeStatus {
  if (n.rewardMilestone && n.state !== 'done') return { kind: 'milestone', count: n.rewardMilestone };
  switch (n.state) {
    case 'done': return { kind: 'done' };
    case 'active': return { kind: c.line.stopped ? 'stopped' : c.line.running ? 'running' : c.line.between ? c.line.requested ? 'idle' : 'waiting' : 'next', progress: n.progress };
    case 'parked': return { kind: 'paused', progress: n.progress };
    case 'queued': return { kind: 'queued' };
    case 'locked': return { kind: 'locked' };
    case 'available': {
      const short = shortfalls(priceOf(n), c.wallet);
      if (short.length) return { kind: 'short', short };
      return !n.purchase && c.line.id && c.line.id !== n.id ? { kind: 'after', line: c.line.name } : { kind: 'ready' };
    }
  }
}

const queueRoom = (c: KeyContext) => c.tree.queueSlots > 0 && c.tree.queue.length + 1 < c.tree.queueSlots;
/** The project can be started, bought or queued with one press now: the tab counts and the Ready tag. */
export const startable = (s: NodeStatus, c: KeyContext): boolean => s.kind === 'ready' || s.kind === 'after' && queueRoom(c);

/** List order (ready-first): in the line, paused, queued, startable, short of funds, locked. */
export function rank(s: NodeStatus, c: KeyContext): number {
  switch (s.kind) {
    case 'running': case 'next': case 'waiting': case 'idle': case 'stopped': return 0;
    case 'paused': return 1;
    case 'queued': return 2;
    case 'ready': return 3;
    case 'after': return queueRoom(c) ? 3 : 4;
    case 'short': return 4;
    case 'milestone': case 'locked': return 5;
    case 'done': return 6;
  }
}

export const pct = (p: number) => `${Math.floor(p * 100)}%`;
export type Tone = 'go' | 'run' | 'warn' | 'mute';
/** The closed row's state word; null when the price alone tells the state (short of funds: its figure is red). */
export function rowTag(s: NodeStatus, c: KeyContext): { readonly text: string; readonly tone: Tone } | null {
  switch (s.kind) {
    case 'running': return { text: `Running ${pct(s.progress)}`, tone: 'run' };
    case 'next': return { text: 'In line', tone: 'run' };
    case 'waiting': return { text: 'After Return', tone: 'mute' };
    case 'idle': return { text: 'No server ready', tone: 'warn' };
    case 'stopped': return { text: 'No Credits', tone: 'warn' };
    case 'paused': return { text: `Paused ${pct(s.progress)}`, tone: 'mute' };
    case 'queued': return { text: 'Queued', tone: 'run' };
    case 'ready': return { text: 'Ready', tone: 'go' };
    // Affordable, but the line is taken and no queue slot is free: the open row names the project it waits for.
    case 'after': return queueRoom(c) ? { text: 'Ready', tone: 'go' } : { text: 'Line busy', tone: 'mute' };
    case 'short': return null;
    case 'milestone': case 'locked': return { text: 'Locked', tone: 'mute' };
    case 'done': return { text: 'Done', tone: 'mute' };
  }
}

export interface KeyModel {
  readonly label: string;
  /** `go`: starts or resumes work. `quiet`: pauses or unqueues. `off`: the label is the blocker. */
  readonly tone: 'go' | 'quiet' | 'off';
  readonly action: GameAction | null;
}
const off = (label: string): KeyModel => ({ label, tone: 'off', action: null });

const PAUSE: KeyModel = { label: 'Pause', tone: 'quiet', action: { type: 'cancelResearch' } };
/**
 * Between rounds the line's project has two slots: Pause on the left, and Run now on the right while it waits.
 * Running, the right slot stays empty, so Pause never lands under the finger that pressed Run now.
 */
export const pauseBeside = (s: NodeStatus, c: StatusContext): KeyModel | null =>
  s.kind === 'waiting' || s.kind === 'running' && !!c.line.between ? PAUSE : null;

/** The open row's one key, or null when nothing can be pressed (locked rows link their prerequisites instead). */
export function keyFor(n: ResearchNodeView, s: NodeStatus, c: KeyContext): KeyModel | null {
  const other = c.line.id && c.line.id !== n.id ? c.line.name : null;
  switch (s.kind) {
    case 'milestone': case 'locked': case 'done': return null;
    case 'running': case 'next': case 'idle': case 'stopped': return PAUSE;
    case 'waiting': return { label: 'Run now', tone: 'go', action: { type: 'resumeResearch' } };
    case 'paused': return other ? off(`Wait for ${other}`) : { label: 'Resume', tone: 'go', action: { type: 'startResearch', project: n.id } };
    case 'queued': return { label: 'Remove from queue', tone: 'quiet', action: { type: 'unqueueResearch', project: n.id } };
    case 'short': return off(`Need ${s.short.map(x => `${wholeText(x.need)} ${CURRENCY_NAME[x.currency]}`).join(' · ')}`);
    case 'after': return queueRoom(c) ? { label: 'Queue', tone: 'go', action: { type: 'queueResearch', project: n.id } } : off(`Wait for ${s.line}`);
    case 'ready': return { label: n.purchase ? 'Buy' : 'Start', tone: 'go', action: { type: 'startResearch', project: n.id } };
  }
}
