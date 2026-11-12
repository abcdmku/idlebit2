import { Fragment, type CSSProperties, type ReactNode } from 'react';
import type { FilterId, LbView, Quote, RouteStrategyId, ScopeRef } from '../../game';
import { ROUTER_QUEUE_MAX } from '../../game';
import { typeColor, typeOf } from '../../render/core';
import { useWindowLeft } from '../hooks/headClock';
import { clockText } from '../hooks/format';
import { FILTER_NAMES, ROUTE_NAMES, filterEffect, filterInScope, routeEffect, routeInScope, type RouteChild } from './copy';
import { shortCount } from './format';
import { LockIcon } from './icons';
import { PlateFrame } from './PlateFrame';
import { LockableStrip, offered } from './QueueControls';
import { QuoteKey } from './widgets';
import type { PlateCommon } from './types';

export type LbChild = RouteChild;
export interface LbBodyProps extends Pick<PlateCommon, 'quotes' | 'onAction' | 'onResearch' | 'researchName'> {
  unit: ScopeRef;
  view: LbView;
  /** What the balancer routes to: "server" in a rack, "rack" in a room. */
  child?: LbChild;
  /** `quote({ kind: 'routerQueue', unit })`: the next queue slot (D25.7), or null before it loads. */
  queueQuote?: Quote | null;
  children?: ReactNode;
}

type StrategyQuote = Quote & { action: { type: 'setStrategy'; strategy: RouteStrategyId } };
type FilterQuote = Quote & { action: { type: 'setFilter'; filter: FilterId } };

/**
 * The router's measured result, the feedback for its strategy and filters: shares routed per second, misroutes
 * this round, and its queue (D25.7), one well per slot in the queued task's type colour. Two fixed rows.
 */
export function LbResult({ view }: { view: LbView }) {
  const q = view.queue, used = q.entries.length, missed = view.misroutesThisRound;
  // D26.5: a queued task's completion window runs from take; the soonest one due is what matters.
  const due = q.entries.reduce<number | null>((m, e) => (e.windowEndTick === null ? m : m === null ? e.windowEndTick : Math.min(m, e.windowEndTick)), null);
  return <div className="route-result" data-testid="lb-result">
    <p className="p-status"><b>{shortCount(Math.round(view.routedPerSec))}</b> routed/s · <span className={missed > 0 ? 'warn' : ''}><b>{shortCount(missed)}</b> misrouted this round</span></p>
    <div className="lb-queue" data-testid="lb-queue">
      <span>Queue <b>{used}/{q.slots}</b></span>
      <span className="lb-wells" aria-label={`${used} of ${q.slots} queue slots used`}>
        {Array.from({ length: q.slots }, (_, i) => {
          const e = q.entries[i];
          return <i key={i} className={e ? 'on' : ''} style={e ? { '--well': typeColor(typeOf(e.family)) } as CSSProperties : undefined} />;
        })}
      </span>
      {due !== null && <DueIn endTick={due} />}
    </div>
  </div>;
}

/** "Next due 1:42" for the queued task whose completion window ends first; warning under 30 s. */
function DueIn({ endTick }: { endTick: number }) {
  const left = useWindowLeft(endTick);
  if (left === null) return null;
  return <span className={`lb-due ${left <= 30 ? 'warn' : 'mute'}`} data-testid="lb-due">Next due {clockText(left * 1000)}</span>;
}

/** A name that wraps only between its words, never at a hyphen. */
const words = (name: string): ReactNode => <span>{name.split(' ').map((w, i) => <Fragment key={i}>{i > 0 && ' '}<span className="word">{w}</span></Fragment>)}</span>;

/**
 * The router's result, its next queue slot, then its strategy (pick one, with what the choice does) and filters
 * (toggles, each with its requirement). Only options that act at this scope are offered (spec §8.3, §8.4).
 */
