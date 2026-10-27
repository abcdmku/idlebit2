// A zone's inbound link: its speed now and its one real step, from the sim's
// inbound quote (D15.5). A link is upgraded where it plugs in: before that structure is open, the step is
// locked and the key opens the research that opens it. A zone also reaches its network rack's controls.
import type { Quote, QuoteResult } from '../../game';
import { hertz, measureUnit } from './format';
import { EffectDetail } from './PartKeys';
import { PlateFrame } from './PlateFrame';
import type { PlateCommon } from './types';
import { QuoteKey, Status } from './widgets';

export interface LinkPlateProps extends Omit<PlateCommon, 'quotes'> {
  title: string;
  quotes: QuoteResult | null;
  /** The link's speed now, from the snapshot (a step at its ceiling has no before → after). */
  speedHz: number | null;
  /** The zone's network rack (ports, uplinks, load balancer), when this link has one. */
  onOpenNetwork?: () => void;
}

/** What the step is: the switch port this pipe plugs into, or the uplink of a switch. */
const stepName = (q: Quote) => (q.action.type === 'upgradeUplink' ? 'Uplink' : q.action.type === 'upgradePort'
  ? q.action.port === 'all' ? 'Every rack switch port' : `Rack switch port ${q.action.port + 1}` : q.label ?? 'Link');

export function LinkPlate({ title, quotes, speedHz, onOpenNetwork, onAction, onResearch, researchName, ...frame }: LinkPlateProps) {
  const q = quotes?.quotes[0] ?? null, e = q?.effect;
  const speed = speedHz !== null ? hertz(speedHz) : e ? measureUnit(e.capacityBefore, e.unit) : null;
  // "Upgrade at the Rack switch": a structure lock says where, and its research is the way there. At its top
  // speed there is no step here, so no key: the switch's own plate (Open network rack) replaces it.
  const where = q?.locked?.text ?? null;
  return <PlateFrame {...frame} title={title} sub={speed ?? undefined} className="part inbound"
    footer={q && q.locked?.code !== 'ceiling' && <div className="keys"><QuoteKey quote={q} label="Upgrade link" ariaLabel={`Upgrade link, ${q.cost} Credits`}
      onAction={x => onAction(x.action)} onResearch={onResearch} researchName={researchName} /></div>}>
    {!q ? <Status text="No link to upgrade here" /> : <>
      <Status text={where === 'Max' ? `${stepName(q)} · top speed for this switch` : where ?? stepName(q)} tone={where && where !== 'Max' ? 'warn' : ''} />
      {e && <p className="option-values"><EffectDetail quote={q} /></p>}
    </>}
    {onOpenNetwork && <div className="keys"><button type="button" className="key ghost" onClick={(ev) => { ev.stopPropagation(); onOpenNetwork(); }}>Open network rack</button></div>}
  </PlateFrame>;
}
