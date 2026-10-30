import { newestGen } from './research/unlocks';
import { POWER_SCALE, viewW } from '../core/constants';
import { researchCosts } from '../rewards/research';
import type { GpuPowerPoint, GpuPowerPreview } from '../types/quotes';
import { meetLines } from './meet';
import { POWER_SLOTS } from './partAccess';
import { powerInstallPlans } from './powerParts';
import type { InfraSlot } from '../types/catalog';
import { amount, amountCompare } from '../amount';
import { investmentChange } from './investments';
import { MAX_ACCELS, TICK_MS } from '../core/constants';
import type { GameAction } from '../types/actions';
import { FILTER_IDS, ROUTE_STRATEGY_IDS, QUEUE_STRATEGY_IDS } from '../types/catalog';
import type { NodeRef, PartRef, PartSlot, ResearchId, ScopeRef, SwitchRef, SystemId } from '../types/ids';
import type { GpuGeneration, GpuModelId } from '../types/gpu';
import type { Currency, EffectPreview, Quote, QuoteRequest, QuoteResult } from '../types/quotes';
import type { GameState } from '../types/state';
import { genCount, isLadder, partName } from './catalog';
import { genLock } from './locks';
import { partEffect } from './effect';
import { readPart } from './partAccess';
import { planAdd, planRemove, planReplace, planReplaceCpu, planUpgrade } from './partPlans';
import { supplyPlans } from './supplyPlans';
import { PARTS } from './catalog';
import { isCold, planPrice, type Plan } from './plan';
import { quoteEffect } from './quotesEffect';
import { planAddPort, planAddUplink, planReplaceLadder, planSameSpeed, planUpgradePort, planUpgradeUplink, switchAt } from './ports';
import { researchLock } from './research/actions';
import { researchDef } from './research/tree';
import { addQuotes } from './quotesAdd';
import { backboneOptions, trayQuotes } from './quotesTray';
import { planFilter, planRouterQueue, planSetpoint, planStrategy } from './settings';
import { gpuAsType, gpuAtGeneration, gpuModel } from './catalog/gpuModels';
import { installedGpuStats } from './gpu';
import { planInstallGpu } from './gpuPlans';
import { planDowngrade } from './maintenance';
import { gpuPowerPreview } from './gpuPower';
import { overSupply, powerLock } from './overSupply';
import { planRamEcc } from './eccPlans';

/**
 * Lazy quotes (architecture §3.3). Every quote comes from the same planner its action runs, so the
 * price shown is the price charged. Order per request follows R13.
 */
export function quote(state: GameState, request: QuoteRequest): QuoteResult {
  return { configRevision: state.build.revision, quotes: quotesFor(state, request) };
}

function quotesFor(state: GameState, r: QuoteRequest): Quote[] {
  switch (r.kind) {
    case 'gpuModels': return gpuOffers(state, r.system, r.index, r.generation).map((model) =>
      toQuote(state, { type: 'installGpu', system: r.system, index: r.index, model }, planInstallGpu(state, r.system, model, r.index)));
    case 'part': if (r.part.slot.kind === 'psu') return []; return r.minimumCapacity ? supplyPlans(state, r.part, r.minimumCapacity).map(({ action, plan }) => toQuote(state, action, plan, effectOf(state, r.part, plan))) : partQuotes(state, r.part);
    case 'switch': return switchQuotes(state, r.sw);
    case 'infra': return infraQuotes(state, r.unit, r.slot);
    case 'add': return addQuotes(state, r.parent, r.slot);
    case 'tray': return trayQuotes(state, r.at);
    case 'research': return [researchQuote(state, r.project)];
    case 'pipe': return pipeQuotes(state, r.system);
    case 'meet': return meetLines(state,r.system,r.need).map(({action,plan})=>withEffect(state,action,plan));
    case 'inbound': return inboundQuotes(state, r.at);
    case 'routerQueue': return routerQueueQuotes(state, r.unit);
    case 'power': return powerQuotes(state, r.unit);
  }
}

/**
 * The GPU tier ruling: an empty slot (or one holding an NPU) offers one card per type at tier 30 of the generation.
 * A GPU offers, at a later generation, its own type and tier; at its own generation, the other types at its tier
 * (a type change). Tiers step on the part quote.
 */
