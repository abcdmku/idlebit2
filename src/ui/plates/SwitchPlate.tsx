import { useState, type ReactNode } from 'react';
import type { Quote, SwitchRef, SwitchView } from '../../game';
import { genName } from './copy';
import { hertz } from './format';
import { PlateFrame } from './PlateFrame';
import { effectText } from './PartKeys';
import { Key, Lines, PortGrid, QuoteKey, Status, Toggle, type Line, type PortCell } from './widgets';
import type { PlateCommon } from './types';

/** Ports per page in the grid; a full page of a longer switch keeps one cell for paging. */
export const PORTS_PER_PAGE = 12;

export interface SwitchBodyProps extends Pick<PlateCommon, 'quotes' | 'onAction' | 'onResearch' | 'researchName'> {
  sw: SwitchRef;
  view: SwitchView;
  selected: number;
  onSelect: (port: number) => void;
  /** A key above the purchase keys (the network rack's load balancer key). */
  lead?: ReactNode;
}

const after = (q: Quote | undefined) => (q?.effect ? q.effect.capacityAfter : null);

export function switchLines(view: SwitchView, units: number, room: boolean): Line[] {
  const linked = view.ports.filter((p) => p.peer !== null).length, without = Math.max(0, units - linked);
  const noun = room ? (without === 1 ? 'rack has no uplink' : 'racks have no uplink') : without === 1 ? 'server has no port' : 'servers have no port';
  return without ? [{ text: `${without} ${noun}, so no tasks`, tone: 'warn' }] : [];
}

/** Ports, per-port speed and price, the same-speed toggle, add port, uplink and replace. */
export function SwitchBody({ sw, view, selected, onSelect, lead, quotes, onAction, onResearch, researchName }: SwitchBodyProps) {
  const room = sw.kind === 'room';
  const [page, setPage] = useState(0);
  const qs = quotes?.quotes ?? [];
  const fire = (q: Quote) => onAction(q.action);
  const portQuote = (i: number | 'all') => qs.find((q) => q.action.type === 'upgradePort' && q.action.port === i);
  const n = view.ports.length, sel = Math.max(0, Math.min(selected, n - 1));
  const label = (i: number) => `${room ? 'R' : 'P'}${i + 1}`;

  const paged = n > PORTS_PER_PAGE, per = paged ? PORTS_PER_PAGE - 1 : PORTS_PER_PAGE;
  const pages = Math.max(1, Math.ceil(n / per)), p0 = (page % pages) * per;
  const cells: PortCell[] = view.ports.slice(p0, p0 + per).map((p, k) => ({
    id: String(p0 + k), label: label(p0 + k), value: hertz(p.speedHz), lit: p.active, dim: p.peer === null, sel: !view.sameSpeed && p0 + k === sel,
  }));
  if (paged) cells.push({ id: 'page', label: `${p0 + 1}-${Math.min(n, p0 + per)}`, value: `of ${n}`, lit: false, dim: true, sel: false });

  const all = portQuote('all'), one = portQuote(sel), add = qs.find((q) => q.action.type === 'addPorts');
  const uplink = qs.find((q) => q.action.type === 'upgradeUplink' || q.action.type === 'addUplink');
  const replace = qs.find((q) => q.action.type === 'replacePart' && !q.locked) ?? qs.find((q) => q.action.type === 'replacePart');
  const ports = room ? 'uplinks' : 'ports';
  return <>
    <PortGrid cells={cells} onSelect={(id) => (id === 'page' ? setPage(page + 1) : onSelect(Number(id)))} />
    <Toggle label="Same speed on all ports" on={view.sameSpeed}
      note={view.sameSpeed ? `One upgrade raises every ${room ? 'uplink' : 'port'}` : `Each ${room ? 'uplink' : 'port'} upgrades alone`}
      onToggle={() => onAction({ type: 'setSameSpeed', sw, on: !view.sameSpeed })} />
    <div className="keys">
      {lead}
      {view.sameSpeed
        ? all ? <QuoteKey quote={all} label={`All ${n} ${ports}${after(all) != null ? ` · ${hertz(after(all)!)}` : ''}`}
          onAction={fire} onResearch={onResearch} researchName={researchName} />
          : <Key label={`All ${n} ${ports} · top speed`} disabled detail={`${genName(sw.kind === 'room' ? 'roomSwitch' : 'switch', view.generation)} tops out at ${hertz(view.topHz)}`} onPress={() => undefined} />
        : one ? <QuoteKey quote={one} label={`${room ? `Rack ${sel + 1} uplink` : `Port ${sel + 1}`}${after(one) != null ? ` · ${hertz(after(one)!)}` : ''}`}
          onAction={fire} onResearch={onResearch} researchName={researchName} />
          : <Key label={`${room ? `Rack ${sel + 1} uplink` : `Port ${sel + 1}`} · top speed`} disabled
            detail={`${genName(sw.kind === 'room' ? 'roomSwitch' : 'switch', view.generation)} tops out at ${hertz(view.topHz)}`} onPress={() => undefined} />}
      {add && <QuoteKey quote={add} label={`Add port ${n + 1}`} onAction={fire} onResearch={onResearch} researchName={researchName} />}
      {uplink && <QuoteKey quote={uplink} label={uplink.action.type === 'addUplink' ? 'Add uplink' : `Uplink${after(uplink) != null ? ` · ${hertz(after(uplink)!)}` : ''}`}
        onAction={fire} onResearch={onResearch} researchName={researchName} />}
      {replace && <QuoteKey quote={replace} tone="replace" label={`Replace · ${replace.label}`} detail={effectText(replace.effect)}
        onAction={fire} onResearch={onResearch} researchName={researchName} />}
    </div>
  </>;
}

export interface SwitchPlateProps extends PlateCommon { sw: SwitchRef; view: SwitchView; units: number; initialPort?: number | null }

/** The rack switch plate. */
export function SwitchPlate({ sw, view, units, initialPort, quotes, onAction, onResearch, researchName, ...frame }: SwitchPlateProps) {
  const [sel, setSel] = useState(initialPort ?? 0);
  const linked = view.ports.filter((p) => p.peer !== null).length;
  const up = view.uplinks[0];
  return <PlateFrame {...frame} title="Switch" sub={`${genName(sw.kind === 'room' ? 'roomSwitch' : 'switch', view.generation)} · ${view.ports.length} ports`} className="switch">
    <Status text={`${up ? `Uplink ${hertz(up.speedHz)} · ` : ''}${linked} of ${units} linked`} />
    <Lines lines={switchLines(view, units, false)} slots={1} />
    <SwitchBody sw={sw} view={view} selected={sel} onSelect={setSel}
      quotes={quotes} onAction={onAction} onResearch={onResearch} researchName={researchName} />
  </PlateFrame>;
}
