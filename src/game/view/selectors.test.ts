import { researchId, systemId, rackId, roomId, siteId } from '../types/ids';
import { fixtureState } from './fixtures';
import { selectQueuePage, selectResearchTree, selectUnitLabel } from './selectors';

// Top-hardware fixtures do 600 warm-up ticks of real work under D10 (the fleet pulls continuously).
vi.setConfig({ testTimeout: 60_000 });

describe('selectors', () => {
  it('pages a scheduler queue front first', () => {
    const state = fixtureState('rack');
    const total = state.hot.sys.queueLen[0]!;
    const all = selectQueuePage(state, systemId(0), 0, 64);
    expect(all.total).toBe(total);
    expect(all.tasks).toHaveLength(total);
    const tail = selectQueuePage(state, systemId(0), 1, 64);
    expect(tail.tasks.map((t) => t.key)).toEqual(all.tasks.slice(1).map((t) => t.key));
    expect(selectQueuePage(state, systemId(0), 999, 4)).toMatchObject({ offset: total, tasks: [] });
  });

  it('names units the way the world does', () => {
    const boot = fixtureState('chipBoot');
    expect(selectUnitLabel(boot, { kind: 'system', id: systemId(0) })).toBe('System');
    const room = fixtureState('room');
    expect(selectUnitLabel(room, { kind: 'system', id: systemId(14) })).toBe('Server 3');
    expect(selectUnitLabel(room, { kind: 'rack', id: rackId(1) })).toBe('Rack 2');
    const global = fixtureState('global');
    expect(selectUnitLabel(global, { kind: 'room', id: roomId(1) })).toBe('Zone B');
    expect(selectUnitLabel(global, { kind: 'site', id: siteId(2) })).toBe('eu-west');
  });

  it('builds the research wafer with die states, horizon and lenders', () => {
    const base = fixtureState('chipBoot');
    const tree = selectResearchTree(base);
    expect(tree.nodes.length).toBeGreaterThan(0);
    expect(tree.horizon).toBe('chip');
    expect(tree.lenders).toHaveLength(1);
    expect(tree.creditsPerMinute).toBe('0');
    const roots = tree.nodes.filter((n) => n.requires.length === 0);
    expect(roots.every((n) => n.state === 'available')).toBe(true);
    const locked = tree.nodes.find((n) => n.state === 'locked')!;
    expect(locked.lockedBy).not.toBeNull();

    const root = roots[0]!;
    const active = selectResearchTree({ ...base, research: { ...base.research, active: root.id, activeProgress: root.workOps / 4 } });
    expect(active.nodes.find((n) => n.id === root.id)).toMatchObject({ state: 'active', progress: 0.25 });
    // D27: a started project waits at the queue front until a system takes it; nothing is lent yet.
    expect(active.lenders[0]!.lent).toBe(0);
    const done = selectResearchTree({ ...base, research: { ...base.research, completed: [researchId(root.id)] } });
    expect(done.nodes.find((n) => n.id === root.id)?.state).toBe('done');
  });

  it('aggregates lenders per rack once systems outnumber the gauges', () => {
    const tree = selectResearchTree(fixtureState('room'));
    expect(tree.lenders).toHaveLength(24);
    expect(tree.lenders[0]!.unit.kind).toBe('rack');
  });
});