function gpuOffers(state: GameState, system: SystemId, index: number | null, generation: GpuGeneration): GpuModelId[] {
  const card = index === null ? undefined : state.build.systems[system]?.spec.accels[index];
  if (card?.kind === 'gpu') {
    if (gpuModel(card.model)?.generation === generation) return GPU_SERIES.flatMap((series) => gpuAsType(card.model, series) ?? []);
    const next = gpuAtGeneration(card.model, generation); return next ? [next] : [];
  }
  return GPU_SERIES.map((series): GpuModelId => `${generation}${series}30`);
}
const GPU_SERIES = [3, 5, 7, 9] as const;

/** D31: the scope's optional power part (Power control, room or global start control, site generation). */
function powerQuotes(state: GameState, unit: ScopeRef): Quote[] {
  const slot = unit.kind === 'rack' ? 'powerCtl' : unit.kind === 'room' ? 'roomStart' : unit.kind === 'global' ? 'globalStart'
    : unit.kind === 'site' ? 'generation' : null;
  return slot ? partQuotes(state, { unit, slot: { kind: slot } } as PartRef) : [];
}

/** D57: the router queue's next level, effect `slots` L → L + 1; locked ('cap') at eight. */
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
  const warning = supplyWarning(state, plan), rawEffect = effect ?? gpuEffect;
  const shownEffect = warning.overSupply && rawEffect?.marketEstimate
    ? { ...rawEffect, paybackS: null, paybackBlockedBySupply: true } : rawEffect;
  return {
    action, label: plan.label, cost, currency, affordable: price <= 0n || amountCompare(wallet, cost) >= 0,
    ...(plan.ok && (action.type === 'downgradePart' || action.type === 'removePart' || action.type === 'removeUnit')
      ? { refund: amount(investmentChange(state.build, plan.change.build, plan.change.price, action).refund.toString()) } : {}),
    locked: warning.overSupply ? powerLock(state, warning.overSupply) : plan.ok ? null : plan.lock ?? { code: plan.code === 'occupied' ? 'occupied' : plan.code === 'roundState' ? 'roundState' : 'fit', node: null, text: plan.reason },
    cold, downtimeMs: cold && state.round.phase === 'running' ? state.research.unlocks.bootTicks * TICK_MS : 0,
    effect: shownEffect, workOps: null, ...gpuMetadata(state, action, plan), ...warning,
  };
}

/** The supply warning (overSupply.ts) on any plan that changes or adds a system. */
function supplyWarning(state: GameState, plan: Plan): Pick<Quote, 'overSupply'> {
  if (!plan.ok) return {};
  const over = overSupply(state, plan.change.build);
  return over ? { overSupply: over } : {};
}

/** D36: GPU watts and ops per joule at the view scale. */
const viewGpu = <T extends { idleW: number; loadW: number; efficiencyOpsPerJ: number }>(g: T): T =>
  ({ ...g, idleW: viewW(g.idleW), loadW: viewW(g.loadW), efficiencyOpsPerJ: g.efficiencyOpsPerJ / POWER_SCALE });
const point = (p: GpuPowerPoint): GpuPowerPoint => ({ deliveredW: viewW(p.deliveredW), capacityW: viewW(p.capacityW), lossW: viewW(p.lossW), inputW: viewW(p.inputW), headroomW: viewW(p.headroomW) });
const viewPower = (p: GpuPowerPreview): GpuPowerPreview => ({ before: point(p.before), after: point(p.after) });

