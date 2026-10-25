// Test-only: a GameStore over a mutable RenderSnapshot (a real derived snapshot, then edited),
// and a renderer for shell components inside the shell context.
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { vi } from 'vitest';
import { amount } from '../../game/amount';
import { createInitialState, familyId, systemId } from '../../game';
import type { ActionOutcome, GameAction, GameState, NodeRef, QueueEntryView, RenderSnapshot, RoundReport, TaskRequirementsView } from '../../game';
import { LEVEL_FIXTURES } from '../../game/fixtures';
import type { GameStore } from '../../platform';
import { createLevelRegistry } from '../../render/core';
import { shellLayout } from '../layout';
import { LayoutContext } from '../shell/geometry';
import { ShellContext, createShellValue, type ShellContextValue } from '../storeHooks';
import { createViewStore, initialView } from '../viewState';

type Mutable<T> = { -readonly [K in keyof T]: T[K] };
export type SnapshotEdit = { [K in keyof RenderSnapshot]?: Partial<RenderSnapshot[K]> };

/** A boot-like snapshot, hand-built against the contract so UI tests don't depend on sim work in progress. */
export function baseSnapshot(): RenderSnapshot {
  const chip: NodeRef = { level: 'chip', id: systemId(0) }, system: NodeRef = { level: 'system', id: systemId(0) };
  return {
    epoch: 1, tick: 0, simTimeMs: 0, bootMs: 10_000,
    hud: { credits: amount(0), data: amount(0), netPerMinute: amount(0), sla: { met: 0, failed: 0, percent: 100, checking: false, window: 50, roundMet: 0, roundFailed: 0, deliveredWork: 0, failedWork: 0, grace: 10 },
      roundState: 'running', roundIndex: 1, roundElapsedMs: 0, autoReturnInMs: null, income: { dataPerSec: 0, creditsPerSec: 0 } },
    feed: { roundIndex: 1, timing: 'running', window: Array.from({ length: 5 }, (_, i) => entry(i + 1)), research: null,
      headDeadlineTick: 99, blockedBy: null, transfers: [], inTransfer: 0, queued: 0, running: 0, taken: 0, dismissed: 0,
      intensity: 1, takesPerSec: 0, recentOutcomes: [], liveFailures: null, rates: { met: 0, fail: 0 }, failBin: null },
    round: { index: 1, state: 'running', lastReport: null, canReturn: false, autoReturn: { available: false, on: false, inMs: null } },
    research: { active: null, name: null, progress: 0, stoppedInsolvent: false, needsData: false, queued: 0, opsPerSec: 0 },
    unlocked: { chip: true, system: false, rack: false, room: false, global: false },
    home: { chip, system },
    focus: { ...LEVEL_FIXTURES.chip, parent: system },
    partner: null, events: [], firstSeq: 0, lastSeq: 0, completions: [], failures: [], shardsDone: [],
  };
}
/** Shallow-merge each top-level section. */
export function editSnapshot(s: RenderSnapshot, edit: SnapshotEdit): RenderSnapshot {
  const out = { ...s } as Mutable<RenderSnapshot> & Record<string, unknown>;
  for (const [key, value] of Object.entries(edit)) {
    const current = (s as unknown as Record<string, unknown>)[key];
    out[key] = value && typeof value === 'object' && !Array.isArray(value) && current && typeof current === 'object'
      ? { ...current, ...value } : value;
  }
  return out;
}

export interface FakeStore extends GameStore {
  set(edit: SnapshotEdit): void;
  readonly actions: GameAction[];
}
export function fakeStore(initial: RenderSnapshot = baseSnapshot()): FakeStore {
  let snapshot = initial;
  let state: GameState | null = null;
  const listeners = new Set<() => void>(), actions: GameAction[] = [];
  let scope = { focus: snapshot.home.chip!, partner: null } as ReturnType<GameStore['getScope']>;
  const notify = () => { for (const l of [...listeners]) l(); };
  return {
    actions,
    set(edit) { snapshot = editSnapshot(snapshot, edit); notify(); },
    getState: () => (state ??= createInitialState(1)),
    getSnapshot: () => snapshot,
    getScope: () => scope,
    setScope(next) { scope = next; },
    getLifecycle: () => ({ hydrated: true, catchingUp: false, saveDriver: 'memory' }),
    getCatchUp: () => null,
    getOfflineReport: () => null,
    dismissOfflineReport() {},
    getNotice: () => null,
    /** Records the action; returns null ("queued") so tests never need a live sim state. */
    dispatch(action): ActionOutcome | null { actions.push(action); return null; },
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}

/** A shell at a viewport size: phone (390 × 780) unless given. */
export function shellFor(store: GameStore, width = 390, height = 780): ShellContextValue {
  const view = createViewStore(store.getSnapshot, initialView(store.getSnapshot()));
  const layout = shellLayout(width, height);
  return createShellValue(store, view, createLevelRegistry(), {
    renderer: null, layout, plateBounds: { ...layout.calloutBounds }, frameListeners: new Set(), buildQuotes: null, drawCount: 0,
  });
}

export interface Mounted { host: HTMLDivElement; root: Root; shell: ShellContextValue; frame(timeMs: number): void; unmount(): void }
export function mount(node: ReactNode, store: GameStore, size?: { width: number; height: number }): Mounted {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host), shell = shellFor(store, size?.width, size?.height);
  act(() => root.render(<ShellContext.Provider value={shell}><LayoutContext.Provider value={shell.surface.layout}>{node}</LayoutContext.Provider></ShellContext.Provider>));
  return {
    host, root, shell,
    frame(timeMs) { act(() => { for (const l of shell.surface.frameListeners) l(timeMs, timeMs / 1000); }); },
    unmount() { act(() => root.unmount()); host.remove(); },
  };
}

export function entry(key: number, family = 0, committed = false): QueueEntryView {
  return { ...taskFacts(family), kind: 'task', key, task: { epoch: 1, roundIndex: 1, taskId: key },
    committed, dismissible: !committed, blockedBy: null, icons: ['compute'], work: 1, transferS: 0.001, windowEndTick: null };
}

function taskFacts(family = 0): TaskRequirementsView {
  return { family: familyId(family), label: `Family ${family}`, stages: [{ resource: 'compute', work: 1 }], grain: 1, size: 1,
    workingSetBits: 1, gpuCoresMin: 0, vramBits: 0, members: 1, deadline: null, minZones: 1, region: null, ecc: false, tensor: false };
}

export function report(edit: Partial<RoundReport> = {}): RoundReport {
  return {
    index: 14, startTick: 0, endedBy: 'sla', durationTicks: 8450, durationMs: 845_000, met: 28_400,
    failedByCause: { timeout: 2839, cantRun: 387, misroute: 3903, power: 0, heat: 0, swap: 0, late: 0 },
    failDetail: { timeout: null, cantRun: 'ram', misroute: null, power: null, heat: null, swap: null, late: null },
    details: [{ cause: 'cantRun', detail: 'ram', count: 387 }],
    peakIntensity: 4.12, dismissed: 0, deliveredWork: 28_400, failedWork: 7_129, gross: amount(2_710_000), data: amount(30_100), energy: amount(0), net: amount(2_710_000), researchOps: 0, byType: [], spill: { ramWork: 0, diskWork: 0 },
    energyBreakdown: { billed: amount(0), fromBattery: amount(0), batteryRefill: amount(0), fromGeneration: amount(0), fuel: amount(0) },
    ...edit,
  };
}
