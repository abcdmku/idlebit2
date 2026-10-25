// The research screen model (concept C2, "hanging tree"): pure grouping of the research tree into
// tabs by hardware level, parts in board order under each tab, and what each row and key say.
// D27: a started project goes next in the market line; one project at a time.
import type { Amount, GameAction, LevelId, ResearchId, ResearchNodeView, ResearchPartId, ResearchTabId, ResearchTreeView } from '../../game';
import type { PartIconKind } from '../art/deckArt';
import { lacksAmount } from '../plates/gpuModel';

export const TABS: readonly ResearchTabId[] = ['cpu', 'system', 'rack', 'room', 'global'];
export const TAB_LEVEL: Readonly<Record<ResearchTabId, LevelId>> = { cpu: 'chip', system: 'system', rack: 'rack', room: 'room', global: 'global' };
export const LEVEL_TAB: Readonly<Record<LevelId, ResearchTabId>> = { chip: 'cpu', system: 'system', rack: 'rack', room: 'room', global: 'global' };
export const TAB_NAMES: Readonly<Record<ResearchTabId, string>> = { cpu: 'CPU', system: 'System', rack: 'Rack', room: 'Room', global: 'World' };
export const TAB_ICON: Readonly<Record<ResearchTabId, PartIconKind>> = { cpu: 'cpu', system: 'ram', rack: 'rack', room: 'cool', global: 'site' };

type Part = Exclude<ResearchPartId, 'structure'>;
/** Each tab's parts in board order. Structure nodes hang in the tab's "Next level" section. */
export const TAB_PARTS: Readonly<Record<ResearchTabId, readonly Part[]>> = {
  cpu: ['cores', 'clock', 'cache', 'queue', 'fab'],
  system: ['cpu', 'ram', 'drive', 'gpu', 'psu', 'board'],
  rack: ['switch', 'lb', 'rackCooling', 'rackPower'],
  room: ['netRack', 'roomCooling', 'ups'],
  global: ['dataPlane', 'backbone', 'site', 'globalScheduler'],
};
export const PART_NAMES: Readonly<Record<ResearchPartId, string>> = {
  cores: 'Cores', clock: 'Clock', cache: 'Cache', queue: 'Scheduler', fab: 'Fab',
  cpu: 'CPU', ram: 'RAM', drive: 'Storage', gpu: 'GPU', psu: 'PSU', board: 'Board',
  switch: 'Switch', lb: 'Load balancer', rackCooling: 'Rack cooling', rackPower: 'Rack power',
  netRack: 'Room network', roomCooling: 'Room cooling', ups: 'UPS',
  dataPlane: 'Data plane', backbone: 'Backbone', site: 'Site power', globalScheduler: 'Global scheduler',
  structure: 'Next level',
};
export const PART_ICON: Readonly<Record<ResearchPartId, PartIconKind>> = {
  cores: 'core', clock: 'clock', cache: 'cache', queue: 'queue', fab: 'cpu',
  cpu: 'cpu', ram: 'ram', drive: 'stor', gpu: 'gpu', psu: 'power', board: 'pipe',
  switch: 'switch', lb: 'lb', rackCooling: 'cool', rackPower: 'power',
  netRack: 'switch', roomCooling: 'cool', ups: 'power',
  dataPlane: 'lb', backbone: 'switch', site: 'site', globalScheduler: 'queue',
  structure: 'rack',
};

export interface Wallet { readonly credits?: Amount; readonly data?: Amount }
const OPEN = new Set<ResearchNodeView['state']>(['active', 'parked', 'queued', 'available']);
const ORDER: Readonly<Record<ResearchNodeView['state'], number>> = { active: 0, parked: 1, queued: 2, available: 3, locked: 4, done: 5 };