function gpuMetadata(state: GameState, action: GameAction, plan: Plan): Pick<Quote, 'gpu' | 'gpuPower'> {
  if (action.type === 'installGpu') {
    const spec = state.build.systems[action.system]?.spec;
    if (!gpuModel(action.model) || !spec) return {};
    const card = action.index === null ? undefined : spec.accels[action.index];
    const native = { kind: 'gpu' as const, model: action.model };
    const proposed = plan.ok ? plan.change.build.systems[action.system]!.spec
      : action.index === null && spec.accels.length < MAX_ACCELS ? { ...spec, accels: [...spec.accels, native] }
        : card ? { ...spec, accels: spec.accels.map((old, index) => index === action.index ? native : old) } : null;
    return { gpu: {
      before: card?.kind === 'gpu' ? viewGpu(installedGpuStats(card, state.research.unlocks)) : null,
      after: viewGpu(installedGpuStats(native, state.research.unlocks)),
    }, ...(proposed ? { gpuPower: viewPower(gpuPowerPreview(state, action.system, proposed)) } : {}) };
  }
  if (action.type !== 'upgradePart' || action.part.unit.kind !== 'system' || action.part.slot.kind !== 'gpu') return {};
  const { unit, slot } = action.part;
  const card = state.build.systems[unit.id]?.spec.accels[slot.index];
  if (card?.kind !== 'gpu') return {};
  const after = plan.ok ? plan.change.build.systems[unit.id]?.spec.accels[slot.index] : card;
  return after?.kind === 'gpu' ? {
    gpu: { before: viewGpu(installedGpuStats(card, state.research.unlocks)), after: viewGpu(installedGpuStats(after, state.research.unlocks)) },
    gpuPower: viewPower(gpuPowerPreview(state, unit.id, plan.ok ? plan.change.build.systems[unit.id]!.spec : state.build.systems[unit.id]!.spec)),
  } : {};
}

const effectOf = (state: GameState, ref: PartRef, plan: Plan): EffectPreview | null =>
  plan.ok ? partEffect(state, ref, plan.change.build, plan.change.price) : null;

function maintenanceQuotes(state: GameState, part: PartRef): Quote[] {
  const axes = part.slot.kind === 'ram' || part.slot.kind === 'drive' ? ['capacity', 'speed'] as const : ['capacity'] as const;
  const down = part.slot.kind === 'core' ? [] : axes.map(axis => {
    const plan = planDowngrade(state, part, axis);
    return withEffect(state, { type: 'downgradePart', part, axis }, plan);
  });
  const remove = planRemove(state, part);
  return [...down, toQuote(state, { type: 'removePart', part }, remove)];
}

