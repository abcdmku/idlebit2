import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createInitialState, researchId, type Amount, type GameAction, type ResearchNodeView, type ResearchTreeView } from '../../game';
import { createGameStore } from '../../platform/store';
import { createLevelRegistry } from '../../render/core';
import { createShellValue, ShellContext } from '../storeHooks';
import { createViewStore, initialView } from '../viewState';
import { shellLayout } from '../layout';
import { LayoutContext } from '../shell/geometry';
import { button, click, mount, type Mounted } from '../plates/testkit';
import { ResearchScreen, ResearchView, type ResearchViewProps } from './ResearchScreen';
import { projectKey, tabBadges, tabList, tabModel, type LineState } from './model';

let m: Mounted, acts: GameAction[];
beforeEach(() => { m = mount(); acts = []; });
afterEach(() => m.unmount());

const node = (id: string, state: ResearchNodeView['state'], over: Partial<ResearchNodeView> = {}): ResearchNodeView => ({
  id: researchId(id), name: id, category: 'compute', state, progress: 0, dataCost: '150000' as Amount, workOps: 3e6, requires: [], lockedBy: null,
  level: 'system', era: 'khz', tier: 6, needsData: false, effect: '', summary: '', answers: [], part: 'cores', tab: 'cpu', ...over });
const tree = (nodes: ResearchNodeView[], over: Partial<ResearchTreeView> = {}): ResearchTreeView => ({
  nodes, active: null, opsPerSec: 6400, holdOpsPerSec: 250_000, queue: [], queueSlots: 0, horizon: 'system', lenders: [], creditsPerMinute: '9960' as Amount, ...over });
const rich = { credits: '1000000' as Amount, data: '1000000' as Amount };
const idle: LineState = { id: null, name: '', running: false, progress: 0 };
const all = (t: ResearchTreeView) => new Set(t.nodes.map(n => n.id));
const r = researchId;

function view(t: ResearchTreeView, over: Partial<ResearchViewProps> = {}) {
  m.render(<ResearchView L={shellLayout(1440, 900)} tree={t} visible={all(t)} unlocked={{ chip: true, system: true, rack: false, room: false, global: false }}
    level="system" focusProject={null} wallet={rich} line={idle} between={false} onAction={a => acts.push(a)} onClose={() => undefined} {...over} />);
}
const rows = () => [...m.host.querySelectorAll<HTMLElement>('.lab-tree [data-project]')].map(b => `${b.dataset.project}: ${b.querySelector('.lr-st')?.textContent}`);