/** Startable now: available, paid for, and not waiting on Data or Credits. */
export const isReady = (n: ResearchNodeView, w: Wallet) =>
  n.state === 'available' && !n.needsData && !n.needsCredits && !lacksAmount(w.data, n.dataCost) && !lacksAmount(w.credits, n.creditCost);

export interface PartGroup {
  readonly part: ResearchPartId;
  readonly done: readonly ResearchNodeView[];
  /** Active, parked, queued and available rows the hardware can use (the contextual tree). */
  readonly open: readonly ResearchNodeView[];
  /** The one next project, shown only when everything it waits on is done or on screen. */
  readonly lock: ResearchNodeView | null;
  readonly later: number;
  readonly ready: number;
}
export interface TabModel { readonly parts: readonly PartGroup[]; readonly next: PartGroup | null }

/**
 * One tab: only its own level's parts (a CPU part's research stays on the CPU tab in every era).
 * `visible` is the contextual tree's ids (what the installed hardware can use).
 */
export function tabModel(tree: ResearchTreeView, visible: ReadonlySet<ResearchId>, tab: ResearchTabId, w: Wallet): TabModel {
  const shown = new Set(tree.nodes.filter(n => OPEN.has(n.state) && visible.has(n.id)).map(n => n.id));
  const settled = (id: ResearchId) => shown.has(id) || tree.nodes.some(n => n.id === id && n.state === 'done');
  const group = (part: ResearchPartId, nodes: readonly ResearchNodeView[], opener?: ResearchNodeView): PartGroup | null => {
    const done = nodes.filter(n => n.state === 'done');
    const open = nodes.filter(n => OPEN.has(n.state) && (shown.has(n.id) || n === opener))
      .sort((a, b) => ORDER[a.state] - ORDER[b.state] || Number(a.dataCost) - Number(b.dataCost) || a.workOps - b.workOps);
    const lock = opener?.state === 'locked' ? opener : nodes.filter(n => n.state === 'locked' && n.requires.every(settled))
      .sort((a, b) => Number(a.dataCost) - Number(b.dataCost) || a.workOps - b.workOps)[0] ?? null;
    if (!done.length && !open.length && !lock) return null;
    return { part, done, open, lock, later: nodes.length - done.length - open.length - (lock ? 1 : 0), ready: open.filter(n => isReady(n, w)).length };
  };
  const parts = TAB_PARTS[tab].map(p => group(p, tree.nodes.filter(n => n.part === p))).filter((g): g is PartGroup => g !== null);
  // Next level: this tab's structure, then the first project that opens the level after it.
  const after = TABS[TABS.indexOf(tab) + 1];
  const opener = after ? tree.nodes.find(n => n.part === 'structure' && n.tab === after && n.state !== 'done') : undefined;
  const structure = tree.nodes.filter(n => n.part === 'structure' && n.tab === tab);
  if (opener) structure.push(opener);
  return { parts, next: group('structure', structure, opener) };
}

/** Startable projects on each tab: the tab badges. */
export function tabBadges(tree: ResearchTreeView, visible: ReadonlySet<ResearchId>, w: Wallet): Readonly<Record<ResearchTabId, number>> {
  const out: Record<ResearchTabId, number> = { cpu: 0, system: 0, rack: 0, room: 0, global: 0 };
  for (const n of tree.nodes) if (visible.has(n.id) && isReady(n, w)) out[n.tab]++;
  return out;
}

/** The owned tabs, then the next level as one locked teaser. */
export function tabList(unlocked: Readonly<Record<LevelId, boolean>>): { owned: ResearchTabId[]; teaser: ResearchTabId | null } {
  const owned = TABS.filter(t => unlocked[TAB_LEVEL[t]]);
  if (!owned.length) owned.push('cpu');
  return { owned, teaser: TABS[TABS.indexOf(owned[owned.length - 1]!) + 1] ?? null };
}

/** The project in the line (D27): waiting at the front, or running on a system. */
export interface LineState { readonly id: ResearchId | null; readonly name: string; readonly running: boolean; readonly progress: number }

