import type { LevelSnapshot, Quote, QuoteRequest } from '../../game';
import type { HitTarget } from '../../render/core';
import type { ShellContextValue } from '../storeHooks';
import { addDetail } from './addTap';
import { configKind, isInbound, plateRequest } from '../plates/PlateLayer';
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
}

/** Only parts without operating settings or a build choice can buy on the part itself. */
export function sourceRequest(target: HitTarget, focus: LevelSnapshot): QuoteRequest | null {
  if (target.drill || target.kind === 'save' || target.kind === 'port') return null;
  if (isInbound(target) && (focus.level === 'chip' || focus.level === 'system')) return null;
  if (target.part?.slot.kind === 'gpu' || /^(?:add:|slot-)gpu/.test(target.id)) return null;
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
      return q ? { name: SLOT_TITLE[kind], quote: q, gain: purchaseGain(q), kind: 'part' } : null;
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
      gain: purchaseGain(q), kind: 'part' } : null;
  }
  if (isInbound(target)) {
    const q = quotes[0];
    return q ? { name: focus.level === 'room' ? 'Zone link' : focus.level === 'rack' ? 'Uplink' : focus.level === 'global' ? 'Backbone' : 'Pipe',
      quote: q, gain: purchaseGain(q), kind: 'link' } : null;
  }
  if (target.kind !== 'slot' && target.kind !== 'add') return null;
  const adds = quotes.filter(q => target.id === 'add:core' || target.id === 'queue'
    ? q.action.type === 'addPart' && q.action.kind === (target.id === 'queue' ? 'scheduler' : 'core')
    : q.action.type === 'addPart' || q.action.type === 'addUnit' || q.action.type === 'installGpu');
  // Locked generations are research, not an installation choice. Keep a real picker for two available builds.
  const available = adds.filter(q => q.locked?.code !== 'research');
  const choices = available.length ? available : adds;
  if (choices.length !== 1) return null;
  const q = choices[0]!, a = q.action;
  const noun = a.type === 'addPart' ? a.kind === 'socket' ? 'CPU' : a.kind === 'scheduler' ? 'queue' : a.kind === 'drive' ? 'drive' : a.kind === 'ram' ? 'RAM' : a.kind
    : a.type === 'addUnit' ? ({ system: 'server', rack: 'rack', room: 'zone', site: 'site' }[configKind(focus.level, a.parent) ?? 'system']) : 'GPU';
  const gain = a.type === 'addPart' && a.kind === 'socket' ? '=CPU1'
    : a.type === 'addPart' && a.kind === 'core' ? '+1 core'
    : q.effect ? measureUnit(q.effect.capacityAfter - q.effect.capacityBefore, q.effect.unit) : '';
  return { name: `Add ${noun}`, quote: q, gain, kind: 'add' };
}

type Shell = Pick<ShellContextValue, 'quote' | 'store' | 'view' | 'dispatch'>;
export function actionAtSource(shell: Shell, target: HitTarget): SourceAction | null {
  const focus = shell.store.getSnapshot().focus, request = sourceRequest(target, focus);
  return request ? sourceAction(target, focus, shell.quote(request).quotes) : null;
}

const accepted = new WeakMap<Shell['store'], Map<string, number>>();
/** Re-quote at the tap. A disabled source never opens an explanation popup. */
export function runSourceAction(shell: Shell, target: HitTarget): void {
  const q = actionAtSource(shell, target)?.quote;
  if (!q) return;
  const research = q.locked?.code === 'research' ? q.locked.node : null;
  if (research) { shell.view.dispatch({ type: 'openResearch', project: research }); return; }
  if (purchaseReason(q)) return;
  let taps = accepted.get(shell.store);
  if (!taps) { taps = new Map(); accepted.set(shell.store, taps); }
  const key = `${target.owner.level}:${target.owner.id}:${target.id}`, now = performance.now();
  if (now - (taps.get(key) ?? -Infinity) < 250) return;
  if (shell.dispatch(q.action)?.ok) { taps.set(key, now); shell.view.dispatch({ type: 'cancel' }); }
}
