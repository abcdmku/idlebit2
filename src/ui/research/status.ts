// What a research project is right now, in one truthful state, and the one key it shows.
// D27: Start pays the price and puts the project at the front of the market line; one project is in
// line or running at a time; Pause keeps its progress, and Resume is free.
import type { GameAction, ResearchId, ResearchNodeView, ResearchTreeView } from '../../game';
import { etaSpan } from '../hooks/format';
import { holdSeconds } from './estimate';
import { CURRENCY_NAME, priceOf, shortfalls, type Income, type Shortfall, type Wallet } from './money';
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
}
export const NO_LINE: LineState = { id: null, name: '', running: false, stopped: false, progress: 0, opsPerSec: 0 };

export type NodeStatus =
  | { readonly kind: 'done' }
  | { readonly kind: 'running' | 'next' | 'stopped' | 'paused'; readonly progress: number }
  | { readonly kind: 'queued' }
  | { readonly kind: 'ready' }
  /** Paid for and its prerequisites met, but another project holds the line (D27: one at a time). */
  | { readonly kind: 'after'; readonly line: string }
  /** Startable once the wallet pays: the slowest shortfall first, then the other one. */
  | { readonly kind: 'short'; readonly short: readonly Shortfall[] }
  /** `needs`: the first unmet prerequisite; `first`: the project to research first (its prerequisites met). */
  | { readonly kind: 'locked'; readonly needs: ResearchId; readonly first: ResearchId };

export interface StatusContext {
  readonly byId: ReadonlyMap<ResearchId, ResearchNodeView>;
  readonly line: LineState;
  readonly wallet: Wallet;
  readonly income: Income;
}

const unmet = (n: ResearchNodeView, byId: StatusContext['byId']) => n.requires.filter(id => byId.get(id)?.state !== 'done');

/** The project to research first for a locked one: the first unmet prerequisite whose own prerequisites are met. */
export function firstStep(n: ResearchNodeView, byId: StatusContext['byId'], seen = new Set<ResearchId>()): ResearchId | null {
  for (const id of unmet(n, byId)) {
    const r = byId.get(id);
    if (!r || seen.has(id)) continue;
    seen.add(id);
    if (r.state !== 'locked') return id;
    const deeper = firstStep(r, byId, seen);
    if (deeper) return deeper;
  }
  return null;
}

export function nodeStatus(n: ResearchNodeView, c: StatusContext): NodeStatus {
  switch (n.state) {
    case 'done': return { kind: 'done' };
    case 'active': return { kind: c.line.stopped ? 'stopped' : c.line.running ? 'running' : 'next', progress: n.progress };
    case 'parked': return { kind: 'paused', progress: n.progress };
    case 'queued': return { kind: 'queued' };
    case 'locked': {
      const needs = n.lockedBy ?? unmet(n, c.byId)[0] ?? n.id;
      return { kind: 'locked', needs, first: firstStep(n, c.byId) ?? needs };
    }
    case 'available': {
      const short = shortfalls(priceOf(n), c.wallet, c.income);
      if (short.length) return { kind: 'short', short };
      return c.line.id && c.line.id !== n.id ? { kind: 'after', line: c.line.name } : { kind: 'ready' };
    }
  }
}

const pct = (p: number) => `${Math.floor(p * 100)}%`;
export const amountText = (s: Shortfall) => `${wholeText(s.need)} ${CURRENCY_NAME[s.currency]}`;
const nameOf = (id: ResearchId, byId: StatusContext['byId']) => byId.get(id)?.name ?? id;

/** The row's status word. */
export function statusText(s: NodeStatus, byId: StatusContext['byId']): string {
  switch (s.kind) {
    case 'done': return 'Done';
    case 'running': return `Running ${pct(s.progress)}`;
    case 'next': return 'Next in line';
    case 'stopped': return 'Stopped: no Credits';
    case 'paused': return `Paused ${pct(s.progress)}`;
    case 'queued': return 'Queued';
    case 'ready': return 'Ready';
    case 'after': return `After ${s.line}`;
    case 'short': return `Need ${amountText(s.short[0]!)}`;
    case 'locked': return `Needs ${nameOf(s.needs, byId)}`;
  }
}