describe('research tabs (concept C2)', () => {
  const t = tree([
    node('pipelining', 'done', { part: 'clock' }), node('superscalar', 'available', { part: 'clock', requires: [r('pipelining')] }),
    node('simd', 'locked', { part: 'clock', requires: [r('superscalar')], lockedBy: r('superscalar') }),
    node('wideVector', 'locked', { part: 'clock', requires: [r('simd')], lockedBy: r('simd') }),
    node('dualCore', 'available', { part: 'cores', dataCost: '500' as Amount }),
    node('ddr', 'available', { part: 'ram', tab: 'system' }),
    node('systemBoard', 'done', { part: 'structure', tab: 'system' }),
    node('rack', 'locked', { part: 'structure', tab: 'rack', requires: [r('far')], lockedBy: r('far') }),
  ]);

  it('a tab holds only its own parts, in board order, each with done, startable rows, one lock and a count', () => {
    const cpu = tabModel(t, all(t), 'cpu', rich);
    expect(cpu.parts.map(g => g.part)).toEqual(['cores', 'clock']);
    const clock = cpu.parts[1]!;
    expect(clock.done.map(n => n.id)).toEqual(['pipelining']);
    expect(clock.open.map(n => n.id)).toEqual(['superscalar']);
    expect(clock.lock?.id).toBe('simd');
    expect(clock.later).toBe(1);
    expect(cpu.next).toBeNull();
    const system = tabModel(t, all(t), 'system', rich);
    expect(system.parts.map(g => g.part)).toEqual(['ram']);
    // Next level: this tab's structure folded as done, then what opens the next level, even before its prerequisites
    expect(system.next?.done.map(n => n.id)).toEqual(['systemBoard']);
    expect(system.next?.lock?.id).toBe('rack');
  });

  it('hides projects the installed hardware cannot use', () => {
    const visible = all(t); visible.delete(r('ddr'));
    expect(tabModel(t, visible, 'system', rich).parts).toEqual([]);
  });

  it('owned tabs, one locked teaser, and badges that count startable projects', () => {
    expect(tabList({ chip: true, system: true, rack: false, room: false, global: false })).toEqual({ owned: ['cpu', 'system'], teaser: 'rack' });
    expect(tabList({ chip: true, system: true, rack: true, room: true, global: true })).toEqual({ owned: ['cpu', 'system', 'rack', 'room', 'global'], teaser: null });
    expect(tabBadges(t, all(t), rich)).toEqual({ cpu: 2, system: 1, rack: 0, room: 0, global: 0 });
    expect(tabBadges(t, all(t), { ...rich, data: '600' as Amount }).cpu).toBe(1);
  });

  it('opens on the zoom level, switches tabs, and never mixes levels', () => {
    view(t);
    const tabs = [...m.host.querySelectorAll('[role=tab]')].map(b => b.textContent);
    expect(tabs).toEqual(['CPU2', 'System1', 'Rack']);
    expect(m.host.querySelector('[role=tab][aria-selected=true]')?.textContent).toBe('System1');
    expect(button(m.host, /^Rack/).disabled).toBe(true);
    expect(rows()).toEqual(['ddr: Ready', 'rack: After far']);
    click(button(m.host, /^CPU/));
    expect(rows()).toEqual(['dualCore: Ready', 'superscalar: Ready', 'simd: After superscalar']);
    // the done fold opens on tap
    click(m.host.querySelectorAll<HTMLButtonElement>('.lr.sum')[0]);
    expect(rows()).toContain('pipelining: Done');
    expect(m.host.textContent).toContain('1 more later');
  });

  it('Start goes next in line with the hold estimate; the detail shows needs, answers, Data and work', () => {
    view(t, { focusProject: r('superscalar') });
    expect(m.host.querySelector('[role=tab][aria-selected=true]')?.textContent).toBe('CPU2');
    const panel = m.host.querySelector('.ld-panel')!;
    expect(panel.querySelector('h3')?.textContent).toBe('superscalar');
    expect(panel.querySelector('.ld-facts')?.textContent).toContain('✓ pipelining');
    expect(panel.querySelector('.ld-facts')?.textContent).toContain('150k');
    expect(panel.querySelector('.ld-facts')?.textContent).toContain('3M ops');
    expect(panel.querySelector('.ld-note')?.textContent).toBe('Goes next in line · ~12 s on your hardware');
    click(button(panel, /^Start/));
    expect(acts).toEqual([{ type: 'startResearch', project: 'superscalar' }]);
  });

  it('D27: the project in line reads Next in line, then Running; every other row waits After it', () => {
    const busy = tree([node('fabKhz', 'active', { part: 'fab', progress: 0.42, name: 'kHz fab' }), node('l2', 'available', { part: 'cache' })], { active: r('fabKhz') });
    const line: LineState = { id: r('fabKhz'), name: 'kHz fab', running: false, progress: 0.42 };
    view(busy, { level: 'chip', line });
    expect(rows()).toEqual(['l2: After kHz fab', 'fabKhz: Next in line']);
    click(m.host.querySelector('[data-project=l2]'));
    expect(m.host.querySelector<HTMLButtonElement>('.ld-key')?.textContent).toBe('After kHz fab');
    expect(m.host.querySelector<HTMLButtonElement>('.ld-key')?.disabled).toBe(true);
    expect(m.host.querySelector('.ld-note')?.textContent).toBe('One project in line at a time');
    view(busy, { level: 'chip', line: { ...line, running: true } });
    expect(rows()).toContain('fabKhz: Running 42%');
  });

  it('phone: the detail is a bottom sheet that folds open from its grip', () => {
    view(t, { L: shellLayout(390, 780) });
    const sheet = m.host.querySelector('.ld-sheet')!;
    expect(sheet.querySelector('.ld-facts')).toBeNull();
    click(sheet.querySelector('.ld-grip'));
    expect(m.host.querySelector('.ld-sheet.open .ld-facts')).not.toBeNull();
  });
});

