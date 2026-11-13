import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { selectContextualResearchTree, selectResearchTree, type GameAction, type LevelId, type NodeRef, type RenderSnapshot, type ResearchId,
  type ResearchTabId, type ResearchTreeView, type ResearchNodeView } from '../../game';
import { useDialogFocus } from '../hooks/useDialogFocus';
import type { ShellLayout } from '../layout';
import { useInnerBack } from '../shell/backGuard';
import { useLayout } from '../shell/geometry';
import { useGameSelector, useShell, useViewState } from '../storeHooks';
import { targetName } from '../callout/model';
import { followTile } from './expand';
import { ResearchTile } from './ResearchTree';
import { buildBoard, LEVEL_TAB, tabRows, TAB_NAMES } from './model';
import type { Wallet } from './money';
import { nodeStatus, NO_LINE, rank, startable, type KeyContext, type LineState } from './status';
import '../styles/research.css';

export interface ResearchViewProps {
  L: ShellLayout; tree: ResearchTreeView; visible: ReadonlySet<ResearchId>;
  unlocked: Readonly<Record<LevelId, boolean>>; level: LevelId; focusProject: ResearchId | null;
  wallet: Wallet; line: LineState; between?: boolean;
  onAction: (action: GameAction) => void; onClose: () => void; returnLabel?: string | null;
}
type Filter = ResearchTabId | 'all';
interface Location { tab: Filter; open: ResearchId | null; top: number }
/**
 * The dialog is as tall as its list, no wider than a readable row, and stops above the bottom bar so
 * the Research key stays in view. A short, wide screen puts it over the hardware, beside the task column.
 */
const MAX_W = 720;
function sheetBox(L: ShellLayout): CSSProperties {
  const beside = L.kind === 'phone' && L.w > L.h;
  const area = beside ? { x: L.view.x, y: L.lab.y, w: L.view.w, h: L.lab.h } : L.lab;
  const bar = Math.min(L.research.y, L.now.y);
  const width = Math.floor(Math.min(area.w, MAX_W) / 8) * 8;
  return { left: area.x + Math.floor((area.w - width) / 16) * 8, top: area.y, width,
    maxHeight: beside || bar - 8 <= area.y ? area.h : Math.min(area.h, bar - 8 - area.y) };
}
/** A repeatable entry keeps its place when the next level replaces it. */
const orderKey = (n: ResearchNodeView) => n.purchase ? `series:${n.purchase.series}` : n.id;

/** One line for a list with no rows: what is finished, or what opens more. */
function emptyLine(tab: Filter, tree: ResearchTreeView): string {
  const left = tree.nodes.filter(n => n.state !== 'done' && (tab === 'all' || n.tab === tab)).length;
  if (tab === 'all') return left ? 'Nothing to research yet. New parts open more.' : 'All research is done.';
  const name = TAB_NAMES[tab];
  return left ? `No ${name} research fits the installed parts. Adding or upgrading ${name} parts opens more.` : `All ${name} research is done.`;
}

