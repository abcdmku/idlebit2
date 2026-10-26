import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createInitialState, researchId, selectContextualResearchTree, selectResearchTree, type Amount, type GameAction, type GameState,
  type LevelId, type ResearchNodeView, type ResearchTreeView } from '../../game';
import { createGameStore } from '../../platform/store';
import { createLevelRegistry } from '../../render/core';
import { createShellValue, ShellContext } from '../storeHooks';
import { createViewStore, initialView } from '../viewState';
import { shellLayout } from '../layout';
import { LayoutContext } from '../shell/geometry';
import { button, click, mount, type Mounted } from '../plates/testkit';
import { ResearchScreen, ResearchView, type ResearchViewProps } from './ResearchScreen';
import { projectKey } from './model';
import { scrollGoal } from './expand';
import { closeTopmost } from '../shell/backGuard';
import { NO_LINE, type LineState } from './status';

let m: Mounted, acts: GameAction[];
beforeEach(() => { m = mount(); acts = []; });
afterEach(() => m.unmount());

const r = researchId;
const node = (id: string, state: ResearchNodeView['state'], over: Partial<ResearchNodeView> = {}): ResearchNodeView => ({
  id: r(id), name: id, category: 'compute', state, progress: 0, dataCost: '2500' as Amount, creditCost: '25000' as Amount, change: null,
  workOps: 5000, requires: [], lockedBy: null, level: 'chip', era: 'hz', tier: 3, needsData: false, effect: `${id} effect.`, summary: `${id} summary.`,
  answers: [], part: 'cores', tab: 'cpu', ...over });
const tree = (nodes: ResearchNodeView[], over: Partial<ResearchTreeView> = {}): ResearchTreeView => ({
  nodes, income: { dataPerSec: 1, creditsPerSec: 10 }, active: null, opsPerSec: 0, holdOpsPerSec: 100, takenOpsPerSec: 100, queue: [], queueSlots: 0,
  horizon: 'chip', lenders: [], creditsPerMinute: '0' as Amount, parts: SPECS, ...over });
const SPECS = { cores: { spec: '1 core · 1 lane' }, clock: { spec: '1 Hz' }, cache: { spec: '1 b' }, queue: { spec: 'none' } } as unknown as ResearchTreeView['parts'];
const CPU_ONLY = { chip: true, system: false, rack: false, room: false, global: false };
const rich = { credits: '1000000' as Amount, data: '1000000' as Amount };

function view(t: ResearchTreeView, over: Partial<ResearchViewProps> = {}) {
  m.render(<ResearchView L={shellLayout(1440, 900)} tree={t} visible={new Set(t.nodes.map(n => n.id))} unlocked={CPU_ONLY} level="chip"
    focusProject={null} wallet={rich} line={NO_LINE} between={false} onAction={a => acts.push(a)} onClose={() => undefined} {...over} />);
}
const row = (id: string) => m.host.querySelector<HTMLButtonElement>(`.lab-tree [data-project="${id}"]`);
const rowText = (id: string) => {
  const b = row(id);
  return b ? [b.querySelector('.lr-st')?.textContent, b.querySelector('.lr-ax')?.textContent].filter(Boolean).join(' / ') : null;
};
/** The open tile, its details and its key. */
const openTile = () => m.host.querySelector<HTMLElement>('.lab-tree .rw.open');
const detail = () => openTile()!.querySelector('.ld-body')!;
const key = () => openTile()!.querySelector<HTMLButtonElement>('.ld-key')!;
const selected = () => openTile()?.dataset.tile;
const head = (id: string) => row(id)!;
const tabNames = () => [...m.host.querySelectorAll('[role=tab]')].map(b => b.getAttribute('aria-label'));

// The user's phone screenshot: FIFO scheduler and C1 halt done, 267 Data.
const early = () => tree([
  node('fifoSched', 'done', { part: 'queue', name: 'FIFO scheduler' }),
  node('cstateC1', 'done', { part: 'clock', name: 'C1 halt' }),
  node('dualCore', 'available', { name: 'Dual core', requires: [r('fifoSched')], change: { label: 'Cores per CPU', before: '1', after: '2' } }),
  node('pipelining', 'available', { part: 'clock', name: 'Pipelining' }),
  node('cstateC3', 'locked', { part: 'clock', name: 'C3 sleep', dataCost: '0' as Amount, requires: [r('dualCore')], lockedBy: r('dualCore') }),
  node('l2Cache', 'locked', { part: 'cache', name: 'L2 cache', requires: [r('pipelining')], lockedBy: r('pipelining') }),
  node('quadCore', 'locked', { name: 'Quad core', dataCost: '50000' as Amount, creditCost: '500000' as Amount, requires: [r('dualCore'), r('l2Cache')], lockedBy: r('dualCore') }),
  node('systemBoard', 'locked', { part: 'structure', tab: 'system', name: 'System', requires: [r('dualCore'), r('l2Cache')], lockedBy: r('dualCore') }),
]);