describe('connected research screen', () => {
  it('uses hardware discovery, and an opened project selects its own tab', () => {
    const base = createInitialState(42);
    const state = { ...base, research: { ...base.research, completed: [researchId('systemBoard'), researchId('memController')],
      unlocks: { ...base.research.unlocks, levels: { ...base.research.unlocks.levels, system: true } } } };
    const store = createGameStore({ initialState: state });
    const vs = createViewStore(store.getSnapshot, initialView(store.getSnapshot()));
    const layout = shellLayout(1440, 900);
    const shell = createShellValue(store, vs, createLevelRegistry(), { renderer: null, layout, plateBounds: layout.calloutBounds,
      frameListeners: new Set(), buildQuotes: null, drawCount: 0 });
    vs.dispatch({ type: 'openResearch', project: researchId('gpuGen1') });
    m.render(<ShellContext.Provider value={shell}><LayoutContext.Provider value={layout}><ResearchScreen /></LayoutContext.Provider></ShellContext.Provider>);
    expect(m.host.querySelector<HTMLElement>('[data-testid=research-drawer]')!.style.cssText).toContain(`top: ${layout.lab.y}px`);
    expect(m.host.querySelector('[role=tab][aria-selected=true]')?.textContent).toMatch(/^System/);
    const names = () => [...m.host.querySelectorAll('.lab-tree [data-project] .lr-nm')].map(n => n.textContent);
    expect(names()).toContain('GPU gen 1, 1 kHz');
    expect(names()).not.toContain('GPU gen 9, 100 GHz');
    expect(names()).not.toContain('DDR');
    expect(m.host.querySelector('.ld-panel h3')?.textContent).toBe('GPU gen 1, 1 kHz');
    const system = state.build.systems[0]!;
    act(() => store.replaceState({ ...state, build: { ...state.build, revision: state.build.revision + 1,
      systems: [{ ...system, spec: { ...system.spec, ram: [{ gen: 0, level: 1, ecc: false }] } }] } }));
    expect(names()).toContain('DDR');
    store.dispose();
  });
});

describe('project keys', () => {
  it('follow state: queue only with free queue slots, Data shortfall disables', () => {
    const t = { active: researchId('x'), queue: [], queueSlots: 0 };
    expect(projectKey(node('b', 'available'), t)).toEqual({ label: 'One at a time', action: null });
    expect(projectKey(node('b', 'available'), { ...t, queueSlots: 3 }).label).toBe('Queue');
    expect(projectKey(node('b', 'available', { needsData: true }), { ...t, active: null })).toEqual({ label: 'Needs Data', action: null });
    expect(projectKey(node('b', 'queued'), t).action).toEqual({ type: 'unqueueResearch', project: 'b' });
  });

  it('check exact wallet affordability for both fees without charging again on resume or unqueue', () => {
    const n = node('gpuGen9', 'available', { creditCost: '9007199254740993' as Amount });
    const t = tree([n]);
    expect(projectKey(n, t, '9007199254740992' as Amount, n.dataCost).label).toBe('Needs Credits');
    expect(projectKey(n, t, n.creditCost, '149999' as Amount).label).toBe('Needs Data');
    expect(projectKey(n, t, n.creditCost, n.dataCost).action).toEqual({ type: 'startResearch', project: n.id });
    expect(projectKey({ ...n, state: 'parked' }, t, '0' as Amount, '0' as Amount).action).toEqual({ type: 'resumeResearch' });
    expect(projectKey({ ...n, state: 'queued', needsCredits: true }, t, '0' as Amount).action).toEqual({ type: 'unqueueResearch', project: n.id });
  });
});
