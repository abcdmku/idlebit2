// An empty CPU or board site ("Add Core 3", "Add queue", "Add RAM") as a compact plate. A tap opens it and
// never spends (user, 26 Oct); the second tap buys: the generation already on the board (or a CPU socket's copy
// of CPU 1) is the pinned main key with its consequence, the other routine generations one-line keys.
// Placed like every plate, so it never covers the site.
import type { GameAction, LevelSnapshot, PartRef, Quote, QuoteResult, SystemSnapshot } from '../../game';
import type { HitTarget } from '../../render/core';
import { calloutModel } from '../callout/model';
import { useShellOffers } from '../deck/useOffers';
import { leadAdd, useBoardPart, type BoardSlot } from './BoardPartPlate';
import { MemoryAdd } from './MemoryPart';
import { partFacts } from './partFacts';
import { OptionList, OptionRow, routine, type Option } from './OptionRow';
import { PlateFrame } from './PlateFrame';
import { QuoteKey, Status } from './widgets';
import { useShell } from '../storeHooks';
import type { PlateCommon } from './types';

export interface SitePlateProps extends Omit<PlateCommon, 'quotes'> {
  target: HitTarget;
  focus: LevelSnapshot;
  quotes: QuoteResult | null;
  /** A filled CPU socket's own view (cores, cache, queue): navigation only. */
  onOpenCpu?: () => void;
}

/**
 * A board site's part once it holds one (R16): the module or CPU its Add just installed. Its plate is then that part's,
 * in the same frame: its own quotes, never the add it was (nor a deck row's buy for another module).
 */
export function siteHolds(target: HitTarget, focus: LevelSnapshot): { slot: BoardSlot; part: PartRef } | null {
  const kind = /^(?:slot-|add:)(ram|drive|cpu)[0-9]*$/.exec(target.id)?.[1] as BoardSlot | undefined, i = target.slot ?? -1;
  if (!kind || focus.level !== 'system' || i < 0) return null;
  const n = kind === 'cpu' ? focus.cpuCount : kind === 'ram' ? focus.ram.length : focus.storage.length;
  if (i >= n) return null;
  const unit = { kind: 'system' as const, id: focus.systemId };
  return { slot: kind, part: { unit, slot: kind === 'cpu' ? { kind: 'cpu', socket: i } : { kind, index: i } } };
}

/**
 * The part an empty board site's Add will install looks like the first one of its kind (CPU 1, RAM 1, Storage 1): the
 * site measures that view at open so its frame already has room for it (R17), and holds still after the Add.
 * Only the next free site becomes its part after its Add; a farther "+" stays an add plate.
 */
export function siteProxy(target: HitTarget, focus: LevelSnapshot): { slot: BoardSlot; part: PartRef } | null {
  const kind = /^(?:slot-|add:)(ram|drive|cpu)[0-9]*$/.exec(target.id)?.[1] as BoardSlot | undefined;
  if (!kind || focus.level !== 'system') return null;
  const n = kind === 'cpu' ? focus.cpuCount : kind === 'ram' ? focus.ram.length : focus.storage.length;
  if (n === 0 || target.slot !== n) return null;
  const unit = { kind: 'system' as const, id: focus.systemId };
  return { slot: kind, part: { unit, slot: kind === 'cpu' ? { kind: 'cpu', socket: 0 } : { kind, index: 0 } } };
}

const NOUN = { ram: 'RAM', drive: 'Drive', socket: 'CPU' } as const;
type BoardAdd = keyof typeof NOUN;
const boardAdd = (q: Quote): BoardAdd | null =>
  q.action.type === 'addPart' && (q.action.kind === 'ram' || q.action.kind === 'drive' || q.action.kind === 'socket') ? q.action.kind : null;

/** One option per generation the site can take (a CPU socket has one: a copy of CPU 1). */
export function siteOptions(adds: readonly Quote[], index: number): Option[] {
  return adds.map(q => {
    const kind = boardAdd(q)!, noun = NOUN[kind];
    return kind === 'socket' ? { name: `CPU ${index + 1} · same as CPU 1`, verb: 'Add CPU', quote: q }
      : { name: `${noun} ${index + 1} · ${q.label}`, verb: 'Add', quote: q };
  });
}