export function ResearchView(p: ResearchViewProps) {
  const { L, tree, line, onAction, onClose } = p;
  const ref = useRef<HTMLElement>(null), listRef = useRef<HTMLDivElement>(null);
  const board = useMemo(() => buildBoard(tree, p.visible, p.unlocked, p.focusProject), [tree, p.visible, p.unlocked, p.focusProject]);
  const byId = useMemo(() => new Map(tree.nodes.map(n => [n.id, n])), [tree]);
  const ctx: KeyContext = { byId, line, wallet: p.wallet, tree };
  const initial = p.focusProject && board.where.has(p.focusProject) ? p.focusProject : null;
  const ready = (f: Filter) => (f === 'all' ? board.owned : [f]).flatMap(t => board.tabs.get(t)?.parts.concat(board.tabs.get(t)?.next ?? []) ?? [])
    .flatMap(g => g.rows).filter(n => startable(nodeStatus(n, ctx), ctx)).length;
  // Ready-first: the viewed level's tab, unless nothing there can start and something elsewhere can.
  const [tab, setTab] = useState<Filter>(() => initial ? board.where.get(initial)!
    : board.owned.length > 1 && !ready(LEVEL_TAB[p.level]) && ready('all') ? 'all' : LEVEL_TAB[p.level]);
  const rowsOf = (f: Filter) => (f === 'all' ? board.owned : [f]).flatMap(t => {
    const model = board.tabs.get(t);
    return model ? tabRows(model) : [];
  });
  // With nothing in line and nothing the wallet can start, the list opens on its first project the wallet is short
  // of, so the dialog says what research needs (its effect, and the Data and Credits still missing) at once.
  const [open, setOpen] = useState<ResearchId | null>(() => {
    if (initial || line.id) return initial;
    const states = rowsOf(tab).map(n => ({ id: n.id, r: rank(nodeStatus(n, ctx), ctx) }));
    return states.some(x => x.r < 4) ? null : states.find(x => x.r === 4)?.id ?? null;
  });
  const [history, setHistory] = useState<Location[]>([]);
  const [follow, setFollow] = useState<{ id: ResearchId; n: number } | null>(initial ? { id: initial, n: 0 } : null);
  const previousOpen = useRef<ResearchNodeView | null>(null);
  useLayoutEffect(() => {
    if (!open) { previousOpen.current = null; return; }
    const current = byId.get(open);
    if (current) { previousOpen.current = current; return; }
    const series = previousOpen.current?.purchase?.series;
    const next = series && tree.nodes.find(n => n.purchase?.series === series);
    if (next) { setOpen(next.id); setFollow(f => ({ id: next.id, n: (f?.n ?? 0) + 1 })); }
  }, [byId, tree, open]);
  const restoreTop = useRef<number | null>(null);
  // Ready-first, ranked when the list is opened or its projects change. A row does not move while
  // the wallet or its own state changes under the player's finger.
  const natural = rowsOf(tab), ids = natural.map(orderKey);
  const frozen = useRef<{ tab: Filter; set: string; order: readonly string[] } | null>(null);
  const set = [...ids].sort().join();
  if (!frozen.current || frozen.current.tab !== tab || frozen.current.set !== set) {
    const ranked = natural.map((n, i) => ({ k: orderKey(n), r: rank(nodeStatus(n, ctx), ctx), i })).sort((a, b) => a.r - b.r || a.i - b.i);
    frozen.current = { tab, set, order: ranked.map(x => x.k) };
  }
  const place = new Map(frozen.current.order.map((k, i) => [k, i]));
  const rows = [...natural].sort((a, b) => place.get(orderKey(a))! - place.get(orderKey(b))!);

  const focused = open && byId.get(open);
  const shown = focused && focused.state === 'done' && !rows.some(n => n.id === open) ? [focused, ...rows] : rows;
  const reveal = (id: ResearchId) => { setOpen(id); setFollow(f => ({ id, n: (f?.n ?? 0) + 1 })); };
  const jump = (id: ResearchId) => {
    const to = board.where.get(id);
    if (!to || open === id) return;
    setHistory(h => [...h, { tab, open, top: listRef.current?.scrollTop ?? 0 }]);
    setTab(to); reveal(id);
  };
  const back = () => {
    const previous = history.at(-1);
    if (!previous) return false;
    setHistory(h => h.slice(0, -1)); setTab(previous.tab); setOpen(previous.open); setFollow(null);
    restoreTop.current = previous.top;
    return true;
  };
  useDialogFocus(ref, () => { if (!back()) onClose(); });
  useInnerBack(back);
  useLayoutEffect(() => {
    if (restoreTop.current !== null && listRef.current) { listRef.current.scrollTop = restoreTop.current; restoreTop.current = null; }
  });
  // A cut edge of the scrolling list fades while more lies beyond it, so a cut row reads as continuing.
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return undefined;
    const edges = () => {
      list.dataset.above = String(list.scrollTop > 2);
      list.dataset.below = String(list.scrollHeight - list.scrollTop - list.clientHeight > 2);
    };
    edges();
    list.addEventListener('scroll', edges, { passive: true });
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(edges);
    observer?.observe(list); if (list.firstElementChild) observer?.observe(list.firstElementChild);
    return () => { list.removeEventListener('scroll', edges); observer?.disconnect(); };
  }, []);
  const lastFocus = useRef(p.focusProject);
  useLayoutEffect(() => {
    if (p.focusProject && p.focusProject !== lastFocus.current) jump(p.focusProject);
    lastFocus.current = p.focusProject;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only an explicit new destination jumps.
  }, [p.focusProject]);
  useLayoutEffect(() => {
    const list = listRef.current, tile = follow && list?.querySelector<HTMLElement>(`[data-tile="${follow.id}"]`);
    if (list && tile) return followTile(list, tile);
    return undefined;
  }, [follow]);
  const previous = history.at(-1), backLabel = previous ? byId.get(previous.open!)?.name ?? 'Research' : p.returnLabel;
  const style = sheetBox(L), tabs: readonly Filter[] = board.owned.length > 1 ? ['all', ...board.owned] : [];
  const inner = Number(style.width) - 16, tight = tabs.length > 0 && (inner - 4 * (tabs.length - 1)) / tabs.length < 80;
  return <section ref={ref} className={`lab ${L.kind}${inner >= 480 ? ' cols' : inner < 344 ? ' stack' : ''}`} data-k="sheet"
    style={style} data-testid="research-drawer"
    role="dialog" aria-modal="true" aria-label="Research" tabIndex={-1} onPointerDown={e => e.stopPropagation()}>
    <header className="lab-head">
      {backLabel && <button type="button" className="lab-origin" data-qa-target data-testid="research-return" aria-label={`Back to ${backLabel}`}
        onClick={() => { if (!back()) onClose(); }}>‹ {backLabel}</button>}
      <b className="lab-title">Research</b>
      <button type="button" className="lab-close p-x" data-qa-target aria-label="Close research" onClick={onClose}>
        <i className="x-glyph" aria-hidden="true" style={{ width: 12, height: 12, '--x-w': '1px' } as CSSProperties} /></button>
    </header>
    {tabs.length > 0 && <nav className="lab-chips" aria-label="Research levels" data-wrap={tabs.length > 5 && inner < 344 || undefined} data-tight={tight || undefined}>{tabs.map(t => {
      const count = ready(t), name = t === 'all' ? 'All' : TAB_NAMES[t];
      return <button key={t} type="button" className="lab-chip" data-filter={t} data-qa-target aria-pressed={t === tab}
        aria-label={count ? `${name}, ${count} ready` : name}
        onClick={() => { setTab(t); setOpen(null); setFollow(null); listRef.current?.scrollTo({ top: 0 }); }}>
        {name}{count > 0 && <b className="lab-count" data-free={tight ? 'art' : undefined} aria-hidden="true">{count}</b>}</button>;
    })}</nav>}
    <div ref={listRef} className="lab-tree"><ul className="lab-projects">{shown.map(n =>
      <ResearchTile key={n.id} n={n} detail={{ tree, ctx, onAction, onJump: jump }} open={open}
        onToggle={id => open === id ? setOpen(null) : reveal(id)} />)}</ul>
      {!shown.length && <p className="lab-empty">{emptyLine(tab, tree)}</p>}
    </div>
  </section>;
}

