import { RESEARCH, researchDef } from '../build/research/tree';
import { deriveUnlocks, openContainers } from '../build/research/effects';
import { createInitialState } from '../core/state';
import type { SystemSpec } from '../types/build';
import { researchId, type ResearchId } from '../types/ids';
import type { GameState } from '../types/state';
import { selectContextualResearchTree, selectResearchTree } from './selectors';

function completed(state: GameState, ...projects: string[]): GameState {
  const ids = new Set(state.research.completed);
  const add = (id: ResearchId) => {
    for (const prerequisite of researchDef(id)?.requires ?? []) add(prerequisite);
    ids.add(id);
  };
  for (const id of projects) add(researchId(id));
  const unlocks = deriveUnlocks([...ids]);
  return { ...state, research: { ...state.research, completed: [...ids], unlocks }, build: openContainers(state.build, unlocks) };
}

function installed(state: GameState, spec: Partial<SystemSpec>): GameState {
  const system = state.build.systems[0]!;
  return { ...state, build: { ...state.build, revision: state.build.revision + 1,
    systems: [{ ...system, spec: { ...system.spec, ...spec } }] } };
}

const pending = (state: GameState) => selectContextualResearchTree(state).nodes.filter(n => n.state !== 'done');
const ids = (state: GameState) => pending(state).map(n => n.id);

describe('contextual research discovery', () => {
  it('starts with CPU projects and the System frontier, with real prerequisite names', () => {
    const state = createInitialState(42), tree = selectContextualResearchTree(state);
    expect(ids(state)).toEqual(expect.arrayContaining(['fifoSched', 'cstateC1', 'dualCore', 'l2Cache', 'systemBoard']));
    expect(pending(state).every(n => n.level === 'chip' || n.id === 'systemBoard')).toBe(true);
    expect(pending(state).some(n => ['accel', 'storage', 'network', 'cooling'].includes(n.category))).toBe(false);
    for (const id of ['rack', 'room', 'dataCenter', 'fabMhz']) expect(ids(state)).not.toContain(id);
    const next = tree.nodes.find(n => n.id === 'systemBoard')!;
    expect(next).toMatchObject({ state: 'locked', lockedBy: 'dualCore' });
    expect(tree.nodes.find(n => n.id === next.lockedBy)?.name).toBe('Multi-core');
    for (const node of tree.nodes) for (const id of node.requires) expect(tree.nodes.some(n => n.id === id)).toBe(true);
  });

  it('reveals board starter hardware and only the next structural scope', () => {
    const state = completed(createInitialState(42), 'systemBoard');
    expect(ids(state)).toEqual(expect.arrayContaining(['gpuGen1', 'storageCtl', 'rack']));
    expect(ids(state)).not.toContain('gpuGen2');
    expect(ids(state)).not.toContain('ddr');
    expect(ids(state)).not.toContain('ssd');
    expect(ids(state)).not.toContain('dma');
    expect(pending(state).some(n => n.category === 'cooling' || n.category === 'network')).toBe(false);
    const rack = completed(state, 'rack');
    expect(ids(rack)).toEqual(expect.arrayContaining(['room', 'lbCapability', 'sw100k', 'rackAir2']));
    expect(ids(rack)).not.toContain('dataCenter');
    expect(ids(rack)).not.toContain('hotColdAisle');
    const room = completed(rack, 'room');
    expect(ids(room)).toEqual(expect.arrayContaining(['dataCenter', 'hotColdAisle', 'roomAir2']));
    expect(ids(room)).not.toContain('regions');
  });

  it('uses installed RAM, GPU and storage for capabilities and the next generation', () => {
    let state = completed(createInitialState(42), 'gpuGen1', 'storageCtl');
    state = installed(state, { ram: [{ gen: 0, level: 1, ecc: false }],
      accels: [{ kind: 'gpu', model: '1330', upgrades: 0 }], drives: [{ gen: 0, level: 1 }] });
    expect(ids(state)).toEqual(expect.arrayContaining(['ddr', 'dualChannel', 'dma', 'gpuGen2', 'ssd', 'raid0']));
    for (const id of ['ddr2', 'ddr3', 'gpuGen3', 'gpuGen9', 'tensorCores', 'nvme', 'scm']) expect(ids(state)).not.toContain(id);
    // Researching a generation does not pretend that it is installed.
    const unlocked = completed(state, 'ddr', 'gpuGen2', 'ssd');
    for (const id of ['ddr2', 'gpuGen3', 'nvme']) expect(ids(unlocked)).not.toContain(id);
    const upgraded = installed(unlocked, { ram: [{ gen: 1, level: 1, ecc: false }],
      accels: [{ kind: 'gpu', model: '2330', upgrades: 0 }], drives: [{ gen: 1, level: 1 }] });
    expect(ids(upgraded)).toEqual(expect.arrayContaining(['ddr2', 'gpuGen3', 'gddr6', 'nvme', 'ncq']));
    // Tensor research grants a legacy NPU row too, but does not require an installed NPU.
    const tensor = installed(completed(state, 'gpuGen4'), { accels: [{ kind: 'gpu', model: '4330', upgrades: 0 }] });
    expect(ids(tensor)).toContain('tensorCores');
  });

  it('retains active, queued, parked and explicitly focused projects with their prerequisites', () => {
    const base = createInitialState(42);
    const state: GameState = { ...base, research: { ...base.research, active: researchId('gpuGen9'),
      activeProgress: 5, queue: [researchId('closedLoop2')], parked: { bbSubsea: 10 } } };
    const tree = selectContextualResearchTree(state, researchId('checkpointing'));
    expect(tree.nodes.find(n => n.id === 'gpuGen9')).toMatchObject({ state: 'active' });
    expect(tree.nodes.find(n => n.id === 'closedLoop2')).toMatchObject({ state: 'queued' });
    expect(tree.nodes.find(n => n.id === 'bbSubsea')).toMatchObject({ state: 'parked' });
    expect(tree.nodes.some(n => n.id === 'checkpointing')).toBe(true);
    for (const node of tree.nodes) for (const id of node.requires) expect(tree.nodes.some(n => n.id === id)).toBe(true);
  });

  it('leaves the full selector complete for GPU generation and prerequisite lookup', () => {
    const state = createInitialState(42), before = selectResearchTree(state);
    selectContextualResearchTree(state);
    expect(selectResearchTree(state)).toEqual(before);
    expect(before.nodes.map(n => n.id)).toEqual(RESEARCH.filter(n => n.implemented).map(n => n.id));
    expect(before.nodes.find(n => n.id === 'gpuGen9')?.requires).toEqual(['gpuGen8', 'intercontinental']);
  });
});
