import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { rackId, researchId, type GameAction, type PowerCtlView, type StartCtlView } from '../../game';
import { energyLines } from '../RoundPlate';
import { GenerationRow, generationLines } from './GenerationRow';
import { batteryText, PowerCtlPlate } from './PowerCtlPlate';
import { StartRow } from './StartRow';
import { click, mount, type Mounted } from './testkit';

let m: Mounted, acts: GameAction[];
beforeEach(() => { m = mount(); acts = []; });
afterEach(() => m.unmount());
const onAction = (a: GameAction) => acts.push(a);
const bounds = { x: 0, y: 0, w: 390, h: 780 };
const rack = { kind: 'rack', id: rackId(0) } as const;
const start = (over: Partial<StartCtlView> = {}): StartCtlView => ({ generation: 0, level: 1, startWith: 1, headWaitS: 2, busyPct: null, order: 'slot',
  awake: 1, total: 12, nextWakeInMs: null, ...over });
const step = (label: string, which: 0 | 1) => m.host.querySelectorAll<HTMLButtonElement>(`[aria-label="${label}"] .step`)[which]!;

describe('Start row (D31.2)', () => {
  it('three fixed steppers and the order, each sending the whole configuration', () => {
    m.render(<StartRow unit={rack} scope="rack" view={start()} onAction={onAction} />);
    expect(m.host.querySelector('.start-head')?.textContent).toBe('Start1 / 12 awake');
    click(step('Start with, of 12 systems', 1));
    click(step('Wake when the head waits', 0));
    click(m.host.querySelector('[role=radio][aria-checked=false]'));
    expect(acts).toEqual([
      { type: 'setStartConfig', unit: rack, startWith: 2, headWaitS: 2, busyPct: null, order: 'slot' },
      { type: 'setStartConfig', unit: rack, startWith: 1, headWaitS: 1, busyPct: null, order: 'slot' },
      { type: 'setStartConfig', unit: rack, startWith: 1, headWaitS: 2, busyPct: null, order: 'fastest' },
    ]);
    // the floor and ceiling hold: no fewer than 1, no wait under 1 s
    expect(step('Start with, of 12 systems', 0).disabled).toBe(true);
  });
  it('the busy trigger is reserved and greyed until generation 1; then off ↔ 50…95%', () => {
    m.render(<StartRow unit={rack} scope="rack" view={start()} onAction={onAction} />);
    const busy = m.host.querySelectorAll('.start-step')[2]!;
    expect(busy.classList.contains('off')).toBe(true);
    expect(busy.querySelector('b')?.textContent).toBe('—');
    m.render(<StartRow unit={rack} scope="rack" view={start({ generation: 1 })} onAction={onAction} />);
    expect(m.host.querySelectorAll('.start-step')[2]!.querySelector('b')?.textContent).toBe('off');
    click(m.host.querySelectorAll('.start-step')[2]!.querySelectorAll('.step')[1]);
    expect(acts.at(-1)).toMatchObject({ busyPct: 50 });
    m.render(<StartRow unit={rack} scope="rack" view={start({ generation: 1, busyPct: 50 })} onAction={onAction} />);
    click(m.host.querySelectorAll('.start-step')[2]!.querySelectorAll('.step')[0]);
    expect(acts.at(-1)).toMatchObject({ busyPct: null });
  });
  it('each scope orders its own way', () => {
    m.render(<StartRow unit={{ kind: 'global' }} scope="global" view={start({ total: 3 })} onAction={onAction} />);
    expect([...m.host.querySelectorAll('[role=radio]')].map(b => b.textContent)).toEqual(['Slot', 'Cheapest', 'Nearest']);
    expect(m.host.querySelector('.start-head')?.textContent).toBe('Start1 / 3 online');
  });
});

describe('Power control plate (D31.3)', () => {
  const view = (battery: Partial<PowerCtlView['battery']>): PowerCtlView => ({ generation: 0, level: 2,
    battery: { capacityJ: 1000, chargeJ: 1000, secondsLeft: 252, discharging: true, ...battery }, start: start() });
  it('reads the battery time while it carries the rack, then On grid', () => {
    expect(batteryText(view({}).battery)).toBe('BAT 4:12 left');
    expect(batteryText(view({ chargeJ: 0, discharging: false, secondsLeft: 0 }).battery)).toBe('On grid · battery empty');
    expect(batteryText(view({ discharging: false }).battery)).toBe('Battery full · 4:12 at this draw');
  });
  it('empty: the research it needs, which the key opens; installed: battery, Start row', () => {
    const opened: unknown[] = [];
    m.render(<PowerCtlPlate rack={rackId(0)} view={null} research={researchId('powerCtl')} quotes={null} bounds={bounds}
      onAction={onAction} onClose={() => undefined} onResearch={id => opened.push(id)} />);
    expect(m.host.textContent).toContain('Needs Power control research');
    click(m.host.querySelector('.key.locked-action'));
    expect(opened).toEqual(['powerCtl']);
    m.render(<PowerCtlPlate rack={rackId(0)} view={view({})} research={null} quotes={null} bounds={bounds} onAction={onAction} onClose={() => undefined} />);
    expect(m.host.querySelector('.p-status')?.textContent).toContain('BAT 4:12 left');
    expect(m.host.querySelector('[data-testid=start-row]')).not.toBeNull();
  });
});

describe('site generation and the round energy lines (D31.4, D31 report)', () => {
  it('names the generator, its use and whether it burns fuel', () => {
    expect(generationLines(null)).toEqual(['Generation: none', 'Grid only: every watt at the region price']);
    expect(generationLines({ kind: 'fuelCell', level: 2, outputW: 64_000, usedW: 40_000, marginalPrice: 0.1 }))
      .toEqual(['Fuel cell L2', '40 kW of 64 kW used · fuel billed']);
    m.render(<GenerationRow generation={{ kind: 'solar', level: 1, outputW: 1000, usedW: 500, marginalPrice: 0 }} />);
    expect(m.host.querySelector<HTMLElement>('.gen-bar b')!.style.width).toBe('50%');
  });
  it('shows only the non-zero energy lines, and none when the bill is all there is', () => {
    const e = (over: Record<string, string>) => ({ billed: '0', fromBattery: '0', batteryRefill: '0', fromGeneration: '0', fuel: '0', ...over }) as never;
    expect(energyLines(e({ billed: '500' }))).toEqual([]);
    expect(energyLines(e({ billed: '500', fromBattery: '120', fuel: '3' })).map(l => l.key)).toEqual(['billed', 'fromBattery', 'fuel']);
    expect(energyLines(undefined)).toEqual([]);
  });
});