/** Part plate: upgrade, then replace (L1 and capacity-preserving) per other generation, then remove. */
export function partQuotes(state: GameState, ref: PartRef): Quote[] {
  if (ref.unit.kind === 'system' && ref.slot.kind === 'cpu') {
    const spec = state.build.systems[ref.unit.id]?.spec, current = spec?.cpu?.cpu.gen ?? 0;
    if (!spec) return [];
    // An empty socket offers only its own add (a copy of CPU 1, D7.3), never a replace of the installed ones.
    if (!spec.cpu || ref.slot.socket >= spec.cpuCount) {
      const action = { type: 'addPart' as const, system: ref.unit.id, kind: 'socket' as const, generation: current };
      const plan = planAdd(state, ref.unit.id, 'socket', current);
      // What another CPU adds to the system: its work rate, power and research, as a clock or core step reads.
      const all = plan.ok ? partEffect(state, { unit: ref.unit, slot: { kind: 'core', socket: 0, index: 0 } }, plan.change.build, plan.change.price, true) : null;
      return [toQuote(state, action, plan, all ?? quoteEffect(state, action, plan))];
    }
    const plan = planReplaceCpu(state, ref.unit.id);
    const nextLock = !plan.ok && current + 1 < genCount('cpu') ? genLock(state.research.unlocks, 'cpu', current + 1) : null;
    if (nextLock) return [{ ...toQuote(state, { type: 'replaceCpu', system: ref.unit.id }, plan),
      label: partName('cpu', current + 1), locked: nextLock }, ...maintenanceQuotes(state, ref)];
    return [toQuote(state, { type: 'replaceCpu', system: ref.unit.id }, plan,
      plan.ok ? partEffect(state, ref, plan.change.build, plan.change.price) : null), ...maintenanceQuotes(state, ref)];
  }
  const part = readPart(state.build, ref);
  if (!part) {
    const k = ref.slot.kind;
    // D31: an empty power slot offers each generation's install.
    if (POWER_SLOTS.includes(k)) return powerInstallPlans(state, ref).map(({ action, plan }) => toQuote(state, action, plan, effectOf(state, ref, plan)));
    if (ref.unit.kind === 'system' && (k === 'ram' || k === 'drive')) {
      const system = ref.unit.id, spec = state.build.systems[system]?.spec;
      if (!spec || ref.slot.kind !== k || !('index' in ref.slot) || ref.slot.index !== (k === 'ram' ? spec.ram.length : spec.drives.length)) return [];
      const row = PARTS[k === 'ram' ? 'ram' : 'storage'];
      return row.base.map((_, generation) => {
        const action = { type: 'addPart' as const, system, kind: k, generation };
        const plan = planAdd(state, system, k, generation);
        // The system's totals: all RAM (or storage) and its pooled bandwidth (or IO), before and after.
        return toQuote(state, action, plan, plan.ok ? partEffect(state, ref, plan.change.build, plan.change.price, true) : null);
      });
    }
    // An empty accelerator bay offers each NPU generation's add (a GPU model comes from the 'gpuModels' request).
    if (ref.unit.kind === 'system' && k === 'gpu') {
      const system = ref.unit.id, spec = state.build.systems[system]?.spec;
      if (!spec || ref.slot.kind !== 'gpu' || ref.slot.index !== spec.accels.length) return [];
      return PARTS.npu.base.map((_, generation) => {
        const action = { type: 'addPart' as const, system, kind: 'npu' as const, generation };
        const plan = planAdd(state, system, 'npu', generation);
        return toQuote(state, action, plan, effectOf(state, ref, plan));
      });
    }
    if(ref.unit.kind==='system'&&k==='scheduler'){const g=Math.max(0,newestGen(state.research.unlocks,'scheduler',4)),action={type:'addPart' as const,system:ref.unit.id,kind:'scheduler' as const,generation:g};return [toQuote(state,action,planAdd(state,ref.unit.id,'scheduler',g))];}
    return [];
  }
  const out: Quote[] = [];
  if (ref.unit.kind === 'system' && ref.slot.kind === 'scheduler')
    for (const strategy of QUEUE_STRATEGY_IDS) out.push(toQuote(state,
      { type: 'setStrategy', unit: ref.unit, strategy }, planStrategy(state, ref.unit, strategy)));
  const ladder = isLadder(part.id);
  // D34: a core has no upgrade of its own.
  if (!(part.id === 'switch' || part.id === 'roomSwitch' || part.id === 'core')) {
    const up = planUpgrade(state, ref);
    out.push(withEffect(state, { type: 'upgradePart', part: ref }, up));
    if (part.id === 'ram' || part.id === 'storage') out.push(withEffect(state,
      { type: 'upgradePart', part: ref, axis: 'speed' }, planUpgrade(state, ref, 'speed')));
  }
  // Replace only moves up (user, 25 Oct): generations above the installed one, in catalog order.
  for (let g = part.gen + 1; part.id !== 'gpu' && g < genCount(part.id); g += 1) {
    if (ladder) { out.push(withEffect(state, { type: 'replacePart', part: ref, generation: g, preserveCapacity: false }, planReplaceLadder(state, ref, g))); continue; }
    // A CPU package and the D31 parts have one replace per generation (no capacity-preserving level).
    let plainLock: string | null = null;
    for (const preserveCapacity of part.id === 'cpu' || part.id === 'ram' || part.id === 'storage' || POWER_SLOTS.includes(ref.slot.kind) ? [false] : [false, true]) {
      const plan = planReplace(state, ref, g, preserveCapacity);
      if (!preserveCapacity && !plan.ok) plainLock = plan.lock?.text ?? null;
      if (preserveCapacity && !plan.ok && plainLock !== null && plan.lock?.text === plainLock) continue;
      out.push(toQuote(state, { type: 'replacePart', part: ref, generation: g, preserveCapacity }, plan, effectOf(state, ref, plan)));
    }
  }
  if (ref.unit.kind === 'system' && ref.slot.kind === 'ram' && state.build.systems[ref.unit.id]?.spec.ram.some(m => !m.ecc))
    out.push(toQuote(state, { type: 'convertRamToEcc', system: ref.unit.id }, planRamEcc(state, ref.unit.id)));
  if (isLadder(part.id) ? part.level >= 0 : part.level > 0) out.push(...maintenanceQuotes(state, ref));
  if (ref.slot.kind === 'globalScheduler' || ref.slot.kind === 'dataPlane') out.push(...routingQuotes(state, ref.unit));
  return out;
}