export function SitePlate({ target, focus, quotes, onAction, onResearch, researchName, onOpenCpu, ...frame }: SitePlateProps) {
  const { store } = useShell();
  const m = calloutModel(target, focus, quotes, useShellOffers(), store.getState());
  const holds = siteHolds(target, focus);
  const part = useBoardPart({ active: !!holds, slot: holds?.slot ?? 'ram', focus: focus as SystemSnapshot, facts: holds ? partFacts(focus, holds.part.slot) : null,
    part: holds?.part, onOpenCpu: holds?.slot === 'cpu' ? onOpenCpu : undefined, quotes, onAction, onResearch, researchName, wide: !!frame.bounds });
  const adds = quotes?.quotes.filter(q => boardAdd(q)) ?? [];
  // A RAM or drive is always added after the last one: name it by where it goes, not by which "+" was tapped.
  const next = focus.level !== 'system' ? target.slot ?? 0 : /ram/.test(target.id) ? focus.ram.length : /drive/.test(target.id) ? focus.storage.length : target.slot ?? 0;
  const options = siteOptions(adds, next);
  // A RAM or drive site leads with the generation already on the board.
  const kind = /^(?:slot-|add:)(ram|drive)/.exec(target.id)?.[1];
  const installed = focus.level === 'system' ? (kind === 'ram' ? focus.ram : kind === 'drive' ? focus.storage : [])[0]?.generation : undefined;
  // The pinned add is the installed generation's, or else the first that improves without a loss (R16); when every
  // generation trades something away (a pooled bandwidth drop), none is pinned and each says what it costs.
  const lead = options[adds.indexOf(leadAdd(adds, installed)!)];
  const main = lead ?? options[0] ?? null;
  // Unpinned, the matching generation still comes first among the keys (the common action first).
  const rest = routine([...(lead ? [lead] : []), ...options.filter(o => o !== lead)].filter(o => o !== main));
  const q = m.offer?.quote ?? null, lock = q?.locked;
  const purchase = (action: GameAction) => {
    const before = store.getState().build.revision;
    onAction(action);
    if (!holds && store.getState().build.revision !== before) frame.onClose();
  };
  const buy = (x: Quote) => purchase(x.action);
  const row = { onAction: buy, onResearch, researchName };
  // The same frame throughout (a purchase never re-places it): the part this site now holds, else its add.
  if (part) return <PlateFrame key={part.title} {...frame} title={part.title} sub={part.sub} head={part.head} className="part site" footer={part.footer}>{part.body}</PlateFrame>;
  if (focus.level === 'system' && kind && adds.length) return <PlateFrame key={`add-${kind}`} {...frame} title={`Add ${kind === 'ram' ? 'RAM' : 'drive'}`} className="part memory-site">
    <MemoryAdd quotes={adds} preferred={lead?.quote} onAction={purchase} onResearch={onResearch} researchName={researchName} />
  </PlateFrame>;
  if (main || rest.length) return <PlateFrame {...frame} title={m.name} className="part site"
    footer={main && <OptionRow option={main} primary {...row} />}>
    {rest.some(o => o.quote.locked?.code !== 'research') && <section className="component-options">
      <OptionList options={rest.filter(o => o.quote.locked?.code !== 'research')} {...row} /></section>}
  </PlateFrame>;
  // A board site with nothing to add says why; it never offers the deck row's buy (that would act on another part).
  if (focus.level === 'system') return <PlateFrame {...frame} title={m.name} className="part site">
    <Status text={lock?.text ?? 'No free slot here'} />
  </PlateFrame>;
  return <PlateFrame {...frame} title={m.name} className="part site">
    <Status text={m.change || ' '} tone={m.research ? 'warn' : ''} />
    <div className="keys">
      {q ? <QuoteKey quote={q} label={m.change ? `Buy · ${m.change}` : 'Buy'} onAction={buy} onResearch={onResearch} researchName={researchName} />
        : <p className="key-slot">{lock?.text ?? 'Nothing to add here yet'}</p>}
    </div>
  </PlateFrame>;
}
