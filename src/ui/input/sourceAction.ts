import type { LevelSnapshot, Quote, QuoteRequest } from '../../game';
import type { HitTarget } from '../../render/core';
import type { ShellContextValue } from '../storeHooks';
import { addDetail } from './addTap';
import { configKind, hasPlate, isInbound, plateRequest } from '../plates/PlateLayer';
import { GPU_GENERATIONS } from '../plates/gpuModel';
import { partFacts } from '../plates/partFacts';
import { nextGeneration } from '../plates/GenerationAction';
import { purchaseGain, purchaseReason } from '../plates/purchaseText';
import { SLOT_TITLE } from '../plates/copy';
import { measureUnit } from '../plates/format';

export interface SourceAction {
  readonly name: string;
  readonly quote: Quote;
  readonly gain: string;
  readonly kind: 'part' | 'link' | 'add';
  /** Several builds fit this site: the quote is the cheapest of them, and a tap opens the picker without spending. */
  readonly choice: boolean;
}

const gpuBay = (target: HitTarget) => !target.part && /^(?:add:|slot-)gpu/.test(target.id);
const cheaper = (a: Quote, b: Quote) => (!a.locked === !b.locked ? BigInt(a.cost) <= BigInt(b.cost) : !a.locked) ? a : b;

/** A second request an empty site also quotes: a GPU bay holds a GPU model as well as an NPU. */
export function sourceExtraRequest(target: HitTarget, focus: LevelSnapshot): QuoteRequest | null {
  return gpuBay(target) && target.kind === 'add' && focus.level === 'system'
    ? { kind: 'gpuModels', system: focus.systemId, index: null, generation: GPU_GENERATIONS[0] } : null;
}

/**
 * Parts without operating settings buy on the part itself. Every empty site quotes its add too: one build buys
 * there, several show the cheapest and open their picker.
 */
export function sourceRequest(target: HitTarget, focus: LevelSnapshot): QuoteRequest | null {
  if (target.drill || target.kind === 'save' || target.kind === 'port') return null;
  if (isInbound(target) && (focus.level === 'chip' || focus.level === 'system')) return null;
  // An empty bay quotes the NPU that would follow the installed cards; a GPU model comes from the extra request.
  if (gpuBay(target)) return target.kind === 'add' && focus.level === 'system'
    ? { kind: 'part', part: { unit: { kind: 'system', id: focus.systemId }, slot: { kind: 'gpu', index: focus.gpu.length } } } : null;
  if (target.part?.slot.kind === 'gpu') return null;
  // A full floor's next row is sold by the room.
  if (target.id === 'row' && target.kind === 'unit' && focus.level === 'room') return { kind: 'tray', at: target.owner };
  if (target.id === 'add:core') return { kind: 'tray', at: target.owner };
  if (target.kind === 'add') return plateRequest(addDetail(target), focus);
  const kind = target.part?.slot.kind;
  if (kind === 'globalScheduler' && focus.level === 'global' && !focus.scheduler) return { kind: 'tray', at: target.owner };
  const simple = kind && ['clock', 'cache', 'pdu', 'ups', 'grid', 'generation', 'backbone'].includes(kind);
  const emptyStart = kind === 'roomStart' && focus.level === 'room' && !focus.power?.start
    || kind === 'globalStart' && focus.level === 'global' && !focus.start
    || kind === 'powerCtl' && focus.level === 'rack' && !focus.powerCtl;
  if (target.kind === 'slot' || isInbound(target) || simple || emptyStart)
    return plateRequest(target, focus);
  return null;
}

