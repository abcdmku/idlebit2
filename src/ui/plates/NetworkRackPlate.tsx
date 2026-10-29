import type { LbView, Quote, QuoteResult, RoomId, SwitchView } from '../../game';
import { zoneLetter } from './copy';
import { PlateFrame } from './PlateFrame';
import { LbBody, lbStatus } from './LbPlate';
import { SwitchBody, speedOf } from './SwitchPlate';
import { hertz } from './format';
import { Status } from './widgets';
import type { PlateCommon } from './types';

export interface NetworkRackPlateProps extends PlateCommon {
  room: RoomId;
  zone: number;
  network: { readonly switch: SwitchView; readonly lb: LbView };
  /** Racks in the room. */
  racks: number;
  /** `quotes` are the room switch quotes; these are the room LB's. */
  lbQuotes: QuoteResult | null;
  /** The room LB's next queue slot (D25.7). */
  queueQuote?: Quote | null;
  initialView?: 'ports' | 'lb';
  initialPort?: number | null;
}

/** The room's network rack: rack uplinks and speeds, and the room load balancer behind one key. */
export function NetworkRackPlate({ room, zone, network, racks, lbQuotes, queueQuote, initialView = 'ports', initialPort = null,
  quotes, onAction, onResearch, researchName, ...frame }: NetworkRackPlateProps) {
  const view = initialView;
  const sw = { kind: 'room', id: room } as const, az = `Zone ${zoneLetter(zone)}`;
  if (view === 'lb') {
    const st = lbStatus(network.lb);
    return <PlateFrame {...frame} title="Room load balancer" sub={az} className="lb netrack">
      <Status text={st.text} tone={st.tone} progress={st.progress} />
      <LbBody unit={{ kind: 'room', id: room }} view={network.lb} child="rack" quotes={lbQuotes} queueQuote={queueQuote}
        onAction={onAction} onResearch={onResearch} researchName={researchName} />
    </PlateFrame>;
  }
  return <PlateFrame {...frame} title="Room switch" sub={az} className="switch netrack">
    <Status text={`${hertz(speedOf(network.switch))} to every rack port · ${racks} ${racks === 1 ? 'rack' : 'racks'}`} />
    <SwitchBody sw={sw} view={network.switch} selected={initialPort}
      quotes={quotes} onAction={onAction} onResearch={onResearch} researchName={researchName} />
  </PlateFrame>;
}
