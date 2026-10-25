// The research board (concept C, "grows from your hardware"): tabs by hardware level, each holding
// only its own level's parts in board order, and under each part the projects worth seeing now.
// Every prerequisite a shown project still needs is shown too, so a "Needs X" always has an X to go to.
import type { Amount, GameAction, LevelId, ResearchId, ResearchNodeView, ResearchPartId, ResearchTabId, ResearchTreeView } from '../../game';
import type { PartIconKind } from '../art/deckArt';
import { priceOf, shortBy } from './money';

export const TABS: readonly ResearchTabId[] = ['cpu', 'system', 'rack', 'room', 'global'];
export const TAB_LEVEL: Readonly<Record<ResearchTabId, LevelId>> = { cpu: 'chip', system: 'system', rack: 'rack', room: 'room', global: 'global' };
export const LEVEL_TAB: Readonly<Record<LevelId, ResearchTabId>> = { chip: 'cpu', system: 'system', rack: 'rack', room: 'room', global: 'global' };
export const TAB_NAMES: Readonly<Record<ResearchTabId, string>> = { cpu: 'CPU', system: 'System', rack: 'Rack', room: 'Room', global: 'World' };
export const TAB_ICON: Readonly<Record<ResearchTabId, PartIconKind>> = { cpu: 'cpu', system: 'ram', rack: 'rack', room: 'cool', global: 'site' };

type Part = Exclude<ResearchPartId, 'structure'>;
/** Each tab's parts in board order. Structure projects sit in the tab's "Next level" section. */
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

/** One part under a tab: its finished projects (folded) and the rows worth seeing now. */
export interface PartGroup {
  readonly part: ResearchPartId;
  readonly done: readonly ResearchNodeView[];
  /** Startable, short or in line first, then locked; each by price. Never reordered by the wallet. */
  readonly rows: readonly ResearchNodeView[];
  /** Every project of this part, done or not: the header's "3 of 9 done". */
  readonly total: number;
}
export interface TabModel { readonly tab: ResearchTabId; readonly parts: readonly PartGroup[]; readonly next: PartGroup | null }
export interface Board {
  readonly owned: readonly ResearchTabId[];
  /** The next level as a locked tab, or null at the top. */
  readonly teaser: ResearchTabId | null;
  readonly tabs: ReadonlyMap<ResearchTabId, TabModel>;
  /** The tab each shown row is on (structure and later-level rows land on the last owned tab). */
  readonly where: ReadonlyMap<ResearchId, ResearchTabId>;
}

/** The owned tabs, then the next level as one locked teaser. */
export function tabList(unlocked: Readonly<Record<LevelId, boolean>>): { owned: ResearchTabId[]; teaser: ResearchTabId | null } {
  const owned = TABS.filter(t => unlocked[TAB_LEVEL[t]]);
  if (!owned.length) owned.push('cpu');
  return { owned, teaser: TABS[TABS.indexOf(owned[owned.length - 1]!) + 1] ?? null };
}

const OPEN = new Set<ResearchNodeView['state']>(['active', 'parked', 'queued', 'available']);
const cost = (n: ResearchNodeView) => { const p = priceOf(n); return [Number(p.data ?? 0), Number(p.credits ?? 0), n.workOps] as const; };
const byPrice = (a: ResearchNodeView, b: ResearchNodeView) => {
  const x = cost(a), y = cost(b);
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
};

/**
 * The board. Shown: every open project the hardware can use (`visible`, the contextual tree), one
 * next locked project per part whose prerequisites are done or shown, what opens the next level,
 * `focus`, and every unmet prerequisite of anything shown.
 */