/** Seconds left on the running project at its current rate. */
export function secondsLeft(n: ResearchNodeView, line: LineState): number | null {
  return line.id === n.id && line.running ? holdSeconds(n.workOps * (1 - n.progress), line.opsPerSec ?? null) : null;
}

/** Said in place of an ETA while the income rate is zero or negative (the 30 s recent net rate). */
export const NO_INCOME = 'no income right now';

/** The row's second word: the ETA of a shortfall, or the time left while it runs. */
export function statusAside(n: ResearchNodeView, s: NodeStatus, line: LineState): string {
  if (s.kind === 'short') { const eta = s.short[0]!.etaS; return eta === null ? NO_INCOME : `in ${etaSpan(eta)}`; }
  if (s.kind === 'running') { const left = secondsLeft(n, line); return left === null ? '' : `${etaSpan(left)} left`; }
  return '';
}

export type KeyTone = 'go' | 'jump' | 'run' | 'wait' | 'off';
export interface KeyModel {
  readonly label: string;
  readonly tone: KeyTone;
  readonly action: GameAction | null;
  /** A locked project's key jumps to the project to research first. */
  readonly jump: ResearchId | null;
  /** The key fills with the project's progress while it is in line. */
  readonly progress: number | null;
  /** The smaller key beside it: Pause or Remove. */
  readonly aside: { readonly label: string; readonly action: GameAction } | null;
}
const key = (label: string, tone: KeyTone, over: Partial<KeyModel> = {}): KeyModel =>
  ({ label, tone, action: null, jump: null, progress: null, aside: null, ...over });

export interface KeyContext extends StatusContext {
  readonly tree: Pick<ResearchTreeView, 'queue' | 'queueSlots'>;
  /** No round is running: a started project runs at once on the paused servers. */
  readonly between: boolean;
}

/** The detail's key: what tapping it does, said plainly. */
export function keyFor(n: ResearchNodeView, s: NodeStatus, c: KeyContext): KeyModel {
  const pause = { label: 'Pause', action: { type: 'cancelResearch' } as const };
  const other = c.line.id && c.line.id !== n.id ? c.line.name : null;
  switch (s.kind) {
    case 'done': return key('Done', 'off');
    case 'running': {
      const left = secondsLeft(n, c.line);
      return key(`Running ${pct(s.progress)}${left === null ? '' : ` · ${etaSpan(left)} left`}`, 'run', { progress: s.progress, aside: pause });
    }
    case 'next': return key('Next in line', 'wait', { progress: s.progress, aside: pause });
    case 'stopped': return key('Resume', 'go', { action: { type: 'resumeResearch' }, progress: s.progress, aside: pause });
    case 'paused': return other ? key(`Wait for ${other}`, 'off')
      : key('Resume · free', 'go', { action: { type: 'startResearch', project: n.id } });
    case 'queued': return key('Queued', 'wait', { aside: { label: 'Remove', action: { type: 'unqueueResearch', project: n.id } } });
    case 'locked': {
      const first = c.byId.get(s.first);
      return key(first?.state === 'available' ? `Research ${first.name} first` : `Needs ${nameOf(s.first, c.byId)}`, 'jump', { jump: s.first });
    }
    case 'short': {
      const top = s.short[0]!;
      return key(`Need ${wholeText(top.need)} more ${CURRENCY_NAME[top.currency]}${top.etaS === null ? '' : ` · ${etaSpan(top.etaS)}`}`, 'off');
    }
    case 'after':
      return c.tree.queueSlots > 0 && c.tree.queue.length + 1 < c.tree.queueSlots
        ? key(`Queue after ${s.line}`, 'go', { action: { type: 'queueResearch', project: n.id } })
        : key(`Wait for ${s.line}`, 'off');
    case 'ready':
      return key(c.between ? 'Start · runs now' : 'Start · goes next in line', 'go', { action: { type: 'startResearch', project: n.id } });
  }
}
