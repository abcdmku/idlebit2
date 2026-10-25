import type { GameAction } from '../types/actions';
import type { BuildState, SavedConfigs } from '../types/build';
import { REGION_IDS } from '../types/catalog';
import type { NodeRef, PartRef, SystemId } from '../types/ids';
import type { Quote } from '../types/quotes';
import type { GameState, Unlocks } from '../types/state';
import { PARTS } from './catalog';
import { planAdd, planReplaceCpu, planUpgrade } from './partPlans';
import { fail, planPrice, type Plan } from './plan';
import { planUpgradePort } from './ports';
import { toQuote } from './quotes';
import { quoteEffect } from './quotesEffect';
import { newestGen } from './research/unlocks';
import { planAddRow, planAddUnit, regionOpen } from './units';
import { boardLimit } from './partPlans';
import { planInstallGpu } from './gpuPlans';
import { installedGpuStats } from './gpu';
import type { GpuModelId } from '../types/gpu';

/*
 * The build tray: 4 primary quotes per level (R13), plus each installed core's upgrade at chip.
 * chip: core, cache, clock, scheduler; system:
 * CPU, RAM, GPU, storage; rack: cooling, power, LB, switch; room: switch, row, cooling, power;
 * global: site, backbone, scheduler, zone. Nothing to buy = locked "Max". Each primary quote carries the
 * effect of its action (R42).
 *
 * Plans read only build, research unlocks and saved configs, so the picked plans are cached on
 * those; each call re-derives what moves with the wallet, the round and the load (architecture §3.3).
 */
type Option = readonly [GameAction, Plan];
interface Item { readonly action: GameAction; readonly plan: Plan; readonly capText?: string; readonly preview?: false }
const MAX: Plan = { ok: false, code: 'cap', reason: 'Max', lock: { code: 'ceiling', node: null, text: 'Max' }, price: null, label: 'Max' };

/** The first plan that can run; else the first that has a price; else Max. */
function best(options: readonly Option[], fallback: GameAction): Item {
  const pick = options.find(([, p]) => p.ok) ?? options.find(([, p]) => planPrice(p) !== null) ?? options[0];
  return pick ? { action: pick[0], plan: pick[1] } : { action: fallback, plan: MAX };
}
const upgrade = (state: GameState, part: PartRef): Option => [{ type: 'upgradePart', part }, planUpgrade(state, part)];
const cheapest = (state: GameState, parts: readonly PartRef[]): Option[] =>
  parts.map((p) => upgrade(state, p)).sort(([, a], [, b]) => Number((a.ok ? 0n : 1n) - (b.ok ? 0n : 1n)) || Number((planPrice(a) ?? 0n) - (planPrice(b) ?? 0n)));

function addOrUpgrade(state: GameState, system: SystemId, kind: 'ram' | 'drive', list: readonly { gen: number }[]): Option[] {
  const part = kind === 'drive' ? 'storage' : kind;
  const g = Math.max(0, newestGen(state.research.unlocks, part, PARTS[part].base.length));
  const add: Option = [{ type: 'addPart', system, kind, generation: g }, planAdd(state, system, kind, g)];
  return [add, ...cheapest(state, list.map((_, index) => ({ unit: { kind: 'system', id: system }, slot: { kind, index } })))];
}