export function sourceAction(target: HitTarget, focus: LevelSnapshot, quotes: readonly Quote[]): SourceAction | null {
  const kind = target.part?.slot.kind;
  if (kind && target.part) {
    const own = quotes.filter(q => 'part' in q.action && q.action.part.slot.kind === kind);
    const siteId = target.part.unit.kind === 'site' ? target.part.unit.id : null;
    const emptyPower = kind === 'powerCtl' && focus.level === 'rack' && !focus.powerCtl
      || kind === 'roomStart' && focus.level === 'room' && !focus.power?.start
      || kind === 'globalStart' && focus.level === 'global' && !focus.start
      || kind === 'generation' && focus.level === 'global' && target.part.unit.kind === 'site'
        && !focus.sites.find(site => site.siteId === siteId)?.generation;
    if (emptyPower) {
      const q = own.find(q => !q.locked) ?? own[0];
      // The rack's empty Power control bay is an add site like the free sled under it: name, then price or research.
      return q ? { name: SLOT_TITLE[kind], quote: q, gain: purchaseGain(q), kind: kind === 'powerCtl' ? 'add' : 'part', choice: false } : null;
    }
    if (own.some(q => q.action.type === 'downgradePart' || q.action.type === 'removePart')) return null;
    const step = own.find(q => q.action.type === 'upgradePart' && q.locked?.code !== 'ceiling' && q.locked?.code !== 'cap');
    const next = nextGeneration(own);
    if (step && next) return null;
    // A single researched installation needs no type picker either.
    const available = own.filter(q => q.locked?.code !== 'research' && q.locked?.code !== 'ceiling' && q.locked?.code !== 'cap');
    const q = step ?? (available.length === 1 ? available[0] : next);
    if (!step && available.length > 1) return null;
    return q ? { name: partFacts(focus, target.part!.slot)?.title ?? SLOT_TITLE[kind], quote: q,
      gain: purchaseGain(q), kind: 'part', choice: false } : null;
  }
  if (isInbound(target)) {
    const q = quotes[0];
    return q ? { name: focus.level === 'room' ? 'Zone link' : focus.level === 'rack' ? 'Uplink' : focus.level === 'global' ? 'Backbone' : 'Pipe',
      quote: q, gain: purchaseGain(q), kind: 'link', choice: false } : null;
  }
  if (target.id === 'row' && target.kind === 'unit') {
    const q = quotes.find(q => q.action.type === 'addRow');
    return q ? { name: 'Add row', quote: q, gain: '', kind: 'add', choice: false } : null;
  }
  if (target.kind !== 'slot' && target.kind !== 'add') return null;
  const bay = gpuBay(target);
  const adds = quotes.filter(q => target.id === 'add:core' || target.id === 'queue'
    ? q.action.type === 'addPart' && q.action.kind === (target.id === 'queue' ? 'scheduler' : 'core')
    : bay ? q.action.type === 'installGpu' || q.action.type === 'addPart' && q.action.kind === 'npu'
    : q.action.type === 'addPart' || q.action.type === 'addUnit' || q.action.type === 'installGpu');
  // Locked generations are research, not an installation choice. Two available builds keep their picker: the
  // site shows the cheapest as a quoted "from" price.
  const available = adds.filter(q => q.locked?.code !== 'research');
  const choices = available.length ? available : adds;
  if (!choices.length) return null;
  // Builds that all wait on research are no choice yet: the site names the research and a tap opens it.
  const choice = bay || available.length > 1;
  const q = choices.reduce(cheaper), a = q.action;
  if (bay) return { name: 'GPU bay', quote: q, gain: '', kind: 'add', choice };
  const noun = a.type === 'addPart' ? a.kind === 'socket' ? 'CPU' : a.kind === 'scheduler' ? 'queue' : a.kind === 'drive' ? 'drive' : a.kind === 'ram' ? 'RAM' : a.kind
    : a.type === 'addUnit' ? ({ system: 'server', rack: 'rack', room: 'zone', site: 'site' }[configKind(focus.level, a.parent) ?? 'system']) : 'GPU';
  // A second socket holds a copy of the first CPU (D7.3).
  const gain = a.type === 'addPart' && a.kind === 'socket' ? 'Like CPU 1'
    : a.type === 'addPart' && a.kind === 'core' ? '+1 core'
    : q.effect ? measureUnit(q.effect.capacityAfter - q.effect.capacityBefore, q.effect.unit) : '';
  return { name: `Add ${noun}`, quote: q, gain: choice ? '' : gain, kind: 'add', choice };
}

type Shell = Pick<ShellContextValue, 'quote' | 'store' | 'view' | 'dispatch'>;
export function actionAtSource(shell: Shell, target: HitTarget): SourceAction | null {
  const focus = shell.store.getSnapshot().focus, request = sourceRequest(target, focus), extra = sourceExtraRequest(target, focus);
  return request ? sourceAction(target, focus, extra ? [...shell.quote(request).quotes, ...shell.quote(extra).quotes] : shell.quote(request).quotes) : null;
}

const accepted = new WeakMap<Shell['store'], Map<string, number>>();
/** Re-quote at the tap. A disabled source never opens an explanation popup. */
export function runSourceAction(shell: Shell, target: HitTarget): void {
  const model = actionAtSource(shell, target), q = model?.quote;
  if (!model || !q) return;
  if (model.choice) {
    // The picker, nothing bought; the same site again closes it.
    const detail = target.kind === 'add' ? addDetail(target) : target;
    if (shell.view.getState().selectedId === target.id) shell.view.dispatch({ type: 'cancel' });
    else shell.view.dispatch({ type: 'select', target: detail, plate: hasPlate(detail, shell.store.getSnapshot().focus) });
    return;
  }
  const research = q.locked?.code === 'research' ? q.locked.node : null;
  if (research) { shell.view.dispatch({ type: 'openResearch', project: research }); return; }
  if (purchaseReason(q)) return;
  let taps = accepted.get(shell.store);
  if (!taps) { taps = new Map(); accepted.set(shell.store, taps); }
  const key = `${target.owner.level}:${target.owner.id}:${target.id}`, now = performance.now();
  if (now - (taps.get(key) ?? -Infinity) < 250) return;
  if (shell.dispatch(q.action)?.ok) { taps.set(key, now); shell.view.dispatch({ type: 'cancel' }); }
}
