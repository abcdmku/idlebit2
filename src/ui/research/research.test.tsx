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
import { ResearchDrawer, ResearchList, projectKey } from './ResearchDrawer';
import { relevantProjects } from './ResearchSheet';

let m: Mounted, acts: GameAction[];
beforeEach(() => { m = mount(); acts = []; });
afterEach(() => m.unmount());

const node = (id: string, state: ResearchNodeView['state'], over: Partial<ResearchNodeView> = {}): ResearchNodeView => ({
  id: researchId(id), name: id, category: 'compute', state, progress: 0, dataCost: '150000' as Amount, workOps: 3e6, requires: [], lockedBy: null,
  level: 'system', era: 'khz', tier: 6, needsData: false, effect: '', summary: '', ...over });
const tree = (nodes: ResearchNodeView[], over: Partial<ResearchTreeView> = {}): ResearchTreeView => ({
  nodes, active: null, mode: 'shared', opsPerSec: 6400, queue: [], queueSlots: 0, horizon: 'system', lenders: [], creditsPerMinute: '9960' as Amount, ...over });

describe('relevant research (D17 review)', () => {
  it('shows at most three: the opened one, work in progress, cheapest available, then the next unlock', () => {
    const t = tree([
      node('done1', 'done'), node('a', 'available', { dataCost: '500' as Amount }), node('b', 'available', { dataCost: '100' as Amount }),
      node('p', 'active'), node('far', 'locked', { lockedBy: researchId('x') }), node('next', 'locked', { lockedBy: researchId('b') }),
    ]);
    expect(relevantProjects(t, null).map(n => n.id)).toEqual(['p', 'b', 'a']);
    expect(relevantProjects(t, researchId('next')).map(n => n.id)).toEqual(['next', 'p', 'b']);
    expect(relevantProjects(tree([node('b', 'available'), node('next', 'locked', { lockedBy: researchId('b') }), node('far', 'locked', { lockedBy: researchId('next') })]), null)
      .map(n => n.id)).toEqual(['b', 'next']);
  });
});