function chipTray(state: GameState, id: SystemId): Item[] {
  const unit = { kind: 'system' as const, id };
  const cpu = state.build.systems[id]?.spec.cpu;
  const at = (slot: PartRef['slot']): PartRef => ({ unit, slot });
  const coreGen = cpu?.cores[0]?.gen ?? 0;
  const core: Item = { action: { type: 'addPart', system: id, kind: 'core', generation: coreGen }, plan: planAdd(state, id, 'core', coreGen), capText: 'Core limit reached' };
  // The cache item: the cheapest upgrade of a built cache, or adding an unbuilt L2 / L3 once researched (their chip slots).
  const adds: Option[] = cpu ? (['l2', 'l3'] as const).filter((k) => !cpu[k]).map((kind): Option => {
    const g = Math.max(0, newestGen(state.research.unlocks, kind, PARTS[kind].base.length));
    return [{ type: 'addPart', system: id, kind, generation: g }, planAdd(state, id, kind, g)];
  }) : [];
  const caches = [...cheapest(state, (['l1', 'l2', 'l3'] as const).filter((k) => cpu?.[k]).map((kind) => at({ kind, socket: 0 }))), ...adds]
    .sort(([, x], [, y]) => Number((x.ok ? 0n : 1n) - (y.ok ? 0n : 1n)) || Number((planPrice(x) ?? 0n) - (planPrice(y) ?? 0n)));
  const sched = state.build.systems[id]?.spec.scheduler;
  const sg = Math.max(0, newestGen(state.research.unlocks, 'scheduler', 4));
  const scheduler: Option[] = sched ? [upgrade(state, at({ kind: 'scheduler' }))] : [[{ type: 'addPart', system: id, kind: 'scheduler', generation: sg }, planAdd(state, id, 'scheduler', sg)]];
  const fallback: GameAction = { type: 'upgradePart', part: at({ kind: 'clock', socket: 0 }) };
  // D7.3: one quote per shared core index, not per CPU; planUpgrade charges for every CPU.
  // World affordances only need price and locks, so avoid per-core power/payback previews.
  const installed = (cpu?.cores ?? []).map((_, index): Item => {
    const [action, plan] = upgrade(state, at({ kind: 'core', socket: 0, index }));
    return { action, plan, preview: false };
  });
  return [core, best(caches, fallback), best([upgrade(state, at({ kind: 'clock', socket: 0 }))], fallback), best(scheduler, fallback), ...installed];
}

/**
 * The GPU item: with a free slot, the newest generation's entry card. On a full board, the cheapest
 * card upgrade, or that entry card in place of the weakest card only when it is faster (R44: never
 * a downgrade); else Max.
 */
function gpuItem(state: GameState, id: SystemId): Item {
  const spec = state.build.systems[id]!.spec, u = state.research.unlocks;
  const generation = Math.max(0, newestGen(u, 'gpu', 9)) + 1;
  const model = `${generation}330` as GpuModelId;
  const install = (index: number | null): Option => [{ type: 'installGpu', system: id, model, index }, planInstallGpu(state, id, model, index)];
  if (spec.accels.length < boardLimit(spec, u, 'gpu')) { const [action, plan] = install(null); return { action, plan }; }
  const cards = spec.accels.flatMap((card, index) => (card.kind === 'gpu' ? [{ card, index }] : []));
  if (cards.length === 0) { const [action, plan] = install(0); return { action, plan }; }
  const options = cheapest(state, cards.map(({ index }) => ({ unit: { kind: 'system' as const, id }, slot: { kind: 'gpu' as const, index } })));
  let weakest = cards[0]!, weakRate = installedGpuStats(weakest.card, u).opsPerS;
  for (const c of cards.slice(1)) {
    const rate = installedGpuStats(c.card, u).opsPerS;
    if (rate < weakRate) { weakest = c; weakRate = rate; }
  }
  if (installedGpuStats({ kind: 'gpu', model, upgrades: 0 }, u).opsPerS > weakRate) options.push(install(weakest.index));
  return best(options, { type: 'installGpu', system: id, model, index: weakest.index });
}

function systemTray(state: GameState, id: SystemId): Item[] {
  const spec = state.build.systems[id]?.spec;
  const fallback: GameAction = { type: 'replaceCpu', system: id };
  if (!spec) return [0, 1, 2, 3].map(() => ({ action: fallback, plan: fail('invalid', 'No such system') }));
  const cpu: Option[] = [[{ type: 'addPart', system: id, kind: 'socket', generation: spec.cpu?.cpu.gen ?? 0 }, planAdd(state, id, 'socket', spec.cpu?.cpu.gen ?? 0)],
    [{ type: 'replaceCpu', system: id }, planReplaceCpu(state, id)]];
  return [best(cpu, fallback), best(addOrUpgrade(state, id, 'ram', spec.ram), fallback),
    gpuItem(state, id), best(addOrUpgrade(state, id, 'drive', spec.drives), fallback)];
}

/** The slowest port's next step, or the same-speed step. */
function portOption(state: GameState, sw: { kind: 'rack' | 'room'; id: number }): Option[] {
  const b = state.build;
  const s = sw.kind === 'rack' ? b.racks[sw.id]?.switch : b.rooms[sw.id]?.switch;
  if (!s) return [];
  const ref = sw as never;
  if (s.sameSpeed) return [[{ type: 'upgradePort', sw: ref, port: 'all' }, planUpgradePort(state, ref, 'all')]];
  const port = s.ports.indexOf(Math.min(...s.ports));
  return [[{ type: 'upgradePort', sw: ref, port }, planUpgradePort(state, ref, port)]];
}

