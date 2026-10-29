import type { ReactNode } from 'react';
import type { PartRef, Quote, SystemSnapshot } from '../../game';
import { hertz } from './format';
import { PartKeys, partMain } from './PartKeys';
import { PlateFrame } from './PlateFrame';
import type { PartFacts } from './partFacts';
import type { PlateCommon } from './types';
import { memoryPartView } from './MemoryPart';

export type BoardSlot = 'cpu' | 'ram' | 'drive';
export function leadAdd(adds: readonly Quote[], installed?: number): Quote | undefined {
  const open = (q: Quote) => !q.locked || q.locked.code === 'power';
  return adds.find(q => open(q) && q.action.type === 'addPart' && q.action.generation === installed) ?? [...adds].reverse().find(open) ?? adds[0];
}
export interface BoardPartPlateProps extends PlateCommon {
  slot: BoardSlot; part: PartRef; focus: SystemSnapshot; facts: PartFacts;
  onOpenCpu?: () => void; unblocks?: number; unblock?: Quote | null;
}
export interface BoardPartView { readonly title: string; readonly sub: string; readonly head: ReactNode; readonly footer: ReactNode; readonly body: ReactNode }
export function useBoardPart({ active, slot, part, focus, facts, onOpenCpu, quotes, onAction, onResearch, researchName }:
  Omit<BoardPartPlateProps, 'part' | 'facts' | 'onClose' | 'bounds'> & { part?: PartRef; active: boolean; facts: PartFacts | null; wide: boolean }): BoardPartView | null {
  if (!active || !facts) return null;
  if (slot !== 'cpu') {
    const module = (slot === 'ram' ? focus.ram : focus.storage)[part && 'index' in part.slot ? part.slot.index : 0];
    return module ? memoryPartView({ module, slot, facts, own: quotes?.quotes ?? [], onAction, onResearch, researchName }) : null;
  }
  // A CPU package never sells a clock, another socket or another board component.
  const own = quotes ? { ...quotes, quotes: quotes.quotes.filter(q => q.action.type === 'replaceCpu'
    || (q.action.type === 'upgradePart' || q.action.type === 'replacePart') && q.action.part.slot.kind === 'cpu') } : null;
  const keys = { quotes: own, level: facts.level, onAction, onResearch, researchName };
  return { title: facts.title, sub: hertz(focus.chip.clock.hz) + ' · ' + focus.chip.cores.length + ' cores',
    head: onOpenCpu && <button type="button" className="key ghost open-cpu" onClick={onOpenCpu}>Open CPU</button>,
    footer: partMain(own?.quotes ?? [], facts.level) && <PartKeys {...keys} part="primary" />,
    body: <PartKeys {...keys} part="rest" /> };
}
export function BoardPartPlate(props: BoardPartPlateProps) {
  const { slot: _s, part: _p, focus: _f, facts: _x, onOpenCpu: _o, quotes: _q, unblock: _u, unblocks: _n, onAction: _a, onResearch: _r, researchName: _rn, ...frame } = props;
  const v = useBoardPart({ ...props, active: true, wide: !!props.bounds })!;
  return <PlateFrame {...frame} title={v.title} sub={v.sub} head={v.head} className="part board-part" footer={v.footer}>{v.body}</PlateFrame>;
}
