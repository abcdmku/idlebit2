// The research screen (concept C2, "hanging tree"). Tabs by hardware level, each showing only its
// own level's parts; the default tab follows the zoom and every owned tab stays usable. Under each
// part: a folded "✓ N done", the projects you can start, one locked next project and a dim count.
// D27: Start puts a project next in the market line; one project at a time.
import { useMemo, useRef, useState, type CSSProperties } from 'react';
import { selectContextualResearchTree, selectResearchTree, type GameAction, type LevelId, type RenderSnapshot, type ResearchId,
  type ResearchNodeView, type ResearchTabId, type ResearchTreeView } from '../../game';
import { ArtCanvas } from '../art/ArtCanvas';
import { drawMiniIcon, drawPartIcon } from '../art/deckArt';
import { useDialogFocus } from '../hooks/useDialogFocus';
import type { ShellLayout } from '../layout';
import { GemIcon, LockIcon } from '../plates/icons';
import { perMinuteText, wholeText } from '../plates/format';
import { box, useLayout } from '../shell/geometry';
import { useGameSelector, useShell, useViewState } from '../storeHooks';
import { typeColor } from '../../render/core';
import { DetailPanel, DetailSheet } from './ResearchDetail';
import { firstRow, isReady, LEVEL_TAB, PART_ICON, PART_NAMES, rowStatus, TAB_ICON, TAB_NAMES, tabBadges, tabList, tabModel,
  type LineState, type PartGroup, type Wallet } from './model';
import '../styles/research.css';

/** The phone sheet folded: grip, name and key, the line under the key. */
const SHEET_H = 128;

export interface ResearchViewProps {
  L: ShellLayout;
  /** The full tree (done counts, locks, "more later") and the ids the installed hardware can use. */
  tree: ResearchTreeView;
  visible: ReadonlySet<ResearchId>;
  unlocked: Readonly<Record<LevelId, boolean>>;
  /** The zoom level: the tab that opens first. */
  level: LevelId;
  focusProject: ResearchId | null;
  wallet: Wallet;
  line: LineState;
  between: boolean;
  onAction: (action: GameAction) => void;
  onClose: () => void;
}

