// A CPU, RAM module or drive on the System board (user, 26 Oct): a tap opens its options and spends nothing; each
// option is its own priced key, so the second tap buys (one or two taps from play). The main option (Upgrade, the
// CPU's being its clock) is pinned with its full consequence; Add (another module or CPU), Replace (a newer
// generation) and the other routine generations are one-line keys. The CPU also opens its own view, on request.
import type { ReactNode } from 'react';
import type { PartRef, Quote, QuoteRequest, SystemSnapshot } from '../../game';
import { useQuote } from '../storeHooks';
import { MeetKey } from '../queue/MeetKey';
import { hertz } from './format';
import { partQuotes } from './PartKeys';
import { eccToDo, improves, OptionList, OptionRow, perGeneration, routine, sameGeneration, type Option } from './OptionRow';
import { PlateFrame } from './PlateFrame';
import type { PartFacts } from './partFacts';
import type { PlateCommon } from './types';
import { Lines } from './widgets';

export type BoardSlot = 'cpu' | 'ram' | 'drive';
const NOUN: Record<BoardSlot, string> = { cpu: 'CPU', ram: 'RAM', drive: 'Drive' };

/** The empty slot an Add fills: the next socket, DIMM or drive bay (the sim quotes its add per generation). */
export function addRequest(focus: SystemSnapshot, slot: BoardSlot): QuoteRequest {
  const unit = { kind: 'system' as const, id: focus.systemId };
  return { kind: 'part', part: { unit, slot: slot === 'cpu' ? { kind: 'cpu', socket: focus.cpuCount }
    : { kind: slot, index: slot === 'ram' ? focus.ram.length : focus.storage.length } } };
}

/**
 * The add a plate leads with: the generation already on the board (the cheap, matching module), else the
 * newest generation research has opened, else the first.
 */
export function leadAdd(adds: readonly Quote[], installed?: number): Quote | undefined {
  const open = (q: Quote) => q.locked?.code !== 'research';
  return adds.find(q => open(q) && q.action.type === 'addPart' && q.action.generation === installed) ?? [...adds].reverse().find(open) ?? adds[0];
}

const genOf = (q: Quote) => (q.label ?? '').replace(/^Replace CPU · /, '');

/**
 * The part's options: the leads (ECC first when the line waits on it, Upgrade, Add, Replace) and the routine other
 * generations, from the part's, the clock's and the empty slot's quotes. `main` is the plate's one main action.
 */
export function boardOptions(slot: BoardSlot, n: number, own: readonly Quote[], clock: readonly Quote[], adds: readonly Quote[], eccFirst: boolean, installed?: number): {
  main: Option | null; rest: Option[];
} {
  const { upgrade: partUp, replace, replaces } = partQuotes(own);
  const upgrade = slot === 'cpu' ? clock.find(q => q.action.type === 'upgradePart') : partUp;
  const add = leadAdd(adds, installed), ecc = own.find(eccToDo);
  const noun = NOUN[slot], addVerb = slot === 'cpu' ? 'Add CPU' : 'Add';
  const leads: Option[] = [];
  if (ecc && eccFirst) leads.push({ name: 'on all RAM', verb: 'Enable ECC', quote: ecc });
  if (upgrade) leads.push({ name: slot === 'cpu' ? `Clock · ${upgrade.label}` : upgrade.label ?? 'Next level', verb: 'Upgrade', quote: upgrade });
  if (add) leads.push({ name: slot === 'cpu' ? `CPU ${n + 1} · same as CPU 1` : `${noun} ${n + 1} · ${add.label}`, verb: addVerb, quote: add });
  if (replace) leads.push({ name: genOf(replace), verb: 'Replace', quote: replace });
  const others: Option[] = [
    ...perGeneration(replaces).filter(q => !sameGeneration(q, replace)).map(q => ({ name: genOf(q), verb: 'Replace', quote: q })),
    ...adds.filter(q => q !== add).map(q => ({ name: `${noun} ${n + 1} · ${q.label}`, verb: addVerb, quote: q })),
    ...(ecc && !eccFirst ? [{ name: 'on all RAM', verb: 'Enable ECC', quote: ecc }] : []),
  ];
  // R16: the pinned main option is the first lead that improves without a loss; a dead Max (its ceiling) is not a
  // key at all, and a trade-off or an over-supply step stays an ordinary key with its losses shown. One key per
  // generation, one Research key per plate.
  const main = leads.find(o => improves(o.quote)) ?? null;
  return { main, rest: routine(slot === 'cpu'
    ? [...leads.filter(o => o !== main && o.quote.locked?.code !== 'ceiling'), ...others]
    : [...leads.filter(o => o !== main), ...others].filter(o => o.quote.locked?.code !== 'ceiling' && o.quote.locked?.code !== 'cap')) };
}

