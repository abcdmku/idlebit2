import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { selectContextualResearchTree, selectResearchTree, type GameAction, type LevelId, type NodeRef, type RenderSnapshot, type ResearchId,
  type ResearchTabId, type ResearchTreeView, type ResearchNodeView } from '../../game';
import { useDialogFocus } from '../hooks/useDialogFocus';
import type { ShellLayout } from '../layout';
import { useInnerBack } from '../shell/backGuard';
import { box, useLayout } from '../shell/geometry';
import { useGameSelector, useShell, useViewState } from '../storeHooks';
import { targetName } from '../callout/model';
import { followTile } from './expand';
import { ResearchTile } from './ResearchTree';
import { buildBoard, LEVEL_TAB, tabRows, TAB_NAMES } from './model';
import type { Wallet } from './money';
import { NO_LINE, type KeyContext, type LineState } from './status';
import '../styles/research.css';

export interface ResearchViewProps {
  L: ShellLayout; tree: ResearchTreeView; visible: ReadonlySet<ResearchId>;
  unlocked: Readonly<Record<LevelId, boolean>>; level: LevelId; focusProject: ResearchId | null;
  wallet: Wallet; line: LineState; between: boolean;
  onAction: (action: GameAction) => void; onClose: () => void; returnLabel?: string | null;
}
type Filter = ResearchTabId | 'all';
interface Location { tab: Filter; open: ResearchId | null; top: number }

export function ResearchView(p: ResearchViewProps) {
  const { L, tree, line, onAction, onClose } = p;
  const ref = useRef<HTMLElement>(null), listRef = useRef<HTMLDivElement>(null);
  const board = useMemo(() => buildBoard(tree, p.visible, p.unlocked, p.focusProject), [tree, p.visible, p.unlocked, p.focusProject]);
  const byId = useMemo(() => new Map(tree.nodes.map(n => [n.id, n])), [tree]);
  const ctx: KeyContext = { byId, line, wallet: p.wallet, tree, between: p.between };
  const initial = p.focusProject && board.where.has(p.focusProject) ? p.focusProject : null;
  const [tab, setTab] = useState<Filter>(() => initial ? board.where.get(initial)! : LEVEL_TAB[p.level]);
  const [open, setOpen] = useState<ResearchId | null>(initial);
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
  const rows = (tab === 'all' ? board.owned : [tab]).flatMap(t => {
    const model = board.tabs.get(t);
    return model ? tabRows(model) : [];
  });
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
  return <section ref={ref} className={`lab ${L.kind}`} style={box(L.lab)} data-k="sheet" data-testid="research-drawer"
    role="dialog" aria-modal="true" aria-label="Research" tabIndex={-1} onPointerDown={e => e.stopPropagation()}>
    <header className="lab-head">
      {backLabel && <button type="button" className="lab-origin" data-qa-target data-testid="research-return" aria-label={`Back to ${backLabel}`}
        onClick={() => { if (!back()) onClose(); }}>‹ {backLabel}</button>}
      <b className="lab-title">Research</b>
      <button type="button" className="lab-close p-x" data-qa-target aria-label="Close research" onClick={onClose}>
        <i className="x-glyph" aria-hidden="true" style={{ width: 12, height: 12, '--x-w': '1px' } as CSSProperties} /></button>
    </header>
    {board.owned.length > 1 && <nav className="lab-chips" aria-label="Research levels">{(['all', ...board.owned] as const).map(t =>
      <button key={t} type="button" className="lab-chip" data-filter={t} data-qa-target aria-pressed={t === tab}
        onClick={() => { setTab(t); setOpen(null); setFollow(null); listRef.current?.scrollTo({ top: 0 }); }}>{t === 'all' ? 'All' : TAB_NAMES[t]}</button>)}</nav>}
    <div ref={listRef} className="lab-tree"><ul className="lab-projects">{shown.map(n =>
      <ResearchTile key={n.id} n={n} detail={{ tree, ctx, onAction, onJump: jump }} open={open}
        onToggle={id => open === id ? setOpen(null) : reveal(id)} />)}</ul>
      {!shown.length && <p className="lab-empty">No research available.</p>}
    </div>
  </section>;
}

const lineOf = (s: RenderSnapshot, tree: ResearchTreeView, stopped: boolean): LineState => {
  const r = s.feed.research;
  if (r) return { id: r.project, name: r.name, running: r.running, stopped, progress: r.progress, opsPerSec: r.opsPerSec || tree.takenOpsPerSec };
  const a = tree.nodes.find(n => n.id === tree.active);
  return a ? { id: a.id, name: a.name, running: tree.opsPerSec > 0, stopped, progress: a.progress, opsPerSec: tree.takenOpsPerSec } : NO_LINE;
};

export function ResearchScreen() {
  const v = useViewState();
  return v.sheet === 'research' ? <OpenResearch project={v.researchProject} at={v.focus} /> : null;
}

function OpenResearch({ project, at }: { project: ResearchId | null; at: NodeRef }) {
  const shell = useShell(), L = useLayout();
  const key = useGameSelector(s => `${s.epoch}|${shell.store.getState().build.revision}|${s.research.active}|${Math.floor(s.research.progress * 100)}|`
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
    wallet={{ credits: s.hud.credits, data: s.hud.data }} line={lineOf(s, tree, s.research.stoppedInsolvent)} between={s.hud.roundState !== 'running'}
    returnLabel={returnLabel} onAction={a => shell.dispatch(a)} onClose={() => shell.view.dispatch({ type: 'back' })} />;
}
