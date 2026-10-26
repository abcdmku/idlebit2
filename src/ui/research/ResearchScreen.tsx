// The research screen (concept C, "grows from your hardware"). Tabs by hardware level, each showing
// only its own level's parts; the default tab follows the zoom. Tapping a tile opens it in place with
// everything about the project, one tile at a time, and the list follows it into view. Every
// prerequisite is a link that opens its project, switching tab when needed. Back and Escape shut an
// open tile before they close the screen. D27: Start puts a project at the front of the market line.
import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { selectContextualResearchTree, selectResearchTree, type GameAction, type LevelId, type NodeRef, type RenderSnapshot, type ResearchId,
  type ResearchTabId, type ResearchTreeView } from '../../game';
import { ArtCanvas } from '../art/ArtCanvas';
import { drawMiniIcon } from '../art/deckArt';
import { useDialogFocus } from '../hooks/useDialogFocus';
import type { ShellLayout } from '../layout';
import { LockIcon } from '../plates/icons';
import { wholeText } from '../plates/format';
import { useInnerBack } from '../shell/backGuard';
import { box, useLayout } from '../shell/geometry';
import { useGameSelector, useShell, useViewState } from '../storeHooks';
import { followTile } from './expand';
import { PartSection } from './ResearchTree';
import { buildBoard, LEVEL_TAB, tabRows, TAB_ICON, TAB_NAMES } from './model';
import { incomeOf, type Wallet } from './money';
import { nodeStatus, NO_LINE, type KeyContext, type LineState } from './status';
import '../styles/research.css';

export interface ResearchViewProps {
  L: ShellLayout;
  /** The full tree, and the ids the installed hardware can use (the contextual tree). */
  tree: ResearchTreeView;
  visible: ReadonlySet<ResearchId>;
  unlocked: Readonly<Record<LevelId, boolean>>;
  /** The zoom level: the tab that opens first. */
  level: LevelId;
  /** Opens on this project's tile. */
  focusProject: ResearchId | null;
  wallet: Wallet;
  line: LineState;
  between: boolean;
  onAction: (action: GameAction) => void;
  onClose: () => void;
}

export function ResearchView(p: ResearchViewProps) {
  const { L, tree, line, onAction, onClose } = p;
  const ref = useRef<HTMLElement>(null), treeRef = useRef<HTMLDivElement>(null);
  const board = useMemo(() => buildBoard(tree, p.visible, p.unlocked, p.focusProject), [tree, p.visible, p.unlocked, p.focusProject]);
  const byId = useMemo(() => new Map(tree.nodes.map(n => [n.id, n])), [tree]);
  const ctx: KeyContext = { byId, line, wallet: p.wallet, income: incomeOf(tree.income), tree, between: p.between };
  const startFocus = p.focusProject && board.where.has(p.focusProject) ? p.focusProject : null;
  const [tab, setTab] = useState<ResearchTabId>(() => {
    const want = (startFocus && board.where.get(startFocus)) || LEVEL_TAB[p.level];
    return board.tabs.has(want) ? want : board.owned[board.owned.length - 1]!;
  });
  const [open, setOpen] = useState<ResearchId | null>(startFocus);
  const [unfolded, setUnfolded] = useState<ReadonlySet<string>>(new Set());
  // A tile to bring fully into view once it is laid out; `n` makes every request follow again.
  const [follow, setFollow] = useState<{ id: ResearchId; focus: boolean; n: number } | null>(startFocus ? { id: startFocus, focus: false, n: 0 } : null);
  const model = board.tabs.get(tab) ?? board.tabs.get(board.owned[0]!)!;
  const phone = L.kind === 'phone', iconN = L.N;

  const openTile = (id: ResearchId, focus: boolean) => { setOpen(id); setFollow(f => ({ id, focus, n: (f?.n ?? 0) + 1 })); };
  /** A header tap: open that tile (shutting the open one), or shut it when it is the open one. */
  const toggle = (id: ResearchId) => { if (open === id) setOpen(null); else openTile(id, false); };
  /** A link: the project's tab, its tile open, followed into view and focused. */
  const jump = (id: ResearchId) => {
    const t = board.where.get(id);
    if (!t) return;
    setTab(t); openTile(id, true);
  };
  const showTab = (t: ResearchTabId) => {
    if (t === tab) return;
    setTab(t); setOpen(null); setFollow(null);
    treeRef.current?.scrollTo?.({ top: 0 });
  };
  /** Back and Escape: an open tile shuts first. */
  const shut = () => { if (!open) return false; setOpen(null); return true; };
  useDialogFocus(ref, () => { if (!shut()) onClose(); });
  useInnerBack(shut);

  // Opening research on another project while it is open jumps there.
  const lastFocus = useRef(p.focusProject);
  useLayoutEffect(() => {
    if (p.focusProject && p.focusProject !== lastFocus.current) jump(p.focusProject);
    lastFocus.current = p.focusProject;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only a new focus jumps
  }, [p.focusProject]);
  useLayoutEffect(() => {
    const box = treeRef.current, tile = follow && box?.querySelector<HTMLElement>(`[data-tile="${follow.id}"]`);
    if (!box || !tile) return;
    if (follow!.focus) tile.querySelector<HTMLElement>('[data-project]')?.focus({ preventScroll: true });
    return followTile(box, tile);
  }, [follow]);
  const fold = (key: string) => setUnfolded(s => { const n = new Set(s); if (!n.delete(key)) n.add(key); return n; });

  const ready = (t: ResearchTabId) => {
    const m = board.tabs.get(t);
    return m ? tabRows(m).filter(n => nodeStatus(n, ctx).kind === 'ready').length : 0;
  };
  const tabs = <div className="lab-tabs" role="tablist" style={{ gridTemplateColumns: `repeat(${board.owned.length + (board.teaser ? 1 : 0)}, minmax(0, 1fr))` }}>
    {board.owned.map(t => {
      const n = ready(t);
      return <button key={t} type="button" role="tab" className="lab-tab" data-qa-target aria-selected={t === tab}
        aria-label={`${TAB_NAMES[t]}${n ? `, ${n} ready` : ''}`} onClick={() => showTab(t)}>
        {(!phone || board.owned.length < 4) && <ArtCanvas w={8} h={8} n={iconN} artKey={`rt:${t}`} draw={c => drawMiniIcon(c, TAB_ICON[t])} />}
        <span>{TAB_NAMES[t]}</span>{n > 0 && <b className="n">{n}</b>}</button>;
    })}
    {board.teaser && <button type="button" role="tab" className="lab-tab lockd" disabled aria-label={`${TAB_NAMES[board.teaser]}, locked`}>
      <span>{TAB_NAMES[board.teaser]}</span><LockIcon /></button>}
  </div>;

  // The line: what holds the front of the market queue, as a link to it.
  const cpm = Number(tree.creditsPerMinute);
  const inLine = line.id ? byId.get(line.id) : undefined;
  const lineWord = line.stopped ? 'stopped: no Credits' : line.running ? `running ${Math.floor(line.progress * 100)}%` : 'next in line';
  const title = <div className="lab-title"><b>Research</b>
    {inLine ? <button type="button" className="lab-line" data-qa-target data-goto={inLine.id} onClick={() => jump(inLine.id)}>
      <span className="nm">{inLine.name}</span><span>{lineWord}</span>
      {p.between && cpm > 0 && <span className="gold">−{wholeText(cpm)}/min</span>}</button>
      : <span className="lab-line idle">Nothing in line</span>}</div>;

  const tiles = { detail: { tree, board, ctx, onAction, onJump: jump }, open, onToggle: toggle };
  return <section ref={ref} className={`lab ${L.kind}`} style={{ ...box(L.lab), '--ib': `${16 * iconN + 8}px` } as CSSProperties}
    data-k="sheet" data-testid="research-drawer" role="dialog" aria-modal="true" aria-label="Research" tabIndex={-1} onPointerDown={e => e.stopPropagation()}>
    <header className="lab-head">
      {title}
      {!phone && tabs}
      <button type="button" className="lab-back" data-qa-target onClick={onClose}>Back</button>
    </header>
    {phone && tabs}
    <div ref={treeRef} className="lab-tree" role="tabpanel" aria-label={TAB_NAMES[model.tab]}>
      <div className="lab-col">
        {model.parts.length === 0 && !model.next && <p className="lab-empty">Nothing to research here yet.</p>}
        {model.parts.map(g => <PartSection key={g.part} g={g} spec={tree.parts[g.part]?.spec ?? ''} iconN={iconN}
          folded={!unfolded.has(`${model.tab}:${g.part}`)} onFold={() => fold(`${model.tab}:${g.part}`)} {...tiles} />)}
        {model.next && <PartSection g={model.next} spec="" iconN={iconN} folded onFold={() => undefined} {...tiles} />}
      </div>
    </div>
  </section>;
}