export interface BoardPartPlateProps extends PlateCommon {
  slot: BoardSlot;
  part: PartRef;
  focus: SystemSnapshot;
  facts: PartFacts;
  /** The CPU's own view (cores, cache, queue): navigation only. */
  onOpenCpu?: () => void;
  unblocks?: number;
  unblock?: Quote | null;
}

/** A board part's plate content, apart from its frame, so an add site can become the part it added in place. */
export interface BoardPartView { readonly title: string; readonly sub: string; readonly head: ReactNode; readonly footer: ReactNode; readonly body: ReactNode }

/**
 * The content of a CPU, RAM module or drive plate. `active` false asks nothing and returns null (an empty site that
 * may become this part after its Add keeps calling the same hooks).
 */
export function useBoardPart({ active, slot, focus, facts, onOpenCpu, quotes, unblock, unblocks = 0, onAction, onResearch, researchName, wide }:
  Omit<BoardPartPlateProps, 'part' | 'facts' | 'onClose' | 'bounds'> & { active: boolean; facts: PartFacts | null; wide: boolean }): BoardPartView | null {
  const unit = { kind: 'system' as const, id: focus.systemId };
  const clock = useQuote(active && slot === 'cpu' ? { kind: 'part', part: { unit, slot: { kind: 'clock', socket: 0 } } } : null);
  const adds = useQuote(active ? addRequest(focus, slot) : null);
  if (!active || !facts) return null;
  const n = slot === 'cpu' ? focus.cpuCount : slot === 'ram' ? focus.ram.length : focus.storage.length;
  const eccFirst = unblock?.action.type === 'convertRamToEcc';
  const { main, rest } = boardOptions(slot, n, quotes?.quotes ?? [], clock?.quotes ?? [], adds?.quotes.filter(q => q.action.type === 'addPart') ?? [], eccFirst,
    (slot === 'ram' ? focus.ram : slot === 'drive' ? focus.storage : [])[0]?.generation);
  const buy = (q: Quote) => onAction(q.action);
  const row = { onAction: buy, onResearch, researchName };
  const cores = focus.chip.cores.length;
  const lines = slot === 'cpu'
    ? [{ text: `${hertz(focus.chip.clock.hz)} · ${cores} ${cores === 1 ? 'core' : 'cores'} × ${focus.cpuCount}`, tone: 'muted' as const }] : facts.lines;
  // Open CPU is navigation, so it sits in the head and leaves the body to the options.
  const head = onOpenCpu && <button type="button" className="key ghost open-cpu" aria-label="Open CPU: cores, cache and queue"
    onClick={(e) => { e.stopPropagation(); onOpenCpu(); }}>Open CPU</button>;
  return { title: facts.title, sub: `${facts.sub} · ${facts.status}`, head,
    footer: main && <OptionRow option={main} primary {...row} />,
    body: <>
      <Lines lines={lines} slots={onOpenCpu ? 1 : slot === 'ram' ? 2 : 1} />
      {unblock && !eccFirst && <div className="keys"><MeetKey quote={unblock} n={wide ? 3 : 2} onAction={onAction} onResearch={onResearch} researchName={researchName} /></div>}
      {unblocks > 0 && <p className="p-hint payback">Needed by {unblocks} queued {unblocks === 1 ? 'task' : 'tasks'}</p>}
      <OptionList options={rest} {...row} />
    </> };
}

export function BoardPartPlate(props: BoardPartPlateProps) {
  const { slot: _s, part: _p, focus: _f, facts: _x, onOpenCpu: _o, quotes: _q, unblock: _u, unblocks: _n, onAction: _a, onResearch: _r, researchName: _rn, ...frame } = props;
  const v = useBoardPart({ ...props, active: true, wide: !!props.bounds })!;
  return <PlateFrame {...frame} title={v.title} sub={v.sub} head={v.head} className="part board-part" footer={v.footer}>{v.body}</PlateFrame>;
}