describe('research drawer', () => {
  it('connects the dialog to hardware discovery and keeps an explicitly opened project accessible', () => {
    const base = createInitialState(42);
    const state = { ...base, research: { ...base.research, completed: [researchId('systemBoard'), researchId('memController')],
      unlocks: { ...base.research.unlocks, levels: { ...base.research.unlocks.levels, system: true } } } };
    const store = createGameStore({ initialState: state });
    const view = createViewStore(store.getSnapshot, initialView(store.getSnapshot()));
    const layout = shellLayout(1440, 900);
    const shell = createShellValue(store, view, createLevelRegistry(), { renderer: null, layout, plateBounds: layout.calloutBounds,
      frameListeners: new Set(), buildQuotes: null, drawCount: 0 });
    view.dispatch({ type: 'openResearch' });
    m.render(<ShellContext.Provider value={shell}><LayoutContext.Provider value={layout}><ResearchDrawer /></LayoutContext.Provider></ShellContext.Provider>);
    expect(m.host.querySelector<HTMLElement>('[data-testid=research-drawer]')!.style.cssText).toContain('left: 744px');
    // the sheet shows only the relevant few; "All research" opens every contextual project
    expect(m.host.querySelectorAll('[data-project]').length).toBeLessThanOrEqual(3);
    click(button(m.host, 'All research'));
    const rows = () => [...m.host.querySelectorAll('.rl-item .rl-row b')].map(n => n.textContent);
    expect(rows()).toContain('GPU gen 1, 1 kHz');
    expect(rows()).not.toContain('GPU gen 9, 100 GHz');
    expect(rows()).not.toContain('DDR');
    expect(rows()).not.toContain('High-flow air');
    const system = state.build.systems[0]!;
    act(() => store.replaceState({ ...state, build: { ...state.build, revision: state.build.revision + 1,
      systems: [{ ...system, spec: { ...system.spec, ram: [{ gen: 0, level: 1, ecc: false }] } }] } }));
    expect(rows()).toContain('DDR');
    act(() => view.dispatch({ type: 'openResearch', project: researchId('gpuGen9') }));
    expect(m.host.querySelector('.rl-item.focus')?.textContent).toContain('GPU gen 9, 100 GHz');
    expect(m.host.querySelector('.rl-item.focus .rl-lock')?.textContent).toContain('Needs GPU gen 8, 10 GHz');
    store.dispose();
  });

  it('locked projects show a lock glyph and what they need, never ×', () => {
    const t = tree([node('pipelining', 'done'), node('fabKhz', 'locked', { name: 'kHz fab', lockedBy: researchId('systemBoard') }),
      node('systemBoard', 'available', { name: 'System board', effect: 'Opens the System view' })]);
    m.render(<ResearchList tree={t} phase="running" focusProject={null} onAction={(a) => acts.push(a)} onClose={() => undefined} />);
    const locked = m.host.querySelector('.rl-item.locked')!;
    expect(locked.querySelector('svg.lock')).not.toBeNull();
    expect(locked.textContent).toContain('Needs System board');
    expect(locked.textContent).not.toContain('×');
    expect(locked.querySelector('button')?.disabled).toBe(true);
    expect(m.host.textContent).toContain('1 of 3 done');
    const avail = m.host.querySelector('.rl-item.available')!;
    expect(avail.textContent).toContain('Opens the System view');
    expect(avail.textContent).toContain('150k Data');
    expect(avail.textContent).toContain('Work 3.00 Mops');
    click(button(avail, 'Start'));
    expect(acts).toEqual([{ type: 'startResearch', project: 'systemBoard' }]);
  });

  it('priority during a round; the whole-Credit energy cost between rounds', () => {
    const t = tree([node('a', 'active', { progress: 0.4 })], { active: researchId('a') });
    m.render(<ResearchList tree={t} phase="running" focusProject={null} onAction={(a) => acts.push(a)} onClose={() => undefined} />);
    expect(m.host.querySelector('[aria-checked="true"]')?.textContent).toBe('Shared');
    click(button(m.host, 'Focus'));
    expect(acts).toEqual([{ type: 'setResearchPriority', mode: 'focus' }]);
    m.render(<ResearchList tree={t} phase="between" focusProject={null} onAction={(a) => acts.push(a)} onClose={() => undefined} />);
    expect(m.host.querySelector('.rl-energy')?.textContent).toBe('Full speed between rounds−9,960/min');
  });

  it('keys follow state: queue only with free queue slots, Data shortfall disables', () => {
    const t = { active: researchId('x'), queue: [], queueSlots: 0 };
    expect(projectKey(node('b', 'available'), t)).toEqual({ label: 'One at a time', action: null });
    expect(projectKey(node('b', 'available'), { ...t, queueSlots: 3 }).label).toBe('Queue');
    expect(projectKey(node('b', 'available', { needsData: true }), { ...t, active: null })).toEqual({ label: 'Needs Data', action: null });
    expect(projectKey(node('b', 'queued'), t).action).toEqual({ type: 'unqueueResearch', project: 'b' });
  });

  it('shows the exact extra Credit fee and both shortfalls; Data remains the primary cost', () => {
    const n = node('gpuGen9', 'available', { creditCost: '9007199254740993' as Amount, needsCredits: true, needsData: true });
    m.render(<ResearchList tree={tree([n])} phase="between" focusProject={n.id} onAction={a => acts.push(a)} onClose={() => undefined} />);
    expect(m.host.querySelector('.rl-meta')?.textContent).toContain('150k Data');
    expect(m.host.querySelector('.rl-meta')?.textContent).toContain('9,007,199,254,740,993 Credits');
    expect(m.host.querySelector('.rl-lock')?.textContent).toContain('Needs Data. Needs Credits.');
    expect(button(m.host, 'Needs Data').disabled).toBe(true);
    click(button(m.host, 'Needs Data'));
    expect(acts).toEqual([]);
  });

  it('checks exact wallet affordability for both fees without charging again on resume or unqueue', () => {
    const n = node('gpuGen9', 'available', { creditCost: '9007199254740993' as Amount });
    const t = tree([n]);
    expect(projectKey(n, t, '9007199254740992' as Amount, n.dataCost).label).toBe('Needs Credits');
    expect(projectKey(n, t, n.creditCost, '149999' as Amount).label).toBe('Needs Data');
    expect(projectKey(n, t, n.creditCost, n.dataCost).action).toEqual({ type: 'startResearch', project: n.id });
    expect(projectKey({ ...n, state: 'parked' }, t, '0' as Amount, '0' as Amount).action).toEqual({ type: 'resumeResearch' });
    expect(projectKey({ ...n, state: 'queued', needsCredits: true }, t, '0' as Amount).action).toEqual({ type: 'unqueueResearch', project: n.id });
  });
});
