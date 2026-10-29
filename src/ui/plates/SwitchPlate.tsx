import { useEffect, useRef, type ReactNode } from 'react';
import type { Quote, SwitchRef, SwitchView } from '../../game';
import { genName, rackLetter } from './copy';
import { hertz } from './format';
import { PlateFrame } from './PlateFrame';
import { routine } from './OptionRow';
import { GenerationAction, nextGeneration } from './GenerationAction';
import { QuoteKey, Status, Toggle } from './widgets';
import type { PlateCommon } from './types';

export interface SwitchBodyProps extends Pick<PlateCommon, 'quotes' | 'onAction' | 'onResearch' | 'researchName'> {
  sw: SwitchRef;
  view: SwitchView;
  /** A key above the purchase keys (the network rack's load balancer key). */
  lead?: ReactNode;
  /** A port tapped on the switch art: its row is scrolled into view. */
  selected?: number | null;
}

const after = (q: Quote | undefined) => (q?.effect ? q.effect.capacityAfter : null);

/**
 * D35 (user, 26 Oct): systems have no port; the switch does. "All ports" upgrades every port at once, and
 * Match ports (on by default) keeps them, and every new port, at one speed. With Match off each port is its
 * own row ("Port 3 · System 3 · 100 kHz → 200 kHz"). Then the uplink and the replace.
 */
export function SwitchBody({ sw, view, lead, selected = null, quotes, onAction, onResearch, researchName }: SwitchBodyProps) {
  const qs = quotes?.quotes ?? [], room = sw.kind === 'room';
  const fire = (q: Quote) => onAction(q.action);
  const portQuote = (i: number | 'all') => qs.find((q) => q.action.type === 'upgradePort' && q.action.port === i);
  const all = portQuote('all') ?? (view.sameSpeed ? qs.find((q) => q.action.type === 'upgradePort') : undefined);
  const uplinks = qs.filter((q) => q.action.type === 'upgradeUplink' || q.action.type === 'addUplink');
  const addPorts = qs.find((q) => q.action.type === 'addPorts');
  const replace = nextGeneration(qs);
  const list = useRef<HTMLOListElement>(null);
  // A port tapped on the switch art opens the plate at its row.
  useEffect(() => { if (selected !== null) list.current?.querySelector(`[data-port="${selected}"]`)?.scrollIntoView?.({ block: 'nearest' }); }, [selected]);
  const peer = (p: number | null) => p === null ? 'free' : room ? `Rack ${rackLetter(p)}` : `Server ${p + 1}`;
  return <>
    <div className="keys">
      {lead}
      {all ? <QuoteKey quote={all} label="Port speed"
        onAction={fire} onResearch={onResearch} researchName={researchName} />
        : <p className="p-hint">Ports at this switch's top speed</p>}
    </div>
    <section className="switch-controls"><Toggle label="Match port speeds" on={view.sameSpeed}
      onToggle={() => onAction({ type: 'setSameSpeed', sw, on: !view.sameSpeed })} />
    {!view.sameSpeed && <ol ref={list} className="port-list scroll-list" aria-label="Ports">
      {view.ports.map((p, i) => {
        const q = portQuote(i), to = after(q);
        return <li key={i} data-port={i} className={i === selected ? 'sel' : ''}>
          {q ? <><QuoteKey quote={q} tone="row" label={'Port ' + (i + 1) + ' / ' + peer(p.peer)}
            ariaLabel={`Port ${i + 1}, ${peer(p.peer)}, ${hertz(p.speedHz)}${to != null ? ` to ${hertz(to)}` : ''}`} onAction={fire} onResearch={onResearch} researchName={researchName} /></>
            : <p className="key-slot">Port {i + 1} · {peer(p.peer)} · {hertz(p.speedHz)} · top speed</p>}
        </li>;
      })}
    </ol>}
    <div className="keys">
      {addPorts && addPorts.locked?.code !== 'ceiling' && addPorts.locked?.code !== 'cap' && <QuoteKey quote={addPorts} label="Ports"
        onAction={fire} onResearch={onResearch} researchName={researchName} />}
      {routine(uplinks.filter(q => q.locked?.code !== 'ceiling' && q.locked?.code !== 'cap').map(quote => ({ quote }))).map(({ quote: q }, i) => <QuoteKey key={i} quote={q} label={q.action.type === 'addUplink' ? 'Add uplink' : `Uplink ${q.action.type === 'upgradeUplink' ? q.action.uplink + 1 : ''}`}
        detail={q.action.type === 'addUplink' && q.effect ? `${q.effect.capacityBefore} → ${q.effect.capacityAfter} uplinks` : undefined}
        onAction={fire} onResearch={onResearch} researchName={researchName} />)}
    </div></section>
    <GenerationAction quote={replace} onAction={fire} onResearch={onResearch} researchName={researchName} />
  </>;
}

/** The switch's one speed: what its links run at (the slowest, while any still lag). */
export const speedOf = (view: SwitchView): number => view.ports.length ? Math.min(...view.ports.map(p => p.speedHz)) : view.topHz;

export interface SwitchPlateProps extends PlateCommon { sw: SwitchRef; view: SwitchView; units: number; initialPort?: number | null }

/** The rack switch plate. */
export function SwitchPlate({ sw, view, units: _units, initialPort = null, quotes, onAction, onResearch, researchName, ...frame }: SwitchPlateProps) {
  const up = view.uplinks[0];
  return <PlateFrame {...frame} title="Switch" sub={genName(sw.kind === 'room' ? 'roomSwitch' : 'switch', view.generation).replace(/ switch$/, '')} className="switch">
    <Status text={`${hertz(speedOf(view))} to every port${up ? ` · uplink ${hertz(up.speedHz)}` : ''}`} />
    <SwitchBody sw={sw} view={view} selected={initialPort} quotes={quotes} onAction={onAction} onResearch={onResearch} researchName={researchName} />
  </PlateFrame>;
}
