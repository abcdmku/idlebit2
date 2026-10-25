import { applyAction } from '../core/actions';
import { advanceGame } from '../core/advance';
import { G, LOC } from '../core/buffers';
import { POOL_DOMAIN } from '../core/constants';
import { barebonesSystem } from '../core/defaults';
import { allocRecord } from '../core/pool';
import { compileAll } from '../core/topology';
import { commitWorld, openWorld } from '../core/world';
import { deriveUnlocks } from '../build/research/effects';
import { researchDef } from '../build/research/tree';
import { enqueue } from '../exec/alloc';
import { noteAdmitted } from '../exec/slots';
import { FAMILIES, payoutAt } from '../market/families';
import { buildState } from '../testkit/builders';
import type { GameAction } from '../types/actions';
import { rackId, researchId, systemId } from '../types/ids';
import type { GameState } from '../types/state';
import { deserializeSave, serializeSave } from './serialize';
import { validateState } from './validate';

function act(state: GameState, action: GameAction): GameState {
  const out = applyAction(state, action);
  if (!out.ok) throw new Error(out.rejection.reason);
  return out.state;
}

function saved(state: GameState): GameState {
  const out = deserializeSave(serializeSave(state));
  if (!out.ok) throw new Error(out.error);
  expect(out.state).toEqual(state);
  return out.state;
}

/** Synthetic research/wallet setup; purchases, compilation and runtime use real game paths. */
function hardware(): GameState {
  const base = buildState({ sites: 1, zonesPerSite: 1, racksPerZone: 1, serversPerRack: 1,
    round: 'between', unlocks: 'max', credits: '1000000000000000000000000000000', data: '1000000000000',
    system: (id, rack, slot) => {
      const bare = barebonesSystem(id, rack, slot);
      return { ...bare, spec: { ...bare.spec, psu: { gen: 3, level: 1, capped: false } } };
    } });
  const completed = base.research.completed.filter((id) => id !== 'gpuLink');
  const research = { ...base.research, completed, unlocks: deriveUnlocks(completed) };
  let state: GameState = { ...base, research, compiled: compileAll(base.build, research) };
  state = act(state, { type: 'installGpu', system: systemId(0), model: '1330', index: null });
  for (let n = 0; n < 2; n++) state = act(state, {
    type: 'upgradePart', part: { unit: { kind: 'system', id: systemId(0) }, slot: { kind: 'gpu', index: 0 } },
  });
  return state;
}

function startLink(state: GameState): GameState {
  const started = act(act(state, { type: 'setResearchPriority', mode: 'shared' }),
    { type: 'startResearch', project: researchId('gpuLink') });
  // Seed a paid project one operation from completion; the next tick supplies real hardware work.
  return { ...started, research: { ...started.research, activeProgress: researchDef('gpuLink')!.work - 1 } };
}

function linkedRayTrace(): GameState {
  const running = act(hardware(), { type: 'returnToMarket' });
  const w = openWorld(running), r = allocRecord(w.hot);
  const family = FAMILIES.find((f) => f.key === 'rayTrace')!, scale = 2000;
  w.hot.rec.family[r] = family.id; w.hot.rec.count[r] = 1; w.hot.rec.scale[r] = scale;
  w.hot.rec.threads[r] = family.threads;
  w.hot.rec.taskId[r] = w.hot.g[G.nextTaskId]!; w.hot.g[G.nextTaskId] = w.hot.g[G.nextTaskId]! + 1;
  w.hot.rec.payout[r] = payoutAt(family, scale);
  enqueue(w, 0, r); noteAdmitted(w, 0, 1);
  const active = advanceGame(commitWorld(running, w, 0), 100).state;
  expect(active.hot.rec.loc[r]).toBe(LOC.running);
  expect(active.hot.rec.start[r]).toBe(0);
  const linked = advanceGame(startLink(active), 100).state;
  expect(linked.research.completed).toContain('gpuLink');
  expect(linked.hot.rec.accelDomain[r]).toBe(POOL_DOMAIN);
  expect(linked.hot.rec.start[r]).toBeLessThan(0);
  expect(linked.hot.rec.finish[r]).toBeGreaterThan(0);
  return linked;
}

function removedServer(): GameState {
  let state = advanceGame(startLink(hardware()), 100).state;
  expect(state.research.completed).toContain('gpuLink');
  state = act(state, { type: 'addUnit', parent: { kind: 'rack', id: rackId(0) }, slot: 1,
    source: { kind: 'barebones', tier: 0 } });
  expect(state.compiled.sys.gpuLinked[1]).toBe(1);
  state = act(state, { type: 'removeUnit', unit: { kind: 'system', id: systemId(1) } });
  expect(state.build.systems[1]).toBeNull();
  expect(state.compiled.sys.alive[1]).toBe(0);
  expect(state.compiled.sys.gpuLinked[1]).toBe(0);
  return state;
}

describe('GPU action save regressions', () => {
  it('preserves negative rebased starts and exact continuation after GPU-link research', () => {
    const state = linkedRayTrace();
    const whole = advanceGame(state, 3007).state;
    let split = saved(state);
    for (const ms of [1, 99, 37, 263, 5, 701, 2, 99, 500, 1300]) split = saved(advanceGame(split, ms).state);
    expect(split).toEqual(whole);
    expect(whole.hot.g[G.met]).toBeGreaterThan(state.hot.g[G.met]!);
  });

  it('round-trips a scrapped server after GPU-link research and continues exactly', () => {
    const state = removedServer();
    expect(advanceGame(saved(state), 1307).state).toEqual(advanceGame(state, 1307).state);
  });

  it.each([
    ['nonfinite start', (s: GameState) => { s.hot.rec.start[0] = -Infinity; }, /stage work positions/],
    ['NaN start', (s: GameState) => { s.hot.rec.start[0] = NaN; }, /stage work positions/],
    ['negative finish', (s: GameState) => { s.hot.rec.finish[0] = -1; }, /stage work positions/],
    ['reversed work', (s: GameState) => { s.hot.rec.start[0] = s.hot.rec.finish[0]! + 1; }, /stage work positions/],
    ['live link mismatch', (s: GameState) => { s.compiled.sys.gpuLinked[0] = 0; }, /gpuLinked/],
  ] as const)('still rejects %s after rebasing', (_label, corrupt, pattern) => {
    const state = linkedRayTrace();
    corrupt(state);
    const result = validateState(state);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(pattern);
  });

  it.each([
    ['link flag', (s: GameState) => { s.compiled.sys.gpuLinked[1] = 1; }, /gpuLinked/],
    ['physical stat', (s: GameState) => { s.compiled.sys.accelOps[8] = 1; }, /physical stat/],
    ['empty-card duty', (s: GameState) => { s.hot.sys.accelTaskS[8] = 0.1; }, /duty/],
  ] as const)('still rejects tombstoned %s', (_label, corrupt, pattern) => {
    const state = removedServer();
    corrupt(state);
    const result = validateState(state);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(pattern);
  });
});
