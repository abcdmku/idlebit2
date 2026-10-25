import { POWER_SLOTS } from './partAccess';
import { powerInstallPlans } from './powerParts';
import type { InfraSlot } from '../types/catalog';
import { amount, amountCompare } from '../amount';
import { MAX_ACCELS, TICK_MS } from '../core/constants';
import type { GameAction } from '../types/actions';
import { FILTER_IDS, ROUTE_STRATEGY_IDS } from '../types/catalog';
import type { NodeRef, PartRef, PartSlot, ResearchId, ScopeRef, SwitchRef } from '../types/ids';
import type { Currency, EffectPreview, Quote, QuoteRequest, QuoteResult } from '../types/quotes';
import type { GameState } from '../types/state';
import { genCount, isLadder } from './catalog';
import { partEffect } from './effect';
import { readPart } from './partAccess';
import { planAdd, planRemove, planReplace, planUpgrade } from './partPlans';
import { PARTS } from './catalog';
import { newestGen } from './research/unlocks';
import { isCold, planPrice, type Plan } from './plan';
import { quoteEffect } from './quotesEffect';
import { planAddPort, planAddUplink, planReplaceLadder, planSameSpeed, planUpgradePort, planUpgradeUplink, switchAt } from './ports';
import { researchLock } from './research/actions';
import { researchDef } from './research/tree';
import { addQuotes } from './quotesAdd';
import { backboneOptions, trayQuotes } from './quotesTray';
import { planFilter, planRouterQueue, planSetpoint, planStrategy } from './settings';
import { GPU_MODEL_IDS, gpuModel } from './catalog/gpuModels';
import { installedGpuStats } from './gpu';
import { planInstallGpu } from './gpuPlans';
import { gpuPowerPreview } from './gpuPower';

/**
 * Lazy quotes (architecture §3.3). Every quote comes from the same planner its action runs, so the
 * price shown is the price charged. Order per request follows R13.
 */
export function quote(state: GameState, request: QuoteRequest): QuoteResult {
  return { configRevision: state.build.revision, quotes: quotesFor(state, request) };
}

function quotesFor(state: GameState, r: QuoteRequest): Quote[] {
  switch (r.kind) {
    case 'gpuModels': return GPU_MODEL_IDS.filter((model) => gpuModel(model)!.generation === r.generation).map((model) =>
      toQuote(state, { type: 'installGpu', system: r.system, index: r.index, model }, planInstallGpu(state, r.system, model, r.index)));
    case 'part': return partQuotes(state, r.part);
    case 'switch': return switchQuotes(state, r.sw);
    case 'infra': return infraQuotes(state, r.unit, r.slot);
    case 'add': return addQuotes(state, r.parent, r.slot);
    case 'tray': return trayQuotes(state, r.at);
    case 'research': return [researchQuote(state, r.project)];
    case 'pipe': return pipeQuotes(state, r.system);
    case 'inbound': return inboundQuotes(state, r.at);
    case 'routerQueue': return routerQueueQuotes(state, r.unit);
    case 'power': return powerQuotes(state, r.unit);
  }
}

/** D31: the scope's optional power part (Power control, room or global start control, site generation). */
function powerQuotes(state: GameState, unit: ScopeRef): Quote[] {
  const slot = unit.kind === 'rack' ? 'powerCtl' : unit.kind === 'room' ? 'roomStart' : unit.kind === 'global' ? 'globalStart'
    : unit.kind === 'site' ? 'generation' : null;
  return slot ? partQuotes(state, { unit, slot: { kind: slot } } as PartRef) : [];
}

/** D25.7: the router queue's next level, effect `slots` L → L + 1; locked ('cap') at 32. */
function routerQueueQuotes(state: GameState, unit: ScopeRef): Quote[] {
  const plan = planRouterQueue(state, unit);
  if (!plan.ok && plan.code === 'invalid') return [];
  const level = routerQueueLevel(state, unit);
  const effect: EffectPreview = {
    capacityBefore: level, capacityAfter: plan.ok ? level + 1 : level, unit: 'slots',
    wattsBefore: 0, wattsAfter: 0, energyPerMinuteDelta: amount('0'), paybackS: null,
  };
  return [toQuote(state, { type: 'upgradeRouterQueue', unit }, plan, effect)];
}
function routerQueueLevel(state: GameState, unit: ScopeRef): number {
  const b = state.build;
  switch (unit.kind) {
    case 'rack': return b.racks[unit.id]?.lb.queueLevel ?? 1;
    case 'room': return b.rooms[unit.id]?.lb.queueLevel ?? 1;
    case 'site': return b.sites[unit.id]?.dataPlane.router.queueLevel ?? 1;
    case 'global': return b.global.scheduler?.queueLevel ?? 1;
    default: return 1;
  }
}