describe('truthful states', () => {
  it('a row says what it is: ready, short with the amount and when, locked with what it needs', () => {
    view(early(), { wallet: { data: '267' as Amount, credits: '1000000' as Amount } });
    expect(rowText('dualCore')).toBe('Need 2,233 Data / in ~37 min');
    expect(rowText('cstateC3')).toBe('');
    expect(row('cstateC3')!.closest('li')!.querySelector('[data-needs]')!.textContent).toBe('Needs Dual core');
    // No part header claims "Nothing to start" over a startable row, and no dangling "N more later".
    expect(m.host.textContent).not.toMatch(/Nothing to start|more later/);
    expect([...m.host.querySelectorAll('.lp-done')].map(e => e.textContent)).toEqual(['0 of 2 done', '1 of 3 done', '0 of 1 done', '1 of 1 done']);
    // Each part heading shows the part's current spec; a part not owned yet shows none.
    expect([...m.host.querySelectorAll('.lp-spec')].map(e => e.textContent)).toEqual(['1 core · 1 lane', '1 Hz', '1 b', '']);
    view(early());
    expect(rowText('dualCore')).toBe('Ready');
    expect(tabNames()).toEqual(['CPU, 2 ready', 'System, locked']);
  });

  it('with no income (the recent rate at or below 0) a shortfall says so instead of an ETA', () => {
    view(tree([...early().nodes], { income: { dataPerSec: -3, creditsPerSec: 0 } }), { focusProject: r('dualCore'), wallet: { data: '267' as Amount, credits: '1000000' as Amount } });
    expect(rowText('dualCore')).toBe('Need 2,233 Data / no income right now');
    expect(key().textContent).toBe('Need 2,233 more Data');
    expect(detail().querySelector('.ld-facts')!.textContent).toContain('Need 2,233 more Data, no income right now');
  });

  it('no answers chips: rows and the details show no task types', () => {
    view(early(), { focusProject: r('dualCore') });
    expect(m.host.querySelector('.lr-pips, .ld-chip, [data-task-type]')).toBeNull();
    expect(detail().textContent).not.toMatch(/Answers/);
  });

  it('shows only the currencies a project costs; Credits-only rows show just the coin', () => {
    view(early());
    expect(row('cstateC3')!.querySelectorAll('.pt > span')).toHaveLength(1);
    expect(row('cstateC3')!.querySelector('.pt-c')?.textContent).toBe('25k');
    expect(row('dualCore')!.querySelector('.pt')!.textContent).toBe('2,50025k');
  });

  it('when both currencies are short, the slower one leads and the detail names the other', () => {
    // 2,233 Data at 1/s is ~37 min; 24,000 Credits at 10/s is ~40 min: Credits lead.
    view(early(), { wallet: { data: '267' as Amount, credits: '1000' as Amount } });
    expect(rowText('dualCore')).toBe('Need 24k Credits / in ~40 min');
    click(row('dualCore'));
    expect(key().textContent).toBe('Need 24k more Credits · ~40 min');
    expect(key().disabled).toBe(true);
    expect(detail().querySelector('.ld-facts')!.textContent).toContain('Also 2,233 more Data, in ~37 min');
  });
});

