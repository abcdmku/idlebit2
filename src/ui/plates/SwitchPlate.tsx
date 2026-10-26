import { useEffect, useRef, type ReactNode } from 'react';
import type { Quote, SwitchRef, SwitchView } from '../../game';
import { genName } from './copy';
import { hertz } from './format';
import { PlateFrame } from './PlateFrame';
import { effectText } from './PartKeys';
import { Key, QuoteKey, Status, Toggle } from './widgets';
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
  const uplink = qs.find((q) => q.action.type === 'upgradeUplink' || q.action.type === 'addUplink');
  const replace = qs.find((q) => q.action.type === 'replacePart' && !q.locked) ?? qs.find((q) => q.action.type === 'replacePart');
  const now = speedOf(view), list = useRef<HTMLOListElement>(null);
  // A port tapped on the switch art opens the plate at its row.
  useEffect(() => { if (selected !== null) list.current?.querySelector(`[data-port="${selected}"]`)?.scrollIntoView?.({ block: 'nearest' }); }, [selected]);
  const peer = (p: number | null) => p === null ? 'free' : room ? `Rack ${p + 1}` : `System ${p + 1}`;
  return <>
    <div className="keys">
      {lead}
      {all ? <QuoteKey quote={all} label={`All ports · ${hertz(now)}${after(all) != null ? ` → ${hertz(after(all)!)}` : ''}`}
        onAction={fire} onResearch={onResearch} researchName={researchName} />
        : <Key label={`All ports · ${hertz(now)} · top speed`} disabled detail={`${genName(room ? 'roomSwitch' : 'switch', view.generation)} tops out at ${hertz(view.topHz)}`} onPress={() => undefined} />}
    </div>
    <Toggle label="Match ports" on={view.sameSpeed} note={view.sameSpeed ? 'Every port, and every new one, at one speed' : 'Each port upgrades on its own'}
      onToggle={() => onAction({ type: 'setSameSpeed', sw, on: !view.sameSpeed })} />
    {!view.sameSpeed && <ol ref={list} className="port-list" aria-label="Ports">
      {view.ports.map((p, i) => {
        const q = portQuote(i), to = after(q);
        return <li key={i} data-port={i} className={i === selected ? 'sel' : ''}>
          {q ? <QuoteKey quote={q} tone="row" label={`Port ${i + 1} · ${peer(p.peer)} · ${hertz(p.speedHz)}${to != null ? ` → ${hertz(to)}` : ''}`}
            onAction={fire} onResearch={onResearch} researchName={researchName} />
            : <p className="key-slot">Port {i + 1} · {peer(p.peer)} · {hertz(p.speedHz)} · top speed</p>}
        </li>;
      })}
    </ol>}
    <div className="keys">
      {uplink && <QuoteKey quote={uplink} label={uplink.action.type === 'addUplink' ? 'Add uplink' : `Uplink${after(uplink) != null ? ` · ${hertz(after(uplink)!)}` : ''}`}
        onAction={fire} onResearch={onResearch} researchName={researchName} />}
      {replace && <QuoteKey quote={replace} tone="replace" label={`Replace · ${replace.label}`} detail={effectText(replace.effect)}
        onAction={fire} onResearch={onResearch} researchName={researchName} />}
    </div>
  </>;
}

/** The switch's one speed: what its links run at (the slowest, while any still lag). */
export const speedOf = (view: SwitchView): number => view.ports.length ? Math.min(...view.ports.map(p => p.speedHz)) : view.topHz;

export interface SwitchPlateProps extends PlateCommon { sw: SwitchRef; view: SwitchView; units: number; initialPort?: number | null }

/** The rack switch plate. */
export function SwitchPlate({ sw, view, units: _units, initialPort = null, quotes, onAction, onResearch, researchName, ...frame }: SwitchPlateProps) {
  const up = view.uplinks[0];
  return <PlateFrame {...frame} title="Switch" sub={genName(sw.kind === 'room' ? 'roomSwitch' : 'switch', view.generation)} className="switch">
    <Status text={`${hertz(speedOf(view))} to every port${up ? ` · uplink ${hertz(up.speedHz)}` : ''}`} />
    <SwitchBody sw={sw} view={view} selected={initialPort} quotes={quotes} onAction={onAction} onResearch={onResearch} researchName={researchName} />
  </PlateFrame>;
}