/** A quote with its R42/R43 effect. */
const withEffect = (state: GameState, action: GameAction, plan: Plan): Quote => toQuote(state, action, plan, quoteEffect(state, action, plan));

/** The system's pipe (D13): the next step of its rack-switch port, the port it holds in slot order. */
function pipeQuotes(state: GameState, system: number): Quote[] {
  const sys = state.build.systems[system];
  const rack = sys ? state.build.racks[sys.rack] : null;
  if (!sys || !rack) return [];
  const port = rack.servers.slice(0, sys.slot).filter((s) => s !== null && state.build.systems[s]).length;
  if (port >= rack.switch.ports.length) return [];
  const sw = { kind: 'rack' as const, id: rack.id };
  // With same speed on, the opened switch steps every port together (spec §12.5).
  const step = rack.opened && rack.switch.sameSpeed ? 'all' : port;
  return [withEffect(state, { type: 'upgradePort', sw, port: step }, planUpgradePort(state, sw, step))];
}

/** R43: the level's inbound link step (D15.5 locks say where it upgrades). */
function inboundQuotes(state: GameState, at: NodeRef): Quote[] {
  switch (at.level) {
    case 'chip': case 'system': return pipeQuotes(state, at.id);
    case 'rack': case 'room': {
      const sw: SwitchRef = at.level === 'rack' ? { kind: 'rack', id: at.id } : { kind: 'room', id: at.id };
      const uplinks = switchAt(state.build, sw)?.sw.uplinks ?? [];
      if (uplinks.length === 0) return [];
      const uplink = uplinks.indexOf(Math.min(...uplinks));
      return [withEffect(state, { type: 'upgradeUplink', sw, uplink }, planUpgradeUplink(state, sw, uplink))];
    }
    case 'global': {
      const options = backboneOptions(state);
      const pick = options.find(([, p]) => p.ok) ?? options.find(([, p]) => planPrice(p) !== null) ?? options[0];
      return pick ? [withEffect(state, pick[0], pick[1])] : [];
    }
  }
}

/** Turns a plan into a quote. Locked and failed plans still show their price when they have one. */
export function toQuote(state: GameState, action: GameAction, plan: Plan, effect: EffectPreview | null = null, currency: Currency = 'credits'): Quote {
  const price = planPrice(plan) ?? 0n;
  const cost = amount(price.toString());
  const wallet = currency === 'credits' ? state.wallet.credits : state.wallet.data;
  const cold = isCold(plan);
  const gpuEffect = action.type === 'installGpu' && plan.ok ? partEffect(state, {
    unit: { kind: 'system', id: action.system },
    slot: { kind: 'gpu', index: action.index ?? state.build.systems[action.system]!.spec.accels.length },
  }, plan.change.build, plan.change.price) : null;
  return {
    action, label: plan.label, cost, currency, affordable: amountCompare(wallet, cost) >= 0,
    locked: plan.ok ? null : plan.lock ?? { code: plan.code === 'occupied' ? 'occupied' : plan.code === 'roundState' ? 'roundState' : 'fit', node: null, text: plan.reason },
    cold, downtimeMs: cold && state.round.phase === 'running' ? state.research.unlocks.bootTicks * TICK_MS : 0,
    effect: effect ?? gpuEffect, workOps: null, ...gpuMetadata(state, action, plan),
  };
}