describe('prerequisites are links', () => {
  it('a locked row jumps to what it needs, opening its tile', () => {
    view(early());
    click(row('l2Cache')!.closest('li')!.querySelector('[data-needs]'));
    expect(selected()).toBe('pipelining');
    expect(detail().querySelector('.ld-effect')?.textContent).toBe('pipelining effect.');
    expect(document.activeElement).toBe(head('pipelining'));
    expect(acts).toEqual([]);
  });

  it('the locked key names the project to research first and jumps there, through locked prerequisites', () => {
    const t = early();
    view(t, { focusProject: r('quadCore'), wallet: { data: '0' as Amount, credits: '0' as Amount } });
    // Quad core needs Dual core (startable) and L2 cache (locked behind Pipelining).
    expect(key().textContent).toBe('Research Dual core first');
    const links = [...detail().querySelectorAll<HTMLElement>('.ld-facts [data-goto]')].map(b => b.textContent);
    expect(links).toEqual(['Dual core', 'L2 cache']);
    click(key());
    expect(selected()).toBe('dualCore');
    expect(acts).toEqual([]);
  });

  it('a link to a project on another tab switches tab', () => {
    const t = tree([
      node('memController', 'available', { part: 'ram', tab: 'system', name: 'Memory ctrl' }),
      node('dualSocket', 'locked', { name: 'Dual socket', requires: [r('memController')], lockedBy: r('memController') }),
    ]);
    view(t, { unlocked: { ...CPU_ONLY, system: true } });
    expect(m.host.querySelector('[role=tab][aria-selected=true]')?.textContent).toMatch(/^CPU/);
    click(row('dualSocket')!.closest('li')!.querySelector('[data-needs]'));
    expect(m.host.querySelector('[role=tab][aria-selected=true]')?.textContent).toMatch(/^System/);
    expect(selected()).toBe('memController');
  });

  it('every "Needs X" in the real tree has an X on screen, at every stage', () => {
    const base = createInitialState(42);
    const all = selectResearchTree(base).nodes;
    const upTo = (tier: number) => {
      const done = new Set<string>();
      for (let more = true; more;) {
        more = false;
        for (const n of all) if (!done.has(n.id) && n.tier <= tier && n.requires.every(id => done.has(id))) { done.add(n.id); more = true; }
      }
      return all.filter(n => done.has(n.id)).map(n => n.id);
    };
    const stage = (completed: string[], levels: LevelId[]): GameState => ({ ...base, research: { ...base.research, completed: completed.map(r),
      unlocks: { ...base.research.unlocks, levels: { ...base.research.unlocks.levels, ...Object.fromEntries(levels.map(l => [l, true])) } } } });
    const stages = [stage([], []), stage(['fifoSched', 'cstateC1'], []), stage([...upTo(3), 'systemBoard'], ['system']),
      stage([...new Set([...upTo(5), 'systemBoard', 'rack'])], ['system', 'rack'])];
    for (const s of stages) {
      const t = selectResearchTree(s), visible = new Set(selectContextualResearchTree(s).nodes.map(n => n.id));
      view(t, { visible, unlocked: s.research.unlocks.levels, wallet: { data: '0' as Amount, credits: '0' as Amount } });
      const shown = new Set<string>(), needs = new Set<string>();
      for (const tab of [...m.host.querySelectorAll<HTMLButtonElement>('[role=tab]:not(:disabled)')]) {
        click(tab);
        m.host.querySelectorAll<HTMLElement>('.lab-tree [data-project]').forEach(e => shown.add(e.dataset.project!));
        m.host.querySelectorAll<HTMLElement>('.lab-tree [data-needs]').forEach(e => needs.add(e.dataset.needs!));
      }
      expect(needs.size).toBeGreaterThan(0);
      expect([...needs].filter(id => !shown.has(id))).toEqual([]);
    }
  });
});

describe('D27 keys', () => {
  const line = (over: Partial<LineState>): LineState => ({ ...NO_LINE, id: r('dualCore'), name: 'Dual core', ...over });
  const inLine = (progress: number) => tree(early().nodes.map(n => n.id === 'dualCore' ? { ...n, state: 'active' as const, progress } : n), { active: r('dualCore') });

  it('Start goes next in line mid-round, runs now between rounds, with its hold and the line note', () => {
    view(early(), { focusProject: r('dualCore') });
    expect(key().textContent).toBe('Start · goes next in line');
    expect(detail().textContent).toContain('5k ops · holds your hardware ~50 s');
    expect(detail().textContent).toContain('Starting cuts the market line: tasks behind it wait while it runs.');
    expect(detail().querySelector('.ld-change')?.textContent).toBe('Cores per CPU1→2');
    click(key());
    expect(acts).toEqual([{ type: 'startResearch', project: 'dualCore' }]);
    view(early(), { focusProject: r('dualCore'), between: true });
    expect(key().textContent).toBe('Start · runs now');
    expect(detail().textContent).toContain('Between rounds it runs on paused servers: no SLA cost, energy only.');
  });

  it('next in line, then running with the time left; Pause keeps progress', () => {
    view(inLine(0.42), { focusProject: r('dualCore'), line: line({ progress: 0.42 }) });
    expect(key().textContent).toBe('Next in line');
    expect(m.host.querySelector('.lab-line')?.textContent).toBe('Dual corenext in line');
    view(inLine(0.42), { focusProject: r('dualCore'), line: line({ running: true, progress: 0.42, opsPerSec: 100 }) });
    expect(key().textContent).toBe('Running 42% · ~30 s left');
    expect(rowText('dualCore')).toBe('Running 42% / ~30 s left');
    click(button(detail(), 'Pause'));
    expect(acts).toEqual([{ type: 'cancelResearch' }]);
  });

  it('one at a time: others wait for the project in line, or queue once the queue is researched', () => {
    view(inLine(0.1), { focusProject: r('pipelining'), line: line({ running: true }) });
    expect(rowText('pipelining')).toBe('After Dual core');
    expect(key().textContent).toBe('Wait for Dual core');
    expect(tabNames()[0]).toBe('CPU');
    view(tree([...inLine(0.1).nodes], { active: r('dualCore'), queueSlots: 3 }), { focusProject: r('pipelining'), line: line({ running: true }) });
    click(key());
    expect(acts).toEqual([{ type: 'queueResearch', project: 'pipelining' }]);
  });

  it('a paused project resumes free; a project stopped for Credits resumes once paid', () => {
    view(tree(early().nodes.map(n => n.id === 'pipelining' ? { ...n, state: 'parked' as const, progress: 0.5 } : n)), { focusProject: r('pipelining') });
    expect(rowText('pipelining')).toBe('Paused 50%');
    click(key());
    expect(acts).toEqual([{ type: 'startResearch', project: 'pipelining' }]);
    view(inLine(0.3), { focusProject: r('dualCore'), line: line({ running: false, stopped: true }) });
    expect(key().textContent).toBe('Resume');
    click(key());
    expect(acts.at(-1)).toEqual({ type: 'resumeResearch' });
  });
});