/** Free routing controls belong to the same scope as the selected network part. */
function routingQuotes(state: GameState, unit: ScopeRef): Quote[] {
  const router = unit.kind === 'rack' ? state.build.racks[unit.id]?.lb
    : unit.kind === 'room' ? state.build.rooms[unit.id]?.lb
      : unit.kind === 'site' ? state.build.sites[unit.id]?.dataPlane.router
        : unit.kind === 'global' ? state.build.global.scheduler : null;
  if (!router) return [];
  return [
    ...ROUTE_STRATEGY_IDS.map(strategy => toQuote(state, { type: 'setStrategy', unit, strategy }, planStrategy(state, unit, strategy))),
    ...FILTER_IDS.map(filter => {
      const on = !router.filters.includes(filter);
      return toQuote(state, { type: 'setFilter', unit, filter, on }, planFilter(state, unit, filter, on));
    }),
  ];
}

/** Switch plate: each port, all ports (same speed), add port, each uplink, add uplink, replace, same-speed toggle. */
export function switchQuotes(state: GameState, sw: SwitchRef): Quote[] {
  const at = switchAt(state.build, sw);
  if (!at) return [];
  const out: Quote[] = [];
  // D35: the whole-switch step always; one step per switch port too while its ports aren't matched.
  out.push(withEffect(state, { type: 'upgradePort', sw, port: 'all' }, planUpgradePort(state, sw, 'all')));
  if (!at.sw.sameSpeed) at.sw.ports.forEach((_, port) => out.push(withEffect(state, { type: 'upgradePort', sw, port }, planUpgradePort(state, sw, port))));
  out.push(withEffect(state, { type: 'addPorts', sw }, planAddPort(state, sw)));
  at.sw.uplinks.forEach((_, uplink) => out.push(withEffect(state, { type: 'upgradeUplink', sw, uplink }, planUpgradeUplink(state, sw, uplink))));
  out.push(withEffect(state, { type: 'addUplink', sw }, planAddUplink(state, sw)));
  const slot: PartSlot = { kind: sw.kind === 'rack' ? 'switch' : 'roomSwitch' };
  const ref: PartRef = { unit: sw, slot };
  if (!at.sw.ports.length) return [withEffect(state, { type: 'upgradePart', part: ref }, planUpgrade(state, ref))];
  for (let g = at.sw.gen + 1; g < at.row.baseK.length; g += 1) {
    out.push(withEffect(state, { type: 'replacePart', part: ref, generation: g, preserveCapacity: false }, planReplaceLadder(state, ref, g)));
  }
  out.push(toQuote(state, { type: 'setSameSpeed', sw, on: !at.sw.sameSpeed }, planSameSpeed(state, sw, !at.sw.sameSpeed)));
  out.push(...maintenanceQuotes(state, ref));
  if (!at.sw.ports.length) out.unshift(withEffect(state, { type: 'upgradePart', part: ref }, planUpgrade(state, ref)));
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
    const out = partQuotes(state, ref);
    if (slot === 'cooling') {
      const setpointF = unit.kind === 'rack' ? state.build.racks[unit.id]?.cooler.setpointF ?? 70 : state.build.rooms[unit.id]?.cooler.setpointF ?? 70;
      out.push(toQuote(state, { type: 'setSetpoint', unit: scope as never, setpointF }, planSetpoint(state, scope as never, setpointF)));
    }
    return out;
  }
  const out = [toQuote(state, { type: 'upgradePart', part: ref }, planUpgrade(state, ref))];
  out.push(...maintenanceQuotes(state, ref));
  out.push(...routingQuotes(state, scope));
  return out;
}

/** Research plate: Data at start plus the compute work volume (D3.4). */
export function researchQuote(state: GameState, project: ResearchId): Quote {
  const def = researchDef(project);
  const r = state.research;
  const lock = researchLock(r, project, [], state.roundRewards.claimed);
  const paid = r.active === project || r.parked[project] !== undefined;
  const costs = def ? researchCosts(def, state.roundRewards) : { data: amount(0), credits: amount(0) };
  const cost = paid ? amount(0) : costs.data;
  const creditCost = paid ? amount(0) : costs.credits;
  return {
    action: { type: 'startResearch', project }, label: def?.name ?? project, cost, currency: 'data',
    affordable: amountCompare(state.wallet.data, cost) >= 0 && (amountCompare(creditCost, 0) === 0 || amountCompare(state.wallet.credits, creditCost) >= 0),
    locked: lock ? { code: 'research', node: lock.node, text: lock.reason } : null,
    cold: false, downtimeMs: 0, effect: null, workOps: def?.work ?? null, creditCost,
  };
}