function gpuMetadata(state: GameState, action: GameAction, plan: Plan): Pick<Quote, 'gpu' | 'gpuPower'> {
  if (action.type === 'installGpu') {
    const spec = state.build.systems[action.system]?.spec;
    if (!gpuModel(action.model) || !spec) return {};
    const card = action.index === null ? undefined : spec.accels[action.index];
    const native = { kind: 'gpu' as const, model: action.model, upgrades: 0 };
    const proposed = plan.ok ? plan.change.build.systems[action.system]!.spec
      : action.index === null && spec.accels.length < MAX_ACCELS ? { ...spec, accels: [...spec.accels, native] }
        : card ? { ...spec, accels: spec.accels.map((old, index) => index === action.index ? native : old) } : null;
    return { gpu: {
      before: card?.kind === 'gpu' ? installedGpuStats(card, state.research.unlocks) : null,
      after: installedGpuStats(native, state.research.unlocks),
    }, ...(proposed ? { gpuPower: gpuPowerPreview(state, action.system, proposed) } : {}) };
  }
  if (action.type !== 'upgradePart' || action.part.unit.kind !== 'system' || action.part.slot.kind !== 'gpu') return {};
  const { unit, slot } = action.part;
  const card = state.build.systems[unit.id]?.spec.accels[slot.index];
  if (card?.kind !== 'gpu') return {};
  const after = plan.ok ? plan.change.build.systems[unit.id]?.spec.accels[slot.index] : card;
  return after?.kind === 'gpu' ? {
    gpu: { before: installedGpuStats(card, state.research.unlocks), after: installedGpuStats(after, state.research.unlocks) },
    gpuPower: gpuPowerPreview(state, unit.id, plan.ok ? plan.change.build.systems[unit.id]!.spec : state.build.systems[unit.id]!.spec),
  } : {};
}

const effectOf = (state: GameState, ref: PartRef, plan: Plan): EffectPreview | null =>
  plan.ok ? partEffect(state, ref, plan.change.build, plan.change.price) : null;

/** Part plate: upgrade, then replace (L1 and capacity-preserving) per other generation, then remove. */
export function partQuotes(state: GameState, ref: PartRef): Quote[] {
  const part = readPart(state.build, ref);
  if (!part) {
    // An empty L2 / L3 chip slot offers its part (the slot the chip view shows).
    const k = ref.slot.kind;
    // D31: an empty power slot offers each generation's install.
    if (POWER_SLOTS.includes(k)) return powerInstallPlans(state, ref).map(({ action, plan }) => toQuote(state, action, plan, effectOf(state, ref, plan)));
    if (ref.unit.kind !== 'system' || (k !== 'l2' && k !== 'l3')) return [];
    const g = Math.max(0, newestGen(state.research.unlocks, k, PARTS[k].base.length));
    const action = { type: 'addPart' as const, system: ref.unit.id, kind: k, generation: g };
    return [toQuote(state, action, planAdd(state, ref.unit.id, k, g))];
  }
  const out: Quote[] = [];
  const ladder = isLadder(part.id);
  if (!(part.id === 'switch' || part.id === 'roomSwitch')) {
    const up = planUpgrade(state, ref);
    out.push(toQuote(state, { type: 'upgradePart', part: ref }, up, effectOf(state, ref, up)));
  }
  for (let g = 0; part.id !== 'gpu' && g < genCount(part.id); g += 1) {
    if (g === part.gen) continue;
    if (ladder) { out.push(toQuote(state, { type: 'replacePart', part: ref, generation: g, preserveCapacity: false }, planReplaceLadder(state, ref, g))); continue; }
    // A CPU package and the D31 parts have one replace per generation (no capacity-preserving level).
    for (const preserveCapacity of part.id === 'cpu' || POWER_SLOTS.includes(ref.slot.kind) ? [false] : [false, true]) {
      const plan = planReplace(state, ref, g, preserveCapacity);
      out.push(toQuote(state, { type: 'replacePart', part: ref, generation: g, preserveCapacity }, plan, effectOf(state, ref, plan)));
    }
  }
  const remove = planRemove(state, ref);
  if (remove.ok) out.push(toQuote(state, { type: 'removePart', part: ref }, remove));
  return out;
}

