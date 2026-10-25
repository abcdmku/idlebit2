import type { FilterId, LbView, PlacementId, Quote, RouteStrategyId, ScopeRef } from '../../game';
import { FILTER_NAMES, PLACEMENT_NAMES, ROUTE_NAMES } from './copy';
import { PlateFrame } from './PlateFrame';
import { Choices, Lines, QuoteKey, Status, type Choice, type Line } from './widgets';
import type { PlateCommon } from './types';

export type LbChild = 'server' | 'rack' | 'zone' | 'site';
export interface LbBodyProps extends Pick<PlateCommon, 'quotes' | 'onAction' | 'onResearch' | 'researchName'> {
  unit: ScopeRef;
  view: LbView;
  /** What the balancer routes to: "server" in a rack, "rack" in a room. */
  child?: LbChild;
}

const lockText = (q: Quote | undefined) => (q?.locked ? q.locked.text : null);

export function lbLines(view: LbView, child: LbChild): Line[] {
  const s = ROUTE_NAMES[view.strategy], Child = child[0].toUpperCase() + child.slice(1);
  const lines: Line[] = [{ text: view.strategy === 'firstFit' ? `${Child} 1 first; if full, ${child} 2, and so on.` : s.note, tone: 'ben' }];
  if (s.blind && !view.filters.includes('capability')) lines.push({ text: `Capability-blind: a task can land on a ${child} that cannot run it`, tone: 'warn' });
  else if (view.misroutesThisRound > 0) lines.push({ text: `${view.misroutesThisRound} misrouted this round`, tone: 'warn' });
  return lines;
}

/** Strategy (pick one), filters and placements (toggles), each locked by research; capacity upgrade. */
export function LbBody({ unit, view, quotes, onAction, onResearch, researchName }: LbBodyProps) {
  const qs = quotes?.quotes ?? [];
  const strategies = qs.filter((q): q is Quote & { action: { type: 'setStrategy'; strategy: RouteStrategyId } } => q.action.type === 'setStrategy');
  const filters = qs.filter((q): q is Quote & { action: { type: 'setFilter'; filter: FilterId } } => q.action.type === 'setFilter');
  const placements = qs.filter((q): q is Quote & { action: { type: 'setPlacement'; mode: PlacementId } } => q.action.type === 'setPlacement');
  const strategyIds: RouteStrategyId[] = strategies.length ? strategies.map((q) => q.action.strategy) : [view.strategy];
  const rows: Choice[] = [
    ...strategyIds.map((id) => ({ id: 's:' + id, label: ROUTE_NAMES[id].name, on: id === view.strategy,
      lock: id === view.strategy ? null : lockText(strategies.find((q) => q.action.strategy === id)) })),
    ...filters.map((q) => ({ id: 'f:' + q.action.filter, label: FILTER_NAMES[q.action.filter].name,
      on: view.filters.includes(q.action.filter), lock: lockText(q) })),
    ...placements.map((q) => ({ id: 'p:' + q.action.mode, label: PLACEMENT_NAMES[q.action.mode],
      on: view.placements.includes(q.action.mode), lock: lockText(q) })),
  ];
  const pick = (key: string) => {
    const [k, id] = [key.slice(0, 1), key.slice(2)];
    if (k === 's') onAction({ type: 'setStrategy', unit, strategy: id as RouteStrategyId });
    if (k === 'f') onAction({ type: 'setFilter', unit, filter: id as FilterId, on: !view.filters.includes(id as FilterId) });
    if (k === 'p') onAction({ type: 'setPlacement', unit, mode: id as PlacementId, on: !view.placements.includes(id as PlacementId) });
  };
  const capacity = qs.find((q) => q.action.type === 'upgradePart');
  return <>
    <Choices rows={rows} label="Routing" onPick={pick} />
    <div className="keys">
      {capacity && <QuoteKey quote={capacity}
        label={`Capacity${capacity.effect ? ` · ${Math.round(capacity.effect.capacityAfter)} a second` : ''}`}
        onAction={(q) => onAction(q.action)} onResearch={onResearch} researchName={researchName} />}
    </div>
  </>;
}

/** Load balancers have no routing capacity (D12.5); the plate reports routes taken. */
export function lbStatus(view: LbView) {
  return { text: `${Math.round(view.routedPerSec)} routing decisions a second`, progress: view.routedPerSec > 0 ? 1 : 0 };
}

export interface LbPlateProps extends PlateCommon { unit: ScopeRef; view: LbView; child?: LbChild; title?: string; maxLevel?: number }

/** The rack load balancer plate (mockup rack/econ.js lbSpec). */
export function LbPlate({ unit, view, child = 'server', title = 'Load balancer', maxLevel = 8, quotes, onAction, onResearch, researchName, ...frame }: LbPlateProps) {
  const st = lbStatus(view);
  return <PlateFrame {...frame} title={title} sub={`${ROUTE_NAMES[view.strategy].name} · L${view.level}`}
    pips={[Math.min(maxLevel, view.level), maxLevel]} className="lb">
    <Status text={st.text} progress={st.progress} />
    <Lines lines={lbLines(view, child)} slots={2} />
    <LbBody unit={unit} view={view} child={child} quotes={quotes} onAction={onAction} onResearch={onResearch} researchName={researchName} />
  </PlateFrame>;
}