export function LbBody({ unit, view, child = 'server', quotes, queueQuote, onAction, onResearch, researchName, children }: LbBodyProps) {
  const qs = quotes?.quotes ?? [];
  const strategies = offered(qs.filter((q): q is StrategyQuote => q.action.type === 'setStrategy')
    .filter(q => routeInScope(q.action.strategy, child) || q.action.strategy === view.strategy), q => q.action.strategy === view.strategy);
  const filters = offered(qs.filter((q): q is FilterQuote => q.action.type === 'setFilter')
    .filter(q => filterInScope(q.action.filter, child) || view.filters.includes(q.action.filter)), q => view.filters.includes(q.action.filter));
  const level = view.queue.level, capacity = qs.find((q) => q.action.type === 'upgradePart');
  const keys = { onAction: (q: Quote) => onAction(q.action), onResearch, researchName };
  return <div className="lb-box"><div className="lb-body">
    <LbResult view={view} />
    <div className="keys">
      {queueQuote && <QuoteKey quote={queueQuote} label={level >= ROUTER_QUEUE_MAX ? `Queue ${level}` : `Queue ${level} → ${level + 1} slots`} detail="" {...keys} />}
      {capacity && capacity.locked?.code !== 'ceiling' && <QuoteKey quote={capacity} label={`Capacity${capacity.effect ? ` · ${Math.round(capacity.effect.capacityAfter)}/s` : ''}`} {...keys} />}
    </div>
    <section className="routing-controls">
      <LockableStrip label="Routing strategy" className="route-strategies" value={view.strategy} onResearch={onResearch}
        options={(strategies.length ? strategies.map(q => ({ id: q.action.strategy, lock: q.locked })) : [{ id: view.strategy, lock: null }])
          .map(o => ({ ...o, label: words(ROUTE_NAMES[o.id].name), name: ROUTE_NAMES[o.id].name }))}
        onPick={strategy => onAction({ type: 'setStrategy', unit, strategy })} />
      <p className="route-effect" aria-live="polite" data-testid="route-effect">{routeEffect(view.strategy, child)}</p>
      {filters.length > 0 && <div className="filter-options" role="group" aria-label="Filters">
        {filters.map(q => {
          const id = q.action.filter, on = view.filters.includes(id), lock = on ? null : q.locked;
          const name = FILTER_NAMES[id].name.replace(/-aware$/, '').replace(' checks', '');
          return <button key={id} type="button" className={`route-filter${on ? ' on' : ''}${lock ? ' lock' : ''}`} role={lock ? undefined : 'switch'} aria-checked={lock ? undefined : on}
            aria-label={lock ? `${name}, locked. Open research` : `${name}: ${filterEffect(id, child)}`} disabled={!!lock && (!lock.node || !onResearch)}
            onClick={() => lock ? lock.node && onResearch?.(lock.node) : onAction({ type: 'setFilter', unit, filter: id, on: !on })}>
            {lock ? <LockIcon /> : <u />}<span><b>{name}</b><small>{filterEffect(id, child)}</small></span>
          </button>;
        })}
      </div>}
    </section>
    {children}
  </div></div>;
}

export interface LbPlateProps extends PlateCommon { unit: ScopeRef; view: LbView; child?: LbChild; title?: string; sub?: string; queueQuote?: Quote | null; /** Keys beside Close (the global scheduler's start controller). */ actions?: ReactNode; children?: ReactNode }

/** A router's plate (rack and room load balancers, the global scheduler): its result, queue, strategy and filters. */
export function LbPlate({ unit, view, child = 'server', title = 'Load balancer', sub, queueQuote, quotes, onAction, onResearch, researchName, children, ...frame }: LbPlateProps) {
  return <PlateFrame {...frame} title={title} sub={sub} className="lb">
    <LbBody unit={unit} view={view} child={child} quotes={quotes} queueQuote={queueQuote}
      onAction={onAction} onResearch={onResearch} researchName={researchName}>{children}</LbBody>
  </PlateFrame>;
}
