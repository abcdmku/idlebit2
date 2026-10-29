import type { QuoteResult } from '../../game';
import { hertz, measureUnit } from './format';
import { PlateFrame } from './PlateFrame';
import type { PlateCommon } from './types';
import { QuoteKey } from './widgets';
export interface LinkPlateProps extends Omit<PlateCommon, 'quotes'> { title: string; quotes: QuoteResult | null; speedHz: number | null; onOpenNetwork?: () => void }
export function LinkPlate({ title, quotes, speedHz, onOpenNetwork: _open, onAction, onResearch, researchName, ...frame }: LinkPlateProps) {
  const q = quotes?.quotes[0], e = q?.effect;
  return <PlateFrame {...frame} title={title} sub={speedHz !== null ? hertz(speedHz) : e ? measureUnit(e.capacityBefore, e.unit) : undefined} className="part inbound"
    footer={q && <QuoteKey quote={q} label="Upgrade link" onAction={x => onAction(x.action)} onResearch={onResearch} researchName={researchName} />}>
    {!q && <p className="p-line muted">No link here</p>}
  </PlateFrame>;
}
