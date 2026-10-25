// D31.3 rack Power control: the battery (time until billed) and the rack's start controller, one unit in
// the rack's fifth infrastructure slot under the cooler. Empty: its add row (or the research it needs).
// Installed: the battery row, the Start row, then upgrade and replace as on every part plate.
import type { GameAction, PowerCtlView, Quote, RackId, ResearchId } from '../../game';
import { genName } from './copy';
import { clock, quantity } from './format';
import { PartPlate } from './PartPlate';
import { PlateFrame } from './PlateFrame';
import { StartRow } from './StartRow';
import { Lines, QuoteKey, Status, type Line } from './widgets';
import type { PlateCommon } from './types';

/** The battery line: "BAT 4:12 left" while it carries the rack, "On grid" once empty. */
export function batteryText(b: PowerCtlView['battery']): string {
  if (b.discharging && b.secondsLeft !== null) return `BAT ${clock(b.secondsLeft)} left`;
  if (b.chargeJ <= 0) return 'On grid · battery empty';
  if (b.chargeJ >= b.capacityJ) return b.secondsLeft !== null ? `Battery full · ${clock(b.secondsLeft)} at this draw` : 'Battery full';
  return `On grid · battery ${Math.round((b.chargeJ / b.capacityJ) * 100)}%`;
}

/** A quote that adds a part rather than upgrading or configuring one. */
const isAdd = (q: Quote) => !['upgradePart', 'replacePart', 'removePart', 'setStartConfig'].includes(q.action.type);

export interface PowerCtlPlateProps extends PlateCommon {
  rack: RackId;
  view: PowerCtlView | null;
  /** The research that opens the slot, while it is locked. */
  research: ResearchId | null;
}

export function PowerCtlPlate({ rack, view, research, ...common }: PowerCtlPlateProps) {
  const { quotes, onAction, onResearch, researchName, ...frame } = common;
  if (!view) {
    const add = quotes?.quotes.find(isAdd) ?? null;
    const lines: Line[] = [{ text: 'Carries the rack off the bill at round start, then wakes systems as tasks need them', tone: 'muted' }];
    return <PlateFrame {...frame} title="Power control" sub="Empty slot" className="part power-ctl">
      <Status text={research ? 'Needs Power control research' : 'Battery and smart start, one unit'} tone={research ? 'warn' : ''} />
      <Lines lines={lines} slots={2} />
      <div className="keys">
        {add ? <QuoteKey quote={add} label={add.label || 'Add Power control'} onAction={q => onAction(q.action)} onResearch={onResearch} researchName={researchName} />
          : research && onResearch ? <button type="button" className="key locked-action" onClick={() => onResearch(research)}>Research Power control</button>
          : <p className="key-slot">Not for sale here yet</p>}
      </div>
    </PlateFrame>;
  }
  const b = view.battery;
  const lines: Line[] = [
    { text: `Capacity ${quantity(b.capacityJ, 'J')} · refills at Return`, tone: 'muted' },
    { text: b.discharging ? 'Drawing from the battery: this rack bills nothing' : 'The rack bills its draw', tone: b.discharging ? 'ben' : 'muted' },
  ];
  return <PartPlate {...common} className="power-ctl" title="Power control" sub={`${genName('powerCtl', view.generation)} · L${view.level}`}
    level={view.level} status={batteryText(b)} statusTone={b.discharging ? '' : 'warn'} progress={b.capacityJ > 0 ? b.chargeJ / b.capacityJ : 0} lines={lines}>
    <StartRow unit={{ kind: 'rack', id: rack }} scope="rack" view={view.start} onAction={(a: GameAction) => onAction(a)} />
  </PartPlate>;
}