function globalTray(state: GameState): Item[] {
  const b = state.build;
  const u = state.research.unlocks;
  const free = REGION_IDS.findIndex((r) => regionOpen(u, r) && !b.sites.some((s) => s?.region === r));
  const region = free < 0 ? REGION_IDS.findIndex((r) => !b.sites.some((s) => s?.region === r)) : free;
  const site: Option[] = region < 0 ? [] : [[{ type: 'addUnit', parent: { kind: 'global' }, slot: region, source: { kind: 'barebones', tier: 0 } }, planAddUnit(state, { kind: 'global' }, region, { kind: 'barebones', tier: 0 })]];
  const scheduler = [upgrade(state, { unit: { kind: 'global' }, slot: { kind: 'globalScheduler' } })];
  const home = b.sites[0];
  const z = home ? home.zones.findIndex((x) => x === null) : -1;
  const zone: Option[] = home && z >= 0 ? [[{ type: 'addUnit', parent: { kind: 'site', id: home.id }, slot: z, source: { kind: 'barebones', tier: 0 } }, planAddUnit(state, { kind: 'site', id: home.id }, z, { kind: 'barebones', tier: 0 })]] : [];
  const fallback: GameAction = scheduler[0]![0];
  return [best(site, fallback), best(backboneOptions(state), fallback), best(scheduler, fallback), best(zone, fallback)];
}

/** Each remote site's backbone link step, cheapest first (shared with the inbound link quote). */
export const backboneOptions = (state: GameState): Option[] =>
  cheapest(state, state.build.sites.flatMap((s) => (s?.backbone ? [{ unit: { kind: 'site' as const, id: s.id }, slot: { kind: 'backbone' as const } }] : [])));

function trayItems(state: GameState, at: NodeRef): Item[] {
  switch (at.level) {
    case 'chip': return chipTray(state, at.id);
    case 'system': return systemTray(state, at.id);
    case 'rack': {
      const unit = { kind: 'rack' as const, id: at.id };
      const fallback: GameAction = { type: 'upgradePart', part: { unit, slot: { kind: 'lb' } } };
      return [best([upgrade(state, { unit, slot: { kind: 'rackCooler' } })], fallback), best([upgrade(state, { unit, slot: { kind: 'pdu' } })], fallback),
        best([upgrade(state, { unit, slot: { kind: 'lb' } })], fallback), best(portOption(state, unit), fallback)];
    }
    case 'room': {
      const unit = { kind: 'room' as const, id: at.id };
      const fallback: GameAction = { type: 'addRow', room: at.id };
      return [best(portOption(state, unit), fallback), best([[{ type: 'addRow', room: at.id }, planAddRow(state, at.id)]], fallback),
        best([upgrade(state, { unit, slot: { kind: 'roomCooler' } })], fallback), best([upgrade(state, { unit, slot: { kind: 'ups', index: 0 } })], fallback)];
    }
    case 'global': return globalTray(state);
  }
}

interface Cached { readonly unlocks: Unlocks; readonly configs: SavedConfigs; readonly items: readonly Item[] }
const cache = new WeakMap<BuildState, Map<string, Cached>>();

function cachedItems(state: GameState, at: NodeRef): readonly Item[] {
  let byNode = cache.get(state.build);
  if (!byNode) cache.set(state.build, (byNode = new Map()));
  const key = `${at.level}:${at.id}`;
  const hit = byNode.get(key);
  if (hit && hit.unlocks === state.research.unlocks && hit.configs === state.configs) return hit.items;
  const items = trayItems(state, at);
  byNode.set(key, { unlocks: state.research.unlocks, configs: state.configs, items });
  return items;
}

export function trayQuotes(state: GameState, at: NodeRef): Quote[] {
  return cachedItems(state, at).map(({ action, plan, capText, preview }) => {
    const q = toQuote(state, action, plan, preview === false ? null : quoteEffect(state, action, plan));
    return capText && q.locked?.code === 'cap' ? { ...q, locked: { ...q.locked, text: capText } } : q;
  });
}
