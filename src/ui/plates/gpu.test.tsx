import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createInitialState, FAMILIES, quote, researchId, selectResearchTree, systemId, type Amount, type GameState, type GpuModelId, type PartView, type TaskView } from '../../game';
import { fixtureScope, fixtureState } from '../../game/fixtures';
import { createGameStore, type RuntimeStore } from '../../platform';
import type { HitTarget } from '../../render/core';
import { entry, mount, type Mounted } from '../hooks/testShell';
import { GpuPlate } from './GpuPlate';
import { PlateLayer } from './PlateLayer';
import { button, click } from './testkit';
import { exactAmount } from './gpuModel';
import { span, watts } from './format';

const sys = systemId(0), A = (v: string) => v as Amount;
let mounted: Mounted | undefined, store: RuntimeStore;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});
afterEach(() => { mounted?.unmount(); mounted = undefined; store?.dispose(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function setup(state = fixtureState('systemTop', 'between')) {
  store = createGameStore({ initialState: { ...state, wallet: { ...state.wallet, credits: A('100000000000000000000000'), data: A('100000000000000000000000') } },
    scope: fixtureScope('systemTop') });
  store.setLifecycle({ hydrated: true });
}
/** D39: an occupied slot only offers strictly better cards; the fixture's maxed 9990 has none, so most tests start from 1330. */
function withCard(state: GameState, model = '1330' as GpuModelId): GameState {
  const system = state.build.systems[0]!;
  const accels = system.spec.accels.map((card, i) => i === 0 ? { kind: 'gpu' as const, model, upgrades: 0 } : card);
  return { ...state, build: { ...state.build, revision: state.build.revision + 1, systems: [{ ...system, spec: { ...system.spec, accels } }, ...state.build.systems.slice(1)] } };
}
const lowCard = () => withCard(fixtureState('systemTop', 'between'));
function installed(): PartView | undefined {
  const s = store.getSnapshot().focus;
  return s.level === 'system' ? s.gpu[0] : undefined;
}
function picker(index: number | null = 0) {
  mounted = mount(<GpuPlate system={sys} index={index} installed={index === null ? undefined : installed()}
    bounds={{ x: 8, y: 146, w: 374, h: 476 }} onAction={a => store.dispatch(a)} onClose={() => undefined} />, store);
  return mounted.host;
}
function chooseGeneration(host: HTMLElement, generation: number) {
  act(() => { const select = host.querySelector('select')!; select.value = String(generation); select.dispatchEvent(new Event('change', { bubbles: true })); });
}
function target(id: string, index: number, occupied = false): HitTarget {
  return { id, kind: occupied ? 'part' : 'slot', owner: { level: 'system', id: sys }, unit: { kind: 'system', id: sys }, slot: index,
    part: occupied ? { unit: { kind: 'system', id: sys }, slot: { kind: 'gpu', index } } : null,
    rect: { x: 0, y: 0, w: 20, h: 20 }, drill: null, sw: null, port: null };
}

describe('native GPU model picker', () => {
  it('labels assigned families with the type icon and colour, keeping the family text neutral', () => {
    setup();
    const family = FAMILIES.find(f => f.key === 'inference')!;
    const task: TaskView = { ...entry(1, family.id), accelDomain: 0, count: 1, stage: 0, resource: 'gpu', progress: 0.5, taskId: 1, shard: 0, shards: 1, units: 1, threads: 0, placement: { cache: 0, ram: 0, disk: 0 }, memTier: null, windowEndTick: null };
    mounted = mount(<GpuPlate system={sys} index={0} installed={installed()} tasks={[task]}
      onAction={a => store.dispatch(a)} onClose={() => undefined} />, store);
    const row = mounted.host.querySelector<HTMLElement>('.gpu-tasks li')!;
    const label = row.querySelector<HTMLElement>('[data-task-type=accel]')!;
    expect(label.textContent).toBe('Accelerated');
    expect(label.style.color).toBe('rgb(194, 224, 90)');
    const icon = label.querySelector('canvas')!;
    expect([icon.width, icon.height, icon.style.width, icon.style.height]).toEqual([32, 32, '32px', '32px']);
    expect(row.querySelector<HTMLElement>('.gpu-task-family')!.textContent).toBe(family.name);
    expect(row.querySelector<HTMLElement>('.gpu-task-family')!.style.color).toBe('');
  });
  it('keeps nine classes, four series and six tiers; selects one quoted model', () => {
    setup(lowCard()); const host = picker();
    expect(host.querySelectorAll('select option')).toHaveLength(9);
    expect(host.querySelectorAll('.gpu-series button')).toHaveLength(4);
    expect(host.querySelectorAll('.gpu-tiers button')).toHaveLength(6);
    chooseGeneration(host, 3);
    click(host.querySelector('[aria-label="Series 5, VRAM"]'));
    click(host.querySelector('[aria-label="Tier 50"]'));
    const selected = quote(store.getState(), { kind: 'gpuModels', system: sys, index: 0, generation: 3 }).quotes.find(q => q.gpu?.after.model === '3550')!;
    expect(host.querySelectorAll('.gpu-series [aria-pressed=true]')).toHaveLength(1);
    expect(host.querySelectorAll('.gpu-tiers [aria-pressed=true]')).toHaveLength(1);
    expect(host.querySelector('.gpu-model')?.textContent).toContain('3550');
    expect(host.querySelector('.gpu-buy')?.textContent).toContain(exactAmount(selected.cost));
    expect(host.querySelector('.gpu-comparison tbody tr')?.textContent).toContain(selected.gpu!.after.cores.toLocaleString('en-US'));
    expect(host.querySelector('.gpu-comparison thead')?.textContent).toContain(installed()!.gpu!.model);
    expect(host.querySelector('.gpu-picker')?.getAttribute('style')).toContain('--plate-safe-height: 468px');
    expect(host.querySelector('.gpu-picker')?.getAttribute('style')).toContain('--plate-safe-width: 374px');
  });

  it('installs exactly the selected model and debits the public quote, leaving the CPU intact', () => {
    setup(lowCard()); const host = picker();
    chooseGeneration(host, 3); click(host.querySelector('[aria-label="Series 3, Cores"]')); click(host.querySelector('[aria-label="Tier 50"]'));
    const before = store.getState(), expected = quote(before, { kind: 'gpuModels', system: sys, index: 0, generation: 3 }).quotes.find(q => q.gpu?.after.model === '3350')!;
    click(host.querySelector('.gpu-buy'));
    expect(store.getState().build.systems[0]!.spec.accels[0]).toEqual({ kind: 'gpu', model: '3350', upgrades: 0 });
    expect(store.getState().wallet.credits).toBe(String(BigInt(before.wallet.credits) - BigInt(expected.cost)));
    expect(store.getState().build.systems[0]!.spec.cpu).toBe(before.build.systems[0]!.spec.cpu);
  });

  it('opens on the first offered model, and a model that is no better reads "Not an upgrade"', () => {
    setup(withCard(fixtureState('systemTop', 'between'), '3550' as GpuModelId)); const host = picker();
    const offered = [1, 2, 3, 4, 5, 6, 7, 8, 9].flatMap(generation => quote(store.getState(), { kind: 'gpuModels', system: sys, index: 0, generation: generation as never }).quotes);
    expect(offered.some(q => q.gpu?.after.model === '3550')).toBe(false);
    const first = [3, 4, 5, 6, 7, 8, 9, 1, 2].flatMap(generation => quote(store.getState(), { kind: 'gpuModels', system: sys, index: 0, generation: generation as never }).quotes).find(q => !q.locked)!;
    expect(host.querySelector('.gpu-model b')?.textContent).toContain(first.gpu!.after.model);
    expect(host.querySelector<HTMLButtonElement>('.gpu-buy')!.disabled).toBe(false);
    chooseGeneration(host, 3); click(host.querySelector('[aria-label="Series 5, VRAM"]')); click(host.querySelector('[aria-label="Tier 50"]'));
    expect(host.querySelector('.gpu-model b')?.textContent).toContain('3550');
    expect(host.querySelector('.gpu-quote .gpu-note')?.textContent).toBe('Not an upgrade');
    expect(host.querySelector<HTMLButtonElement>('.gpu-buy')!.disabled).toBe(true);
  });

  it('says the card is the best available and shows no Replace key when nothing is better', () => {
    setup(); const host = picker();
    expect(host.querySelector('.gpu-quote .gpu-note')?.textContent).toBe('Your card is the best available');
    expect(host.querySelector('.gpu-buy')).toBeNull();
    expect(host.querySelector('.gpu-comparison thead')?.textContent).toContain(installed()!.gpu!.model);
  });

  it('previews locked generations without buying, and opens the real missing research', () => {
    setup(createInitialState(42));
    const opened = vi.fn();
    mounted = mount(<GpuPlate system={sys} index={null} onAction={a => store.dispatch(a)} onResearch={opened} onClose={() => undefined} />, store);
    chooseGeneration(mounted.host, 9);
    const q = quote(store.getState(), { kind: 'gpuModels', system: sys, index: null, generation: 9 }).quotes[0]!;
    const credits = store.getState().wallet.credits;
    expect(mounted.host.querySelector<HTMLButtonElement>('.gpu-buy')!.disabled).toBe(true);
    expect(mounted.host.querySelector('.gpu-model')?.textContent).toContain('9330');
    click(mounted.host.querySelector('.gpu-buy'));
    click(button(mounted.host, 'Open required research'));
    expect(opened).toHaveBeenCalledWith(q.locked!.node);
    expect(store.getState().wallet.credits).toBe(credits);
    expect(store.getState().build.systems[0]!.spec.accels).toHaveLength(0);
  });

  it('shows real cold downtime and applies a hot upgrade at its quoted price', () => {
    const base = lowCard();
    setup({ ...base, research: { ...base.research, unlocks: { ...base.research.unlocks, rules: base.research.unlocks.rules.filter(r => r !== 'hotSwap') } } });
    store.dispatch({ type: 'returnToMarket' });
    const install = quote(store.getState(), { kind: 'gpuModels', system: sys, index: 0, generation: 3 }).quotes[0]!;
    store.dispatch(install.action);
    const host = picker();
    const upgrade = quote(store.getState(), { kind: 'part', part: { unit: { kind: 'system', id: sys }, slot: { kind: 'gpu', index: 0 } } }).quotes.find(q => q.action.type === 'upgradePart')!;
    const replacement = quote(store.getState(), { kind: 'gpuModels', system: sys, index: 0, generation: 3 }).quotes[0]!;
    expect(replacement.downtimeMs).toBeGreaterThan(0);
    expect(host.textContent).toContain(`${span(replacement.downtimeMs / 1000)} offline`);
    expect(host.textContent).toContain('Instant. Running work stays.');
    expect(upgrade.gpuPower).toBeDefined();
    const hotRows = host.querySelectorAll('.gpu-hot-power tbody tr');
    expect(hotRows[0]?.children[2]?.textContent).toBe(watts(upgrade.gpuPower!.after.deliveredW));
    expect(hotRows[1]?.children[2]?.textContent).toBe(watts(upgrade.gpuPower!.after.capacityW));
    expect(hotRows[2]?.children[2]?.textContent).toBe(watts(upgrade.gpuPower!.after.headroomW));
    expect(hotRows[3]?.children[2]?.textContent).toBe(watts(upgrade.gpuPower!.after.lossW));
    expect(hotRows[4]?.children[2]?.textContent).toBe(watts(upgrade.gpuPower!.after.inputW));
    const before = store.getState(), running = before.hot.sys.running.slice();
    click(host.querySelector('.gpu-alternatives .ghost'));
    expect(store.getState().wallet.credits).toBe(String(BigInt(before.wallet.credits) - BigInt(upgrade.cost)));
    expect(store.getState().build.systems[0]!.spec.accels[0]).toMatchObject({ upgrades: 1 });
    expect(store.getState().hot.sys.running).toEqual(running);
  });

  it('shows both research costs and starts next-generation research with both exact debits', () => {
    const base = fixtureState('systemTop', 'between');
    const state: GameState = { ...base, research: { ...base.research, active: null, queue: [], parked: {},
      completed: base.research.completed.filter(id => id !== 'gpuGen9') } };
    setup(state);
    const next = selectResearchTree(store.getState()).nodes.find(n => n.id === 'gpuGen9')!;
    expect(next.state).toBe('available');
    const host = picker(), before = store.getState();
    expect(host.querySelector('.gpu-research-price')?.textContent).toContain(exactAmount(next.creditCost!));
    expect(host.querySelector('.gpu-research-price')?.textContent).toContain(exactAmount(next.dataCost));
    click(button(host, 'Start ·'));
    expect(store.getState().research.active).toBe(researchId('gpuGen9'));
    expect(store.getState().wallet.credits).toBe(String(BigInt(before.wallet.credits) - BigInt(next.creditCost!)));
    expect(store.getState().wallet.data).toBe(String(BigInt(before.wallet.data) - BigInt(next.dataCost)));
  });

  it('disables a quoted model one exact Credit below its price', () => {
    setup(lowCard());
    const q = quote(store.getState(), { kind: 'gpuModels', system: sys, index: 0, generation: 9 }).quotes.find(q => q.gpu?.after.model === '9990')!;
    expect(BigInt(q.cost)).toBeGreaterThan(BigInt(Number.MAX_SAFE_INTEGER));
    const state = store.getState();
    store.replaceState({ ...state, wallet: { ...state.wallet, credits: A(String(BigInt(q.cost) - 1n)) } });
    const host = picker(), before = store.getState().wallet.credits;
    chooseGeneration(host, 9); click(host.querySelector('[aria-label="Series 9, All"]')); click(host.querySelector('[aria-label="Tier 90"]'));
    expect(host.querySelector<HTMLButtonElement>('.gpu-buy')!.disabled).toBe(true);
    expect(host.querySelector('.gpu-quote')?.textContent).toContain('Needs more Credits');
    click(host.querySelector('.gpu-buy'));
    expect(store.getState().wallet.credits).toBe(before);
  });

  it('refreshes quoted downtime when a round starts without a wallet change', () => {
    const base = lowCard();
    setup({ ...base, research: { ...base.research, unlocks: { ...base.research.unlocks, rules: base.research.unlocks.rules.filter(r => r !== 'hotSwap') } } });
    const host = picker(), credits = store.getState().wallet.credits;
    chooseGeneration(host, 9); click(host.querySelector('[aria-label="Series 9, All"]')); click(host.querySelector('[aria-label="Tier 90"]'));
    expect(host.textContent).toContain('No downtime between rounds.');
    act(() => { store.dispatch({ type: 'returnToMarket' }); });
    const q = quote(store.getState(), { kind: 'gpuModels', system: sys, index: 0, generation: 9 }).quotes.find(q => q.gpu?.after.model === '9990')!;
    expect(store.getState().wallet.credits).toBe(credits);
    expect(q.downtimeMs).toBeGreaterThan(0);
    expect(host.textContent).toContain(`${span(q.downtimeMs / 1000)} offline`);
  });

  it('shows the full-system power quote for a research-locked native model, including supply loss and overload', () => {
    setup(createInitialState(42));
    const host = picker(null);
    click(host.querySelector('[aria-label="Series 5, VRAM"]'));
    const selected = quote(store.getState(), { kind: 'gpuModels', system: sys, index: null, generation: 1 }).quotes.find(q => q.gpu?.after.model === '1530')!;
    expect(selected.locked?.code).toBe('research');
    expect(selected.gpuPower).toBeDefined();
    const rows = Array.from(host.querySelectorAll('.gpu-quote .gpu-power tbody tr'));
    const fields = ['deliveredW', 'capacityW', 'headroomW', 'lossW', 'inputW'] as const;
    fields.forEach((key, i) => {
      expect(rows[i]?.children[1]?.textContent).toBe(watts(selected.gpuPower!.before[key]));
      expect(rows[i]?.children[2]?.textContent).toBe(watts(selected.gpuPower!.after[key]));
    });
    expect(host.querySelector('.gpu-quote .gpu-power caption')?.textContent).toBe('Full system · full load');
    expect(host.querySelector('.gpu-quote .gpu-power')?.textContent).toContain('Supply cap');
    expect(host.querySelector('.gpu-quote .gpu-power-warning')?.textContent).toBe('Over supply capacity at full load.');
    expect(host.querySelector('.gpu-quote > .gpu-comparison')?.textContent).toContain('Card load');
    expect(host.querySelector<HTMLButtonElement>('.gpu-buy')!.disabled).toBe(true);
  });
});

describe('GPU entry routes', () => {
  it('opens the model picker from an installed card callout (More)', () => {
    setup(); mounted = mount(<PlateLayer />, store);
    act(() => mounted!.shell.view.dispatch({ type: 'select', target: target('gpu0', 0, true) }));
    expect(mounted.host.querySelectorAll('.gpu-picker')).toHaveLength(0);
    act(() => mounted!.shell.view.dispatch({ type: 'openPlate' }));
    expect(mounted.host.querySelectorAll('.gpu-picker')).toHaveLength(1);
    expect(mounted.host.querySelector('.gpu-comparison thead')?.textContent).toContain(installed()!.gpu!.model);
  });

  it('opens the model picker for an empty GPU slot', () => {
    setup(createInitialState(42)); mounted = mount(<PlateLayer />, store);
    act(() => mounted!.shell.view.dispatch({ type: 'select', target: target('slot-gpu0', 0) }));
    act(() => mounted!.shell.view.dispatch({ type: 'openPlate' }));
    expect(mounted.host.querySelector('.gpu-picker .p-title')?.textContent).toBe('Buy GPU');
    expect(mounted.host.querySelector('.gpu-comparison thead')?.textContent).toContain('Empty slot');
  });

  it('keeps the legacy NPU plate distinct and offers an explicit GPU-model replacement', () => {
    setup();
    const count = store.getState().build.systems[0]!.spec.accels.length;
    for (let i = 0; i < count; i++) expect(store.dispatch({ type: 'removePart', part: { unit: { kind: 'system', id: sys }, slot: { kind: 'gpu', index: 0 } } })?.ok).toBe(true);
    expect(store.dispatch({ type: 'addPart', system: sys, kind: 'npu', generation: 0 })?.ok).toBe(true);
    mounted = mount(<PlateLayer />, store);
    act(() => mounted!.shell.view.dispatch({ type: 'select', target: target('gpu0', 0, true) }));
    act(() => mounted!.shell.view.dispatch({ type: 'openPlate' }));
    expect(mounted.host.querySelector('.p-title')?.textContent).toBe('NPU 1');
    expect(mounted.host.textContent).toContain('tensor tasks with no GPU core minimum');
    click(button(mounted.host, 'Replace with GPU model'));
    expect(mounted.host.querySelector('.gpu-picker .p-title')?.textContent).toBe('Replace NPU with GPU');
    expect(mounted.host.querySelector('.gpu-comparison thead')?.textContent).toContain('NPU Gen 1');
    expect(mounted.host.querySelector<HTMLButtonElement>('.gpu-alternatives .ghost')!.disabled).toBe(true);
  });
});
