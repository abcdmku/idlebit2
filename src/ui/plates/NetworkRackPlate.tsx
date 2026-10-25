import { useState } from 'react';
import type { LbView, QuoteResult, RoomId, SwitchView } from '../../game';
import { ROUTE_NAMES, zoneLetter } from './copy';
import { PlateFrame } from './PlateFrame';
import { LbBody, lbLines, lbStatus } from './LbPlate';
import { SwitchBody, switchLines } from './SwitchPlate';
import { Key, Lines, Status } from './widgets';
import type { PlateCommon } from './types';

export interface NetworkRackPlateProps extends PlateCommon {
  room: RoomId;
  zone: number;
  network: { readonly switch: SwitchView; readonly lb: LbView };
  /** Racks in the room. */
  racks: number;
  /** `quotes` are the room switch quotes; these are the room LB's. */
  lbQuotes: QuoteResult | null;
  initialView?: 'ports' | 'lb';
  initialPort?: number | null;
}

/** The room's network rack: rack uplinks and speeds, and the room load balancer behind one key. */
export function NetworkRackPlate({ room, zone, network, racks, lbQuotes, initialView = 'ports', initialPort,
  quotes, onAction, onResearch, researchName, ...frame }: NetworkRackPlateProps) {
  const [view, setView] = useState(initialView);
  const [sel, setSel] = useState(initialPort ?? 0);
  const sw = { kind: 'room', id: room } as const, az = `AZ ${zoneLetter(zone)}`;
  if (view === 'lb') {
    const st = lbStatus(network.lb);
    return <PlateFrame {...frame} title="Room load balancer" sub={`${az} · in the network rack`} className="lb netrack">
      <Status text={st.text} progress={st.progress} />
      <Lines lines={lbLines(network.lb, 'rack')} slots={2} />
      <LbBody unit={{ kind: 'room', id: room }} view={network.lb} child="rack" quotes={lbQuotes}
        onAction={onAction} onResearch={onResearch} researchName={researchName} />
      <div className="keys"><Key tone="go" label="Port speeds and count" onPress={() => setView('ports')} /></div>
    </PlateFrame>;
  }
  return <PlateFrame {...frame} title="Network rack" sub={`${az} · switch and LB`} className="switch netrack">
    <Status text={`${network.switch.ports.length} ports · ${racks} racks`} />
    <Lines lines={switchLines(network.switch, racks, true)} slots={1} />
    <SwitchBody sw={sw} view={network.switch} selected={sel} onSelect={setSel}
      lead={<Key tone="go" label={`Load balancer · ${ROUTE_NAMES[network.lb.strategy].short}`} onPress={() => setView('lb')} />}
      quotes={quotes} onAction={onAction} onResearch={onResearch} researchName={researchName} />
  </PlateFrame>;
}