const pct = (p: number) => `${Math.floor(p * 100)}%`;

/** What a row says at its right. */
export function rowStatus(n: ResearchNodeView, line: LineState, names: ReadonlyMap<ResearchId, string>, w: Wallet): string {
  switch (n.state) {
    case 'done': return 'Done';
    case 'active': return line.running ? `Running ${pct(n.progress)}` : 'Next in line';
    case 'parked': return `Paused ${pct(n.progress)}`;
    case 'queued': return 'Queued';
    case 'locked': return n.lockedBy ? `After ${names.get(n.lockedBy) ?? n.lockedBy}` : 'Locked';
    case 'available':
      if (n.needsData || lacksAmount(w.data, n.dataCost)) return 'Needs Data';
      if (n.needsCredits || lacksAmount(w.credits, n.creditCost)) return 'Needs Credits';
      return line.id ? `After ${line.name}` : 'Ready';
  }
}

/** The key a project shows: what tapping it does. */
export function projectKey(n: ResearchNodeView, tree: Pick<ResearchTreeView, 'active' | 'queue' | 'queueSlots'>, credits?: Amount, data?: Amount):
  { label: string; action: GameAction | null } {
  switch (n.state) {
    case 'done': return { label: 'Done', action: null };
    case 'active': return { label: 'Cancel', action: { type: 'cancelResearch' } };
    case 'parked': return { label: 'Resume', action: { type: 'resumeResearch' } };
    case 'queued': return { label: 'Unqueue', action: { type: 'unqueueResearch', project: n.id } };
    case 'locked': return { label: 'Locked', action: null };
    case 'available':
      if (n.needsData || lacksAmount(data, n.dataCost)) return { label: 'Needs Data', action: null };
      if (n.needsCredits || lacksAmount(credits, n.creditCost)) return { label: 'Needs Credits', action: null };
      if (!tree.active) return { label: 'Start', action: { type: 'startResearch', project: n.id } };
      if (tree.queue.length < tree.queueSlots) return { label: 'Queue', action: { type: 'queueResearch', project: n.id } };
      return { label: tree.queueSlots ? 'Queue full' : 'One at a time', action: null };
  }
}

/** The detail key and the line under it. */
export function detailKey(n: ResearchNodeView, tree: ResearchTreeView, line: LineState, names: ReadonlyMap<ResearchId, string>, w: Wallet,
  hold: string | null): { label: string; note: string; action: GameAction | null; tone: 'go' | 'alt' | 'off' } {
  const k = projectKey(n, tree, w.credits, w.data);
  if (n.state === 'active') return { label: 'Cancel', action: k.action, tone: 'alt', note: line.running ? `Running ${pct(n.progress)}` : 'Next in line' };
  if (k.label === 'Start') return { label: 'Start', action: k.action, tone: 'go', note: hold ? `Goes next in line · ${hold} on your hardware` : 'Goes next in line' };
  if (k.action) return { label: k.label, action: k.action, tone: k.label === 'Unqueue' ? 'alt' : 'go', note: '' };
  if (k.label === 'One at a time' || k.label === 'Queue full') return { label: `After ${line.name}`, action: null, tone: 'off', note: 'One project in line at a time' };
  return { label: rowStatus(n, line, names, w), action: null, tone: 'off', note: '' };
}

/** The row selected when a tab opens: the opened project, else the first startable, open or locked row. */
export function firstRow(m: TabModel, focus: ResearchId | null): ResearchId | null {
  const groups = m.next ? [...m.parts, m.next] : m.parts;
  const all = groups.flatMap(g => [...g.open, ...(g.lock ? [g.lock] : []), ...g.done]);
  if (focus && all.some(n => n.id === focus)) return focus;
  return (groups.flatMap(g => g.open)[0] ?? groups.find(g => g.lock)?.lock ?? null)?.id ?? null;
}