/** Switch plate: each port, all ports (same speed), add port, each uplink, add uplink, replace, same-speed toggle. */
export function switchQuotes(state: GameState, sw: SwitchRef): Quote[] {
  const at = switchAt(state.build, sw);
  if (!at) return [];
  const out: Quote[] = [];
  if (!at.sw.sameSpeed) at.sw.ports.forEach((_, port) => out.push(withEffect(state, { type: 'upgradePort', sw, port }, planUpgradePort(state, sw, port))));
  else out.push(withEffect(state, { type: 'upgradePort', sw, port: 'all' }, planUpgradePort(state, sw, 'all')));
  out.push(withEffect(state, { type: 'addPorts', sw }, planAddPort(state, sw)));
  at.sw.uplinks.forEach((_, uplink) => out.push(withEffect(state, { type: 'upgradeUplink', sw, uplink }, planUpgradeUplink(state, sw, uplink))));
  out.push(withEffect(state, { type: 'addUplink', sw }, planAddUplink(state, sw)));
  const slot: PartSlot = { kind: sw.kind === 'rack' ? 'switch' : 'roomSwitch' };
  const ref: PartRef = { unit: sw, slot };
  for (let g = 0; g < at.row.baseK.length; g += 1) {
    if (g !== at.sw.gen) out.push(toQuote(state, { type: 'replacePart', part: ref, generation: g, preserveCapacity: false }, planReplaceLadder(state, ref, g)));
  }
  out.push(toQuote(state, { type: 'setSameSpeed', sw, on: !at.sw.sameSpeed }, planSameSpeed(state, sw, !at.sw.sameSpeed)));
  return out;
}

const INFRA_SLOT = {
  rack: { cooling: 'rackCooler', power: 'pdu', lb: 'lb' },
  room: { cooling: 'roomCooler', power: 'ups', lb: 'roomLb' },
} as const;

/** Rack and room infrastructure plates (R13). */
export function infraQuotes(state: GameState, unit: { kind: 'rack' | 'room'; id: number }, slot: InfraSlot): Quote[] {
  const scope = unit as ScopeRef & { kind: 'rack' | 'room' };
  if (slot === 'switch') return switchQuotes(state, scope as SwitchRef);
  // D31: Power control (install, levels and generations); its Start settings use setStartConfig.
  if (slot === 'powerCtl') return partQuotes(state, { unit: scope, slot: { kind: 'powerCtl' } });
  const kind = INFRA_SLOT[unit.kind][slot];
  const ref: PartRef = { unit: scope, slot: kind === 'ups' ? { kind, index: 0 } : { kind } as PartSlot };
  if (slot !== 'lb') {
    const out = partQuotes(state, ref).filter((q) => q.action.type !== 'removePart');
    // D31: the room start controller sits on the UPS plate.
    if (slot === 'power' && unit.kind === 'room') out.push(...partQuotes(state, { unit: scope, slot: { kind: 'roomStart' } }));
    if (slot === 'cooling') {
      const setpointF = unit.kind === 'rack' ? state.build.racks[unit.id]?.cooler.setpointF ?? 70 : state.build.rooms[unit.id]?.cooler.setpointF ?? 70;
      out.push(toQuote(state, { type: 'setSetpoint', unit: scope as never, setpointF }, planSetpoint(state, scope as never, setpointF)));
    }
    return out;
  }
  const out = [toQuote(state, { type: 'upgradePart', part: ref }, planUpgrade(state, ref))];
  const lb = unit.kind === 'rack' ? state.build.racks[unit.id]?.lb : state.build.rooms[unit.id]?.lb;
  for (const strategy of ROUTE_STRATEGY_IDS) out.push(toQuote(state, { type: 'setStrategy', unit: scope, strategy }, planStrategy(state, scope, strategy)));
  for (const filter of FILTER_IDS) {
    const on = !(lb?.filters.includes(filter) ?? false);
    out.push(toQuote(state, { type: 'setFilter', unit: scope, filter, on }, planFilter(state, scope, filter, on)));
  }
  return out;
}

/** Research plate: Data at start plus the compute work volume (D3.4). */
export function researchQuote(state: GameState, project: ResearchId): Quote {
  const def = researchDef(project);
  const r = state.research;
  const lock = researchLock(r, project);
  const paid = r.active === project || r.parked[project] !== undefined;
  const cost = amount(paid || !def ? 0 : def.data);
  const creditCost = paid ? amount(0) : def?.creditCost ?? amount(0);
  return {
    action: { type: 'startResearch', project }, label: def?.name ?? project, cost, currency: 'data',
    affordable: amountCompare(state.wallet.data, cost) >= 0 && (amountCompare(creditCost, 0) === 0 || amountCompare(state.wallet.credits, creditCost) >= 0),
    locked: lock ? { code: 'research', node: lock.node, text: lock.reason } : null,
    cold: false, downtimeMs: 0, effect: null, workOps: def?.work ?? null, creditCost,
  };
}