const lineOf = (s: RenderSnapshot, tree: ResearchTreeView, stopped: boolean): LineState => {
  const r = s.feed.research;
  const between = s.hud.roundState !== 'running';
  const requested = s.research.breakRequested;
  if (r) return { id: r.project, name: r.name, running: r.running, stopped, progress: r.progress, opsPerSec: r.opsPerSec || tree.takenOpsPerSec, between, requested };
  const a = tree.nodes.find(n => n.id === tree.active);
  return a ? { id: a.id, name: a.name, running: tree.opsPerSec > 0, stopped, progress: a.progress, opsPerSec: tree.takenOpsPerSec, between, requested } : NO_LINE;
};

export function ResearchScreen() {
  const v = useViewState();
  return v.sheet === 'research' ? <OpenResearch project={v.researchProject} at={v.focus} /> : null;
}

function OpenResearch({ project, at }: { project: ResearchId | null; at: NodeRef }) {
  const shell = useShell(), L = useLayout();
  const key = useGameSelector(s => `${s.epoch}|${shell.store.getState().build.revision}|${s.research.active}|${Math.floor(s.research.progress * 100)}|${s.feed.research?.running}|`
    + `${s.research.queued}|${s.research.stoppedInsolvent}|${s.hud.data}|${s.hud.credits}|${s.hud.roundState}|${Object.values(s.unlocked).join()}`, Object.is, 250);
  const { tree, visible } = useMemo(() => {
    const state = shell.store.getState();
    return { tree: selectResearchTree(state, at), visible: new Set(selectContextualResearchTree(state, project, at).nodes.map(n => n.id)) };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- these keys cover the tree's inputs.
  }, [shell.store, key, project, at.level, at.id]);
  const s = shell.store.getSnapshot(), v = shell.view.getState(), slot = v.selected?.part?.slot;
  const index = slot && ['ram', 'gpu', 'drive'].includes(slot.kind) && 'index' in slot ? ` ${slot.index + 1}` : '';
  const returnLabel = v.selected ? targetName(v.selected, s.focus, shell.store.getState()) + index : v.task ? 'task' : null;
  return <ResearchView L={L} tree={tree} visible={visible} unlocked={s.unlocked} level={s.focus.level} focusProject={project}
    wallet={{ credits: s.hud.credits, data: s.hud.data }} line={lineOf(s, tree, s.research.stoppedInsolvent)}
    returnLabel={returnLabel} onAction={a => shell.dispatch(a)} onClose={() => shell.view.dispatch({ type: 'back' })} />;
}