describe('tiles open in place', () => {
  it('a tap opens a tile with everything about the project; one tile at a time; its header shuts it', () => {
    view(early(), { L: shellLayout(390, 780) });
    expect(openTile()).toBeNull();
    click(head('dualCore'));
    expect(selected()).toBe('dualCore');
    expect(head('dualCore').getAttribute('aria-expanded')).toBe('true');
    const facts = detail().querySelector('.ld-facts')!.textContent;
    expect(facts).toContain('✓ FIFO scheduler');
    expect(facts).toContain('5k ops · holds your hardware ~50 s');
    expect([...detail().querySelectorAll<HTMLElement>('[data-goto]')].map(b => b.dataset.goto)).toEqual(['cstateC3', 'systemBoard']);
    expect(detail().textContent).toContain('and 1 later');
    expect(key().textContent).toBe('Start · goes next in line');
    // Another tap moves the one open tile; the shutting one keeps no live keys.
    click(head('pipelining'));
    expect(selected()).toBe('pipelining');
    expect(m.host.querySelectorAll('.lab-tree .rw.open')).toHaveLength(1);
    expect(head('dualCore').getAttribute('aria-expanded')).toBe('false');
    expect(row('dualCore')!.closest('li')!.querySelector('.tx')?.hasAttribute('inert') ?? true).toBe(true);
    click(head('pipelining'));
    expect(openTile()).toBeNull();
  });

  it('keys work inside the tile', () => {
    view(early());
    click(head('pipelining'));
    click(key());
    expect(acts).toEqual([{ type: 'startResearch', project: 'pipelining' }]);
  });

  it('a link opens its target and scrolls the list until all of it shows', () => {
    m.render(<div data-reduced-motion="true"><ResearchView L={shellLayout(390, 780)} tree={early()} visible={new Set(early().nodes.map(n => n.id))}
      unlocked={CPU_ONLY} level="chip" focusProject={null} wallet={rich} line={NO_LINE} between={false} onAction={a => acts.push(a)} onClose={() => undefined} /></div>);
    const box = m.host.querySelector<HTMLElement>('.lab-tree')!, tile = row('systemBoard')!.closest('li')!;
    // The list shows 0..300; the System tile sits at 900..1100 once laid out.
    const at = (el: Element, top: number, height: number) => { el.getBoundingClientRect = () => ({ top, height, bottom: top + height } as DOMRect); };
    at(box, 0, 300); at(tile, 900, 200);
    Object.defineProperty(box, 'clientHeight', { value: 300 }); Object.defineProperty(box, 'scrollHeight', { value: 2000 });
    click(head('dualCore'));
    click(detail().querySelector('[data-goto="systemBoard"]'));
    expect(selected()).toBe('systemBoard');
    expect(box.scrollTop).toBe(808);
  });

  it('back and Escape shut the open tile before they close research', () => {
    const base = createInitialState(42);
    const store = createGameStore({ initialState: base });
    const vs = createViewStore(store.getSnapshot, initialView(store.getSnapshot()));
    const layout = shellLayout(390, 780);
    const shell = createShellValue(store, vs, createLevelRegistry(), { renderer: null, layout, plateBounds: layout.calloutBounds,
      frameListeners: new Set(), buildQuotes: null, drawCount: 0 });
    vs.dispatch({ type: 'openResearch', project: r('fifoSched') });
    m.render(<ShellContext.Provider value={shell}><LayoutContext.Provider value={layout}><ResearchScreen /></LayoutContext.Provider></ShellContext.Provider>);
    expect(selected()).toBe('fifoSched');
    act(() => { closeTopmost(shell); });
    expect(openTile()).toBeNull();
    expect(vs.getState().sheet).toBe('research');
    act(() => { closeTopmost(shell); });
    expect(vs.getState().sheet).toBeNull();
    act(() => { vs.dispatch({ type: 'openResearch', project: r('fifoSched') }); });
    expect(selected()).toBe('fifoSched');
    const esc = () => act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    esc();
    expect(openTile()).toBeNull();
    expect(vs.getState().sheet).toBe('research');
    esc();
    expect(vs.getState().sheet).toBeNull();
    store.dispose();
  });

  it('the list follows a tile to the nearest scroll that shows all of it', () => {
    const view300 = { top: 100, height: 300 };
    expect(scrollGoal(view300, { top: 150, height: 100 })).toBe(100);
    expect(scrollGoal(view300, { top: 350, height: 100 })).toBe(158);
    expect(scrollGoal(view300, { top: 40, height: 100 })).toBe(32);
    expect(scrollGoal(view300, { top: 500, height: 400 })).toBe(492);
  });
});

