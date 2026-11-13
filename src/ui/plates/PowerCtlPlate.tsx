// D31.3 rack Power control: the battery (time until billed) and the rack's start controller, one unit in
// the rack's fifth infrastructure slot under the cooler. Empty: its add row (or the research it needs).
// Installed: the battery row, the Start row, then upgrade and replace as on every part plate.
import type { GameAction, PowerCtlView, RackId, ResearchId } from '../../game';
import { genName } from './copy';
import { quantity } from './format';
import { PlateFrame } from './PlateFrame';
import { PowerKeys, powerGeneration } from './PowerKeys';
import { StartRow } from './StartRow';
import { Bar } from './widgets';
import type { PlateCommon } from './types';

export interface PowerCtlPlateProps extends PlateCommon {
  rack: RackId;
  view: PowerCtlView | null;
  /** The research that opens the slot, while it is locked. */
  research: ResearchId | null;
}

export function PowerCtlPlate({ rack, view, research: _research, ...common }: PowerCtlPlateProps) {
  const { quotes, onAction, onResearch, researchName, ...frame } = common;
  if (!view) {
    return <PlateFrame {...frame} title="Power control" sub="Empty slot" className="part power-ctl">
      <PowerKeys quotes={quotes} installed={false} level={0} noun="Power control" onAction={onAction} onResearch={onResearch} researchName={researchName} />
    </PlateFrame>;
  }
  const b = view.battery, charge = quantity(b.chargeJ, 'J') + ' / ' + quantity(b.capacityJ, 'J') + (b.discharging ? ' · Battery' : ' · Grid');
  return <PlateFrame {...frame} title="Power control" sub={`${genName('powerCtl', view.generation).replace(/ power control$/i, '')} · L${view.level}`} usage={charge} className="part power-ctl"
    generation={powerGeneration({ quotes, installed: true, onAction, onResearch, researchName })}>
    <Bar progress={b.capacityJ > 0 ? b.chargeJ / b.capacityJ : 0} label={charge} />
    <section className="component-options"><StartRow unit={{ kind: 'rack', id: rack }} scope="rack" view={view.start} onAction={(a: GameAction) => onAction(a)} /></section>
    <PowerKeys quotes={quotes} installed level={view.level} noun="Power control" onAction={onAction} onResearch={onResearch} researchName={researchName} />
  </PlateFrame>;
}
