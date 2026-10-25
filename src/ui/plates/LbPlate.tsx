import type { CSSProperties, ReactNode } from 'react';
import type { FilterId, LbView, Quote, RouteStrategyId, ScopeRef } from '../../game';
import { typeColor, typeOf } from '../../render/core';
import { useWindowLeft } from '../hooks/headClock';
import { clockText } from '../hooks/format';
import { FILTER_NAMES, ROUTE_NAMES } from './copy';
import { PlateFrame } from './PlateFrame';
import { Choices, Lines, QuoteKey, Status, type Choice, type Line } from './widgets';
import type { PlateCommon } from './types';

export type LbChild = 'server' | 'rack' | 'zone' | 'site';
export interface LbBodyProps extends Pick<PlateCommon, 'quotes' | 'onAction' | 'onResearch' | 'researchName'> {
  unit: ScopeRef;
  view: LbView;
  /** What the balancer routes to: "server" in a rack, "rack" in a room. */
  child?: LbChild;
  /** `quote({ kind: 'routerQueue', unit })`: the next queue slot (D25.7), or null before it loads. */
  queueQuote?: Quote | null;
}

/** The router queue's ladder top (D25.7). */
export const QUEUE_MAX = 32;

const lockText = (q: Quote | undefined) => (q?.locked ? q.locked.text : null);

export function lbLines(view: LbView, child: LbChild): Line[] {
  const s = ROUTE_NAMES[view.strategy], Child = child[0].toUpperCase() + child.slice(1);
  const lines: Line[] = [{ text: view.strategy === 'firstFit' ? `${Child} 1 first; if full, ${child} 2, and so on.` : s.note, tone: 'ben' }];
  if (s.blind && !view.filters.includes('capability')) lines.push({ text: `Capability-blind: a task can land on a ${child} that cannot run it`, tone: 'warn' });
  else if (view.misroutesThisRound > 0) lines.push({ text: `${view.misroutesThisRound} misrouted this round`, tone: 'warn' });
  return lines;
}

/**
 * The router queue (D25.7): tasks taken but not yet dispatched, one well per slot, each filled in its
 * task type's colour. A task in here is picked up: its clock has stopped.
 */
export function LbQueue({ view }: { view: LbView }) {
  const q = view.queue, used = q.entries.length;
  // D26.5: a queued task's completion window runs from take; the soonest one due is what matters.
  const due = q.entries.reduce<number | null>((m, e) => (e.windowEndTick === null ? m : m === null ? e.windowEndTick : Math.min(m, e.windowEndTick)), null);
  return <div className="lb-queue" data-testid="lb-queue">
    <span className="k">Queue</span><b className="v">{used}/{q.slots}</b><span className="mute">L{q.level}/{QUEUE_MAX}</span>
    <span className="lb-wells" aria-label={`${used} of ${q.slots} queue slots used`}>
      {Array.from({ length: q.slots }, (_, i) => {
        const e = q.entries[i];
        return <i key={i} className={e ? 'on' : ''} style={e ? { '--well': typeColor(typeOf(e.family)) } as CSSProperties : undefined} />;
      })}
    </span>
    {due !== null && <DueIn endTick={due} />}
  </div>;
}

/** "Next due 1:42" for the queued task whose completion window ends first; warning under 30 s. */
function DueIn({ endTick }: { endTick: number }) {
  const left = useWindowLeft(endTick);
  if (left === null) return null;
  return <span className={left <= 30 ? 'warn' : 'mute'} data-testid="lb-due">Next due {clockText(left * 1000)}</span>;
}

/** Strategy (pick one) and filters (toggles), each locked by research; the router queue and its next slot. */
export function LbBody({ unit, view, quotes, queueQuote, onAction, onResearch, researchName }: LbBodyProps) {
  const qs = quotes?.quotes ?? [];
  const strategies = qs.filter((q): q is Quote & { action: { type: 'setStrategy'; strategy: RouteStrategyId } } => q.action.type === 'setStrategy');
  const filters = qs.filter((q): q is Quote & { action: { type: 'setFilter'; filter: FilterId } } => q.action.type === 'setFilter');
  const strategyIds: RouteStrategyId[] = strategies.length ? strategies.map((q) => q.action.strategy) : [view.strategy];
  const rows: Choice[] = [
    ...strategyIds.map((id) => ({ id: 's:' + id, label: ROUTE_NAMES[id].name, on: id === view.strategy,
      lock: id === view.strategy ? null : lockText(strategies.find((q) => q.action.strategy === id)) })),
    ...filters.map((q) => ({ id: 'f:' + q.action.filter, label: FILTER_NAMES[q.action.filter].name,
      on: view.filters.includes(q.action.filter), lock: lockText(q) })),
  ];
  const pick = (key: string) => {
    const [k, id] = [key.slice(0, 1), key.slice(2)];
    if (k === 's') onAction({ type: 'setStrategy', unit, strategy: id as RouteStrategyId });
    if (k === 'f') onAction({ type: 'setFilter', unit, filter: id as FilterId, on: !view.filters.includes(id as FilterId) });
  };
  const level = view.queue.level, max = level >= QUEUE_MAX, capacity = qs.find((q) => q.action.type === 'upgradePart');
  return <>
    <LbQueue view={view} />
    <div className="keys">
      {queueQuote && <QuoteKey quote={queueQuote} label={max ? `Queue ${level} · max` : `Queue ${level} → ${level + 1}`}
        onAction={(q) => onAction(q.action)} onResearch={onResearch} researchName={researchName} />}
      {capacity && <QuoteKey quote={capacity} label={`Capacity${capacity.effect ? ` · ${Math.round(capacity.effect.capacityAfter)} a second` : ''}`} onAction={(q) => onAction(q.action)} onResearch={onResearch} researchName={researchName} />}
    </div>
    <Choices rows={rows} label="Routing" onPick={pick} />
  </>;
}

/** Load balancers have no routing capacity (D12.5); the plate reports routes taken. */
export function lbStatus(view: LbView) {
  return { text: `${Math.round(view.routedPerSec)} routing decisions a second`, progress: view.routedPerSec > 0 ? 1 : 0 };
}

export interface LbPlateProps extends PlateCommon { unit: ScopeRef; view: LbView; child?: LbChild; title?: string; queueQuote?: Quote | null; children?: ReactNode }

/** The rack load balancer plate (mockup rack/econ.js lbSpec): its strategy, filters and queue. */
export function LbPlate({ unit, view, child = 'server', title = 'Load balancer', queueQuote, quotes, onAction, onResearch, researchName, children, ...frame }: LbPlateProps) {
  const st = lbStatus(view);
  return <PlateFrame {...frame} title={title} sub={`${ROUTE_NAMES[view.strategy].name} · queue ${view.queue.level}/${QUEUE_MAX}`} className="lb">
    <Status text={st.text} progress={st.progress} />
    <Lines lines={lbLines(view, child)} slots={2} />
    <LbBody unit={unit} view={view} child={child} quotes={quotes} queueQuote={queueQuote}
      onAction={onAction} onResearch={onResearch} researchName={researchName} />
    {children}
  </PlateFrame>;
}