export function buildBoard(tree: ResearchTreeView, visible: ReadonlySet<ResearchId>, unlocked: Readonly<Record<LevelId, boolean>>,
  focus: ResearchId | null = null): Board {
  const { owned, teaser } = tabList(unlocked);
  const byId = new Map(tree.nodes.map(n => [n.id, n]));
  const shown = new Set<ResearchId>(tree.nodes.filter(n => OPEN.has(n.state) && visible.has(n.id)).map(n => n.id));
  const settled = (id: ResearchId) => shown.has(id) || byId.get(id)?.state === 'done';
  // One next locked project per part (and per tab's structure), its prerequisites all done or shown.
  const parts = new Map<string, ResearchNodeView[]>();
  for (const n of tree.nodes) {
    const k = n.part === 'structure' ? `structure:${n.tab}` : n.part;
    parts.set(k, [...(parts.get(k) ?? []), n]);
  }
  for (const nodes of parts.values()) {
    const lock = nodes.filter(n => n.state === 'locked' && n.requires.every(settled)).sort(byPrice)[0];
    if (lock) shown.add(lock.id);
  }
  // What opens the level after the last owned one.
  const opener = teaser ? tree.nodes.find(n => n.part === 'structure' && n.tab === teaser && n.state !== 'done') : undefined;
  if (opener) shown.add(opener.id);
  const f = focus ? byId.get(focus) : undefined;
  if (f && f.state !== 'done') shown.add(f.id);
  // Close over unmet prerequisites so every "Needs X" has an X on screen.
  const stack = [...shown];
  while (stack.length) {
    for (const id of byId.get(stack.pop()!)?.requires ?? []) {
      const r = byId.get(id);
      if (r && r.state !== 'done' && !shown.has(id)) { shown.add(id); stack.push(id); }
    }
  }

  const last = owned[owned.length - 1]!;
  const ownedSet = new Set(owned);
  const where = new Map<ResearchId, ResearchTabId>();
  const home = (n: ResearchNodeView): { tab: ResearchTabId; next: boolean } =>
    ownedSet.has(n.tab) ? { tab: n.tab, next: n.part === 'structure' } : { tab: last, next: true };
  const rowsOf = (nodes: readonly ResearchNodeView[]) => {
    const rows = nodes.filter(n => shown.has(n.id) && n.state !== 'done');
    return [...rows.filter(n => n.state !== 'locked').sort(byPrice), ...rows.filter(n => n.state === 'locked').sort(byPrice)];
  };
  const tabs = new Map<ResearchTabId, TabModel>();
  for (const tab of owned) {
    const groups: PartGroup[] = [];
    for (const part of TAB_PARTS[tab]) {
      const nodes = tree.nodes.filter(n => n.part === part && home(n).tab === tab && !home(n).next);
      const done = nodes.filter(n => n.state === 'done'), rows = rowsOf(nodes);
      if (done.length || rows.length) groups.push({ part, done, rows, total: nodes.length });
    }
    const nextNodes = tree.nodes.filter(n => shown.has(n.id) && home(n).tab === tab && home(n).next);
    const nextRows = rowsOf(nextNodes);
    const next = nextRows.length ? { part: 'structure' as const, done: [], rows: nextRows, total: nextRows.length } : null;
    for (const g of next ? [...groups, next] : groups) for (const n of g.rows) where.set(n.id, tab);
    tabs.set(tab, { tab, parts: groups, next });
  }
  return { owned, teaser, tabs, where };
}

/** Rows in screen order on one tab. */
export const tabRows = (m: TabModel): ResearchNodeView[] => [...m.parts, ...(m.next ? [m.next] : [])].flatMap(g => g.rows);

/** The shown projects that list `id` as a prerequisite, and how many more come later. */
export function leadsTo(tree: ResearchTreeView, board: Board, id: ResearchId): { shown: ResearchNodeView[]; later: number } {
  const after = tree.nodes.filter(n => n.state !== 'done' && n.requires.includes(id));
  const shown = after.filter(n => board.where.has(n.id));
  return { shown, later: after.length - shown.length };
}

/**
 * The one-line key other surfaces show for a project (the deck's ready count, the GPU plate). The
 * research screen's own key is status.ts keyFor. A paused project resumes free through startResearch.
 */
export function projectKey(n: ResearchNodeView, tree: Pick<ResearchTreeView, 'active' | 'queue' | 'queueSlots'>, credits?: Amount, data?: Amount):
  { label: string; action: GameAction | null } {
  switch (n.state) {
    case 'done': return { label: 'Done', action: null };
    case 'active': return { label: 'Pause', action: { type: 'cancelResearch' } };
    case 'parked': return tree.active ? { label: 'One at a time', action: null } : { label: 'Resume', action: { type: 'startResearch', project: n.id } };
    case 'queued': return { label: 'Unqueue', action: { type: 'unqueueResearch', project: n.id } };
    case 'locked': return { label: 'Locked', action: null };
    case 'available': {
      const price = priceOf(n);
      if (n.needsData || shortBy(data, price.data) > 0n) return { label: 'Needs Data', action: null };
      if (n.needsCredits || shortBy(credits, price.credits) > 0n) return { label: 'Needs Credits', action: null };
      if (!tree.active) return { label: 'Start', action: { type: 'startResearch', project: n.id } };
      if (tree.queue.length + 1 < tree.queueSlots) return { label: 'Queue', action: { type: 'queueResearch', project: n.id } };
      return { label: tree.queueSlots ? 'Queue full' : 'One at a time', action: null };
    }
  }
}