describe('connected research screen', () => {
  it('uses hardware discovery, and an opened project selects its own tab', () => {
    const base = createInitialState(42);
    const state = { ...base, research: { ...base.research, completed: [r('systemBoard'), r('memController')],
      unlocks: { ...base.research.unlocks, levels: { ...base.research.unlocks.levels, system: true } } } };
    const store = createGameStore({ initialState: state });
    const vs = createViewStore(store.getSnapshot, initialView(store.getSnapshot()));
    const layout = shellLayout(1440, 900);
    const shell = createShellValue(store, vs, createLevelRegistry(), { renderer: null, layout, plateBounds: layout.calloutBounds,
      frameListeners: new Set(), buildQuotes: null, drawCount: 0 });
    vs.dispatch({ type: 'openResearch', project: r('gpuGen1') });
    m.render(<ShellContext.Provider value={shell}><LayoutContext.Provider value={layout}><ResearchScreen /></LayoutContext.Provider></ShellContext.Provider>);
    expect(m.host.querySelector<HTMLElement>('[data-testid=research-drawer]')!.style.cssText).toContain(`top: ${layout.lab.y}px`);
    expect(m.host.querySelector('[role=tab][aria-selected=true]')?.textContent).toMatch(/^System/);
    const names = () => [...m.host.querySelectorAll('.lab-tree [data-project] .lr-nm')].map(n => n.textContent);
    expect(names()).toContain('GPU gen 1, 1 kHz');
    expect(names()).not.toContain('GPU gen 9, 100 GHz');
    expect(names()).not.toContain('DDR');
    expect(selected()).toBe('gpuGen1');
    const system = state.build.systems[0]!;
    act(() => store.replaceState({ ...state, build: { ...state.build, revision: state.build.revision + 1,
      systems: [{ ...system, spec: { ...system.spec, ram: [{ gen: 0, level: 1, ecc: false }] } }] } }));
    expect(names()).toContain('DDR');
    store.dispose();
  });
});

describe('project keys for the deck and GPU plate', () => {
  const t = { active: null, queue: [], queueSlots: 0 };
  it('price both currencies, resume paused projects free, and hold one project at a time', () => {
    const n = node('b', 'available');
    expect(projectKey(n, t, '25000' as Amount, '2500' as Amount)).toEqual({ label: 'Start', action: { type: 'startResearch', project: 'b' } });
    expect(projectKey(n, t, '24999' as Amount, '2500' as Amount).label).toBe('Needs Credits');
    expect(projectKey(n, t, '25000' as Amount, '2499' as Amount).label).toBe('Needs Data');
    expect(projectKey(n, { ...t, active: r('x') }, '25000' as Amount, '2500' as Amount)).toEqual({ label: 'One at a time', action: null });
    expect(projectKey(n, { ...t, active: r('x'), queueSlots: 3 }, '25000' as Amount, '2500' as Amount).label).toBe('Queue');
    expect(projectKey({ ...n, state: 'parked' }, t).action).toEqual({ type: 'startResearch', project: 'b' });
    expect(projectKey({ ...n, state: 'queued' }, t).action).toEqual({ type: 'unqueueResearch', project: 'b' });
  });
});
