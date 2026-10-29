import type { CSSProperties, ReactNode } from 'react';
import type { FilterId, LbView, Quote, RouteStrategyId, ScopeRef } from '../../game';
import { ROUTER_QUEUE_MAX } from '../../game';
import { typeColor, typeOf } from '../../render/core';
import { useWindowLeft } from '../hooks/headClock';
import { clockText } from '../hooks/format';
import { FILTER_NAMES, ROUTE_NAMES } from './copy';
import { PlateFrame } from './PlateFrame';
import { Choices, QuoteKey, Status, type Choice, type Line } from './widgets';
import type { PlateCommon } from './types';
import { ChoiceStrip } from './ChoiceStrip';

export type LbChild = 'server' | 'rack' | 'zone' | 'site';
export interface LbBodyProps extends Pick<PlateCommon, 'quotes' | 'onAction' | 'onResearch' | 'researchName'> {
  unit: ScopeRef;
  view: LbView;
  /** What the balancer routes to: "server" in a rack, "rack" in a room. */
  child?: LbChild;
  /** `quote({ kind: 'routerQueue', unit })`: the next queue slot (D25.7), or null before it loads. */
  queueQuote?: Quote | null;
  children?: ReactNode;
}

/** The router queue's ladder top (D25.7). */
export const QUEUE_MAX = ROUTER_QUEUE_MAX;

const lockText = (q: Quote | undefined) => (q?.locked ? q.locked.text : null);

export function lbLines(view: LbView, _child: LbChild): Line[] {
  const s = ROUTE_NAMES[view.strategy];
  const lines: Line[] = [];
  if (s.blind && !view.filters.includes('capability')) lines.push({ text: 'May misroute tasks', tone: 'warn' });
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
    <span className="k">Queue</span><b className="v">{used}/{q.slots}</b>
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
export function LbBody({ unit, view, quotes, queueQuote, onAction, onResearch, researchName, children }: LbBodyProps) {
  const qs = quotes?.quotes ?? [];
  const strategies = qs.filter((q): q is Quote & { action: { type: 'setStrategy'; strategy: RouteStrategyId } } => q.action.type === 'setStrategy');
  const filters = qs.filter((q): q is Quote & { action: { type: 'setFilter'; filter: FilterId } } => q.action.type === 'setFilter');
  const strategyIds: RouteStrategyId[] = strategies.length ? strategies.map((q) => q.action.strategy) : [view.strategy];
  const rows: Choice[] = [
    ...strategyIds.map((id) => ({ id: 's:' + id, label: ROUTE_NAMES[id].name, on: id === view.strategy,
      lock: id === view.strategy ? null : lockText(strategies.find((q) => q.action.strategy === id)) })),
    ...filters.map((q) => ({ id: 'f:' + q.action.filter, label: FILTER_NAMES[q.action.filter].name.replace(/-aware$/, '').replace(' checks', ''),
      on: view.filters.includes(q.action.filter), lock: lockText(q) })),
  ];
  const pick = (key: string) => {
    const [k, id] = [key.slice(0, 1), key.slice(2)];
    if (k === 's') onAction({ type: 'setStrategy', unit, strategy: id as RouteStrategyId });
    if (k === 'f') onAction({ type: 'setFilter', unit, filter: id as FilterId, on: !view.filters.includes(id as FilterId) });
  };
  const level = view.queue.level, max = level >= QUEUE_MAX, capacity = qs.find((q) => q.action.type === 'upgradePart');
  return <>
    <div className="keys">
      {queueQuote && !max && <QuoteKey quote={queueQuote} label={max ? `Queue ${level} · max` : `Queue ${level} → ${level + 1}`}
        onAction={(q) => onAction(q.action)} onResearch={onResearch} researchName={researchName} />}
      {capacity && capacity.locked?.code !== 'ceiling' && <QuoteKey quote={capacity} label={`Capacity${capacity.effect ? ` · ${Math.round(capacity.effect.capacityAfter)}/s` : ''}`} onAction={(q) => onAction(q.action)} onResearch={onResearch} researchName={researchName} />}
    </div>
    <section className="routing-controls"><LbQueue view={view} />
      <ChoiceStrip label="Routing strategy" value={'s:' + view.strategy} onPick={pick}
        choices={rows.filter(r => r.id.startsWith('s:')).map(row => ({ id: row.id, label: row.label, disabled: !!row.lock, title: row.lock ?? undefined }))} />
      <div className="filter-options"><Choices rows={rows.filter(r => r.id.startsWith('f:'))} label="Filters" onPick={pick} /></div>{children}</section>
  </>;
}

/** Load balancers have no routing capacity (D12.5); the plate reports routes taken. */
export function lbStatus(view: LbView) {
  const warning = lbLines(view, 'server')[0]?.text;
  return { text: `${Math.round(view.routedPerSec)} routed/s${warning ? ' · ' + warning : ''}`, tone: warning ? 'warn' as const : '' as const, progress: null };
}

export interface LbPlateProps extends PlateCommon { unit: ScopeRef; view: LbView; child?: LbChild; title?: string; queueQuote?: Quote | null; children?: ReactNode }

/** The rack load balancer plate (mockup rack/econ.js lbSpec): its strategy, filters and queue. */
export function LbPlate({ unit, view, child = 'server', title = 'Load balancer', queueQuote, quotes, onAction, onResearch, researchName, children, ...frame }: LbPlateProps) {
  const st = lbStatus(view);
  return <PlateFrame {...frame} title={title} sub={ROUTE_NAMES[view.strategy].name} className="lb">
    <Status text={st.text} tone={st.tone} progress={st.progress} />
    <LbBody unit={unit} view={view} child={child} quotes={quotes} queueQuote={queueQuote}
      onAction={onAction} onResearch={onResearch} researchName={researchName}>{children}</LbBody>
  </PlateFrame>;
}
