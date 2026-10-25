import { advanceGame, advanceGameOwned, copyGameState } from '../core/advance';
import { deserializeSave, serializeSave } from '../save/serialize';
import { quote } from '../build/quotes';
import { FLEETS } from '../testkit/fleets';
import { gpuLoadedState } from '../testkit/gpuLoaded';
import { rackId, roomId, systemId, type NodeRef } from '../types/ids';
import type { RenderSnapshot, SnapshotScope } from '../types/snapshot';
import type { GameState } from '../types/state';
import { selectContextualResearchTree, selectQueuePage, selectResearchTree, selectSavedConfigs, selectUnitLabel } from './selectors';
import { deriveRenderSnapshot } from './snapshot';

/** Every object and ArrayBuffer reachable from `root`. */
function reachable(root: unknown): { objects: Set<object>; buffers: Set<ArrayBufferLike> } {
  const objects = new Set<object>(), buffers = new Set<ArrayBufferLike>(), stack = [root];
  while (stack.length) {
    const value = stack.pop();
    if (typeof value !== 'object' || value === null || objects.has(value)) continue;
    objects.add(value);
    if (ArrayBuffer.isView(value)) { buffers.add(value.buffer); continue; }
    stack.push(...(value instanceof Map || value instanceof Set ? [...value.entries()] : Object.values(value)));
  }
  return { objects, buffers };
}

/** A deep copy in this realm (the test environment's structuredClone returns foreign typed arrays). */
function deepCopy<T>(value: T): T {
  if (typeof value !== 'object' || value === null) return value;
  if (ArrayBuffer.isView(value)) return (value as unknown as Uint8Array).slice() as T;
  if (value instanceof Map) return new Map([...value].map(([k, v]) => [k, deepCopy(v)])) as T;
  if (value instanceof Set) return new Set([...value].map(deepCopy)) as T;
  if (Array.isArray(value)) return value.map(deepCopy) as T;
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, deepCopy(v)])) as T;
}

/** No published object is a hot table or shares a hot typed array's memory. */
function expectNoHotAlias(state: GameState, published: unknown): void {
  const hot = reachable(state.hot), out = reachable(published);
  for (const object of out.objects) expect(hot.objects.has(object)).toBe(false);
  for (const buffer of out.buffers) expect(hot.buffers.has(buffer)).toBe(false);
}

const ref = (level: NodeRef['level']): NodeRef =>
  level === 'chip' || level === 'system' ? { level, id: systemId(0) }
    : level === 'rack' ? { level, id: rackId(0) } : level === 'room' ? { level, id: roomId(0) } : { level, id: 0 };
const SCOPES: readonly SnapshotScope[] = [
  ...(['chip', 'system', 'rack', 'room', 'global'] as const).map((level) => ({ focus: ref(level), partner: null })),
  { focus: ref('rack'), partner: ref('room') },
];
const FIXTURES: Record<string, () => GameState> = {
  boot: () => advanceGame(FLEETS.boot(), 3_000).state,
  rackFull: () => advanceGame(FLEETS.rackFull(), 3_000).state,
  roomFull: () => advanceGame(FLEETS.roomFull(), 3_000).state,
  gpu: () => advanceGame(gpuLoadedState(), 3_000).state,
};

describe('published views never alias live hot buffers (decisions D9)', () => {
  it.each(Object.keys(FIXTURES))('snapshots, selectors, quotes and saves own their data (%s)', (name) => {
    let state = FIXTURES[name]!();
    let previous: RenderSnapshot | undefined;
    const published: { snapshot: RenderSnapshot; frozen: RenderSnapshot }[] = [];
    for (const scope of SCOPES) {
      // Chained like the store: the previous snapshot feeds the next.
      for (let frame = 0; frame < 3; frame += 1) {
        previous = deriveRenderSnapshot(state, scope, previous);
        published.push({ snapshot: previous, frozen: deepCopy(previous) });
        expectNoHotAlias(state, previous);
        state = advanceGameOwned(state, 50).state;
      }
    }
    const views = {
      tree: selectResearchTree(state), context: selectContextualResearchTree(state),
      configs: selectSavedConfigs(state, 'system'), queue: selectQueuePage(state, systemId(0), 0, 50),
      label: selectUnitLabel(state, { kind: 'system', id: systemId(0) }),
      quotes: SCOPES.map((scope) => quote(state, { kind: 'tray', at: scope.focus })),
      loaded: deserializeSave(serializeSave(state)),
    };
    expectNoHotAlias(state, views);
    const frozenViews = deepCopy(views);

    state = advanceGameOwned(state, 5_000).state;
    for (const { snapshot, frozen } of published) expect(snapshot).toEqual(frozen);
    expect(views).toEqual(frozenViews);
  // roomFull advances 288 servers 8 s and snapshots every scope: allow parallel-suite contention.
  }, 30_000);

  it('rebuilds a level after an owned advance that ticked, as from a pure advance', () => {
    const start = FIXTURES.rackFull!(), scope = SCOPES[2]!;
    const first = deriveRenderSnapshot(start, scope);
    const pure = deriveRenderSnapshot(advanceGame(start, 1_000).state, scope, first);
    const owned = deriveRenderSnapshot(advanceGameOwned(copyGameState(start), 1_000).state, scope, first);
    // New completions have session-unique cosmetic IDs, even on independent pure/owned branches.
    const payload = (s: RenderSnapshot) => ({ ...s,
      completions: s.completions.map(({ seq: _seq, ...c }) => c),
      failures: s.failures.map(({ seq: _seq, ...f }) => f),
      shardsDone: s.shardsDone.map(({ seq: _seq, ...d }) => d),
    });
    expect(payload(owned)).toEqual(payload(pure));
    expect(owned.focus).not.toBe(first.focus);
  });
});
