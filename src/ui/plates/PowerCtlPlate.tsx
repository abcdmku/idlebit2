// D31.3 rack Power control: the battery (time until billed) and the rack's start controller, one unit in
// the rack's fifth infrastructure slot under the cooler. Empty: its add row (or the research it needs).
// Installed: the battery row, the Start row, then upgrade and replace as on every part plate.
import { formatClock, type GameAction, type PowerCtlView, type RackId, type ResearchId } from '../../game';
import { genName } from './copy';
import { quantity } from './format';
import { PlateFrame } from './PlateFrame';
import { PowerKeys } from './PowerKeys';
import { StartRow } from './StartRow';
import { Lines, Status, type Line } from './widgets';
import type { PlateCommon } from './types';

/** The battery line: "BAT 4:12 left" while it carries the rack (the rack LCD's clock, QA-14), "On grid" once empty. */
export function batteryText(b: PowerCtlView['battery']): string {
  if (b.discharging && b.secondsLeft !== null) return `BAT ${formatClock(b.secondsLeft)} left`;
  if (b.chargeJ <= 0) return 'On grid · battery empty';
  if (b.chargeJ >= b.capacityJ) return b.secondsLeft !== null ? `Battery full · ${formatClock(b.secondsLeft)} at this draw` : 'Battery full';
  return `On grid · battery ${Math.round((b.chargeJ / b.capacityJ) * 100)}%`;
}

export interface PowerCtlPlateProps extends PlateCommon {
  rack: RackId;
  view: PowerCtlView | null;
  /** The research that opens the slot, while it is locked. */
  research: ResearchId | null;
}

export function PowerCtlPlate({ rack, view, research, ...common }: PowerCtlPlateProps) {
  const { quotes, onAction, onResearch, researchName, ...frame } = common;
  if (!view) {
    const lines: Line[] = [{ text: 'Carries the rack off the bill at round start, then wakes systems as tasks need them', tone: 'muted' }];
    return <PlateFrame {...frame} title="Power control" sub="Empty slot" className="part power-ctl">
      <Status text={research ? 'Needs Power control research' : 'Battery and smart start, one unit'} tone={research ? 'warn' : ''} />
      <Lines lines={lines} slots={2} />
      {research && onResearch && !quotes?.quotes.length
        ? <div className="keys"><button type="button" className="key locked-action" onClick={() => onResearch(research)}>Research Power control</button></div>
        : <PowerKeys quotes={quotes} installed={false} level={0} noun="Power control" onAction={onAction} onResearch={onResearch} researchName={researchName} />}
    </PlateFrame>;
  }
  const b = view.battery;
  const lines: Line[] = [
    { text: `Capacity ${quantity(b.capacityJ, 'J')} · refills at Return`, tone: 'muted' },
    { text: b.discharging ? 'Drawing from the battery: this rack bills nothing' : 'The rack bills its draw', tone: b.discharging ? 'ben' : 'muted' },
  ];
  return <PlateFrame {...frame} title="Power control" sub={`${genName('powerCtl', view.generation)} · L${view.level}`} className="part power-ctl">
    <Status text={batteryText(b)} tone={b.discharging ? '' : 'warn'} progress={b.capacityJ > 0 ? b.chargeJ / b.capacityJ : 0} />
    <Lines lines={lines} slots={2} />
    <StartRow unit={{ kind: 'rack', id: rack }} scope="rack" view={view.start} onAction={(a: GameAction) => onAction(a)} />
    <PowerKeys quotes={quotes} installed level={view.level} noun="Power control" onAction={onAction} onResearch={onResearch} researchName={researchName} />
  </PlateFrame>;
}