const lineOf = (s: RenderSnapshot, tree: ResearchTreeView, stopped: boolean): LineState => {
  const r = s.feed.research;
  if (r) return { id: r.project, name: r.name, running: r.running, stopped, progress: r.progress, opsPerSec: r.opsPerSec || tree.takenOpsPerSec };
  const a = tree.nodes.find(n => n.id === tree.active);
  return a ? { id: a.id, name: a.name, running: tree.opsPerSec > 0, stopped, progress: a.progress, opsPerSec: tree.takenOpsPerSec } : NO_LINE;
};

/** Connected screen: null unless research is open. */
export function ResearchScreen() {
  const v = useViewState();
  if (v.sheet !== 'research') return null;
  return <OpenResearch project={v.researchProject} at={v.focus} />;
}

/** `at`: the focused node; part specs read from its system (or rack). */
function OpenResearch({ project, at }: { project: ResearchId | null; at: NodeRef }) {
  const shell = useShell(), L = useLayout();
  // Hardware changes can reveal projects even when the research badge is unchanged.
  const key = useGameSelector(s => `${s.epoch}|${shell.store.getState().build.revision}|${s.research.active}|${Math.floor(s.research.progress * 100)}|`
    + `${s.research.queued}|${s.research.stoppedInsolvent}|${s.feed.research?.running}|${s.hud.data}|${s.hud.credits}|${s.hud.roundState}|`
    + `${Object.values(s.unlocked).join()}|${Math.floor(s.hud.roundElapsedMs / 5000)}`, Object.is, 250);
  const level = useGameSelector(s => s.focus.level);
  const { tree, visible } = useMemo(() => {
    const state = shell.store.getState();
    return { tree: selectResearchTree(state, at), visible: new Set(selectContextualResearchTree(state, project, at).nodes.map(n => n.id)) };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` is the value identity of what the trees read
  }, [shell.store, key, project, at.level, at.id]);
  const s = shell.store.getSnapshot();
  return <ResearchView L={L} tree={tree} visible={visible} unlocked={s.unlocked} level={level} focusProject={project}
    wallet={{ credits: s.hud.credits, data: s.hud.data }} line={lineOf(s, tree, s.research.stoppedInsolvent)} between={s.hud.roundState !== 'running'}
    onAction={a => shell.dispatch(a)} onClose={() => shell.view.dispatch({ type: 'cancel' })} />;
}