export function ResearchView(p: ResearchViewProps) {
  const { L, tree, visible, unlocked, wallet, line, onAction, onClose } = p;
  const ref = useRef<HTMLElement>(null);
  useDialogFocus(ref, onClose);
  const { owned, teaser } = tabList(unlocked);
  const focusTab = p.focusProject ? tree.nodes.find(n => n.id === p.focusProject)?.tab : undefined;
  const [tab, setTab] = useState<ResearchTabId>(() => {
    const want = focusTab ?? LEVEL_TAB[p.level];
    return owned.includes(want) ? want : owned[owned.length - 1]!;
  });
  const model = tabModel(tree, visible, tab, wallet);
  const [picked, setPicked] = useState<{ tab: ResearchTabId; id: ResearchId | null } | null>(null);
  const selected = picked?.tab === tab ? picked.id : firstRow(model, p.focusProject);
  const [unfolded, setUnfolded] = useState<ReadonlySet<string>>(new Set());
  const [sheetOpen, setSheetOpen] = useState(false);
  const badges = tabBadges(tree, visible, wallet);
  const names = new Map(tree.nodes.map(n => [n.id, n.name]));
  const node = tree.nodes.find(n => n.id === selected) ?? null;
  const done = tree.nodes.filter(n => n.state === 'done').length;
  const phone = L.kind === 'phone', iconN = L.N;
  const cpm = Number(tree.creditsPerMinute);
  const pick = (id: ResearchId) => setPicked({ tab, id });
  const fold = (key: string) => setUnfolded(s => { const n = new Set(s); if (!n.delete(key)) n.add(key); return n; });
  const detail = { node, tree, line, names, wallet, onAction };

  const row = (n: ResearchNodeView, kind: 'open' | 'lock' | 'done') => {
    const status = rowStatus(n, line, names, wallet), running = n.state === 'active';
    const cls = kind === 'lock' ? 'lk' : kind === 'done' ? 'dn' : running ? `on${line.running ? '' : ' wait'}`
      : `av${isReady(n, wallet) ? '' : ' poor'}${line.id && n.state === 'available' ? ' after' : ''}`;
    return <li key={n.id} className={cls}>
      <button type="button" className={`lr ${cls}`} data-qa-target data-project={n.id} aria-pressed={n.id === selected} onClick={() => pick(n.id)}>
        <span className="lr-nm">{kind === 'lock' && <LockIcon />}<span>{n.name}</span></span>
        {kind !== 'done' && <span className="lr-pips">{n.answers.map(t => <i key={t} style={{ background: typeColor(t) }} />)}</span>}
        {kind !== 'done' && <span className="lr-cost"><GemIcon />{wholeText(n.dataCost)}</span>}
        <span className="lr-st">{status}</span>
        {running && line.running && <i className="lr-bar"><i style={{ width: `${Math.floor(n.progress * 100)}%` }} /></i>}
      </button>
    </li>;
  };

  const part = (g: PartGroup, next = false) => {
    const key = `${tab}:${g.part}`, open = unfolded.has(key);
    const spec = g.done.length ? g.done[g.done.length - 1]!.name : '';
    return <section key={g.part} className={`lp${next ? ' next' : ''}`} aria-label={PART_NAMES[g.part]}>
      {next ? <h3 className="lp-rule">Next level</h3> : <header className="lp-head">
        <span className="lp-ico"><ArtCanvas w={16} h={16} n={iconN} artKey={`rp:${g.part}`} draw={c => drawPartIcon(c, PART_ICON[g.part])} /></span>
        <h3>{PART_NAMES[g.part]}</h3>
        <span className="lp-spec">{spec}</span>
        <span className={`lp-ready${g.ready ? '' : ' none'}`}>{g.ready ? `${g.ready} ready` : 'Nothing to start'}</span>
      </header>}
      <ul className="br">
        {g.done.length > 0 && <li className="dn">
          <button type="button" className="lr sum" data-qa-target aria-expanded={open} onClick={() => fold(key)}>
            <span className="lr-nm"><span>✓ {g.done.length} done</span></span><span className="lr-st">{open ? 'Hide' : 'Show'}</span></button></li>}
        {open && g.done.map(n => row(n, 'done'))}
        {g.open.map(n => row(n, 'open'))}
        {g.lock && row(g.lock, 'lock')}
        {g.later > 0 && <li className="later"><span className="lr-later">{g.later} more later</span></li>}
      </ul>
    </section>;
  };

  const tabs = <div className="lab-tabs" role="tablist" style={{ gridTemplateColumns: `repeat(${owned.length + (teaser ? 1 : 0)}, minmax(0, 1fr))` }}>
      {owned.map(t => <button key={t} type="button" role="tab" className="lab-tab" data-qa-target aria-selected={t === tab}
        onClick={() => { setTab(t); setSheetOpen(false); }}>
        {(!phone || owned.length < 3) && <ArtCanvas w={8} h={8} n={iconN} artKey={`rt:${t}`} draw={c => drawMiniIcon(c, TAB_ICON[t])} />}
        <span>{TAB_NAMES[t]}</span>{badges[t] > 0 && <b className="n">{badges[t]}</b>}</button>)}
      {teaser && <button type="button" role="tab" className="lab-tab lockd" disabled aria-label={`${TAB_NAMES[teaser]}, locked`}>
        <span>{TAB_NAMES[teaser]}</span><LockIcon /></button>}
    </div>;

  return <section ref={ref} className={`lab ${L.kind}`} style={{ ...box(L.lab), '--ib': `${16 * iconN + 8}px`, '--dw': `${L.N === 3 ? 480 : 384}px` } as CSSProperties}
    data-k="sheet" data-testid="research-drawer" role="dialog" aria-modal="true" aria-label="Research" tabIndex={-1} onPointerDown={e => e.stopPropagation()}>
    <header className="lab-head">
      <div className="lab-title"><b>Research</b><span>{done} of {tree.nodes.length} done
        {p.between && cpm > 0 && <span className="gold"> · {perMinuteText(-cpm, false)}</span>}</span></div>
      {!phone && tabs}
      <button type="button" className="lab-back" data-qa-target onClick={onClose}>Back</button>
    </header>
    {phone && tabs}
    <div className="lab-tree" role="tabpanel" aria-label={TAB_NAMES[tab]}>
      {model.parts.length === 0 && !model.next && <p className="lab-empty">Nothing to research here yet.</p>}
      {model.parts.map(g => part(g))}
      {model.next && part(model.next, true)}
    </div>
    {phone ? <DetailSheet {...detail} open={sheetOpen} onToggle={() => setSheetOpen(o => !o)}
      height={sheetOpen && node ? Math.floor(L.lab.h * 0.72 / 8) * 8 : SHEET_H} /> : <DetailPanel {...detail} />}
  </section>;
}

const lineOf = (s: RenderSnapshot, tree: ResearchTreeView): LineState => {
  const r = s.feed.research;
  if (r) return { id: r.project, name: r.name, running: r.running, progress: r.progress };
  const a = tree.nodes.find(n => n.id === tree.active);
  return a ? { id: a.id, name: a.name, running: tree.opsPerSec > 0, progress: a.progress } : { id: null, name: '', running: false, progress: 0 };
};

/** Connected screen: null unless research is open. */
export function ResearchScreen() {
  const v = useViewState();
  if (v.sheet !== 'research') return null;
  return <OpenResearch project={v.researchProject} />;
}

function OpenResearch({ project }: { project: ResearchId | null }) {
  const shell = useShell(), L = useLayout();
  // Hardware changes can reveal projects even when the research badge is unchanged.
  const key = useGameSelector(s => `${s.epoch}|${shell.store.getState().build.revision}|${s.research.active}|${Math.floor(s.research.progress * 100)}|`
    + `${s.research.queued}|${s.feed.research?.running}|${s.hud.data}|${s.hud.credits}|${s.hud.roundState}|${Object.values(s.unlocked).join()}`, Object.is, 250);
  const level = useGameSelector(s => s.focus.level);
  const { tree, visible } = useMemo(() => {
    const state = shell.store.getState();
    return { tree: selectResearchTree(state), visible: new Set(selectContextualResearchTree(state, project).nodes.map(n => n.id)) };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` is the value identity of what the trees read
  }, [shell.store, key, project]);
  const s = shell.store.getSnapshot();
  return <ResearchView L={L} tree={tree} visible={visible} unlocked={s.unlocked} level={level} focusProject={project}
    wallet={{ credits: s.hud.credits, data: s.hud.data }} line={lineOf(s, tree)} between={s.hud.roundState !== 'running'}
    onAction={a => shell.dispatch(a)} onClose={() => shell.view.dispatch({ type: 'cancel' })} />;
}
