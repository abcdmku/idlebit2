import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { rackId, roomId, systemId, type CoolerView, type GameAction, type LbView, type PartRef, type ServerSlotView, type SupplyView, type SwitchView } from '../../game';
import { LEVEL_FIXTURES } from '../../game/fixtures';
import { CoolerPlate } from './CoolerPlate';
import { LbPlate } from './LbPlate';
import { NetworkRackPlate } from './NetworkRackPlate';
import { OnlineRow } from './OnlineRow';
import { PartPlate } from './PartPlate';
import { SupplyPlate } from './SupplyPlate';
import { SwitchPlate } from './SwitchPlate';
import { ServerPlate, neighbours } from './UnitPlate';
import { button, buttons, click, mount, q, researchLock, result, type Mounted } from './testkit';

let m: Mounted, acts: GameAction[], onAction: (a: GameAction) => void, onClose: () => void;
beforeEach(() => { m = mount(); acts = []; onAction = (a) => { acts.push(a); }; onClose = vi.fn(); });
afterEach(() => m.unmount());

const clockPart: PartRef = { unit: { kind: 'system', id: systemId(0) }, slot: { kind: 'clock', socket: 0 } };
const effect = (before: number, after: number, paybackS: number | null) =>
  ({ capacityBefore: before, capacityAfter: after, unit: 'ops/s' as const, wattsBefore: 2, wattsAfter: 3, energyPerMinuteDelta: '1' as never, paybackS });

describe('part plate: upgrade (hot) against replace (cold) with payback', () => {
  const upgrade = q({ type: 'upgradePart', part: clockPart }, 360, { effect: effect(1000, 2000, 250) });
  const replace = q({ type: 'replacePart', part: clockPart, generation: 1, preserveCapacity: true }, 2400,
    { label: 'kHz clock', cold: true, downtimeMs: 10_000, effect: effect(1000, 16000, 7500) });

  it('shows both keys with prices, effects, hot/cold notes and the payback line', () => {
    m.render(<PartPlate title="Clock" sub="1 kHz" level={2} status="Drives every lane" quotes={result([upgrade, replace])} onAction={onAction} onClose={onClose} />);
    const up = button(m.host, 'Upgrade · L3'), rep = button(m.host, 'Replace · kHz clock');
    expect(up.textContent).toContain('360');
    expect(up.textContent).toContain('1k ops/s → 2k ops/s · +1 W');
    expect(up.textContent).toContain('Hot · no downtime');
    expect(rep.textContent).toContain('2,400');
    expect(rep.textContent).toContain('Cold · 10s offline, running work lost');
    expect(m.host.querySelector('.payback')?.textContent).toBe('Pays back: upgrade 4m 10s · replace 2h 5m');
    click(up);
    expect(acts).toEqual([upgrade.action]);
  });

  it('says "No payback at this load" and disables what cannot be afforded', () => {
    const poor = { ...upgrade, affordable: false, effect: effect(1, 2, null) };
    m.render(<PartPlate title="Clock" sub="" level={2} status="" quotes={result([poor])} onAction={onAction} onClose={onClose} />);
    expect(button(m.host, 'Upgrade').disabled).toBe(true);
    expect(m.host.querySelector('.need')?.textContent).toBe('Needs more Credits');
    expect(m.host.querySelector('.payback')?.textContent).toBe('No payback at this load');
    expect(m.host.textContent).toContain('Newest generation');
  });

  it('a research-locked replace opens that research instead of buying, with a lock glyph and no ×', () => {
    const onResearch = vi.fn();
    const locked = { ...replace, locked: researchLock('fabKhz', 'Needs kHz fab research') };
    m.render(<PartPlate title="Clock" sub="" level={2} status="" quotes={result([upgrade, locked])} onAction={onAction} onClose={onClose}
      onResearch={onResearch} researchName={() => 'kHz fab'} />);
    const key = button(m.host, 'research');
    expect(key.className).toContain('locked-action');
    expect(key.textContent).toContain('kHz fab');
    expect(key.querySelector('svg.lock')).not.toBeNull();
    expect(key.textContent).not.toContain('×');
    click(key);
    expect(onResearch).toHaveBeenCalledWith('fabKhz');
    expect(acts).toEqual([]);
  });
});

const supply = (over: Partial<SupplyView> = {}): SupplyView => ({ kind: 'pdu', generation: 0, level: 2, capacityW: 4096, deliveredW: 2048, usage: 0.5,
  overloadS: 0, failed: false, rebootMs: null, loss: 0.1, lossW: 204.8, capped: false, capFactor: 1, creditsPerMinute: 2, ...over });

describe('supply plates: usage and the overload timer once it is nonzero', () => {
  it('reads usage; no timer at zero', () => {
    m.render(<SupplyPlate supply={supply()} quotes={null} onAction={onAction} onClose={onClose} />);
    expect(m.host.querySelector('.p-title')?.textContent).toBe('Rack PDU');
    expect(m.host.querySelector('.p-status')?.textContent).toBe('2.05 kW / 4.1 kW · 50%');
    expect(m.host.textContent).not.toMatch(/fails in|Overload/);
  });
  it('counts down to failure while over 100%, then shows the reboot', () => {
    m.render(<SupplyPlate supply={supply({ usage: 1.2, deliveredW: 4915, overloadS: 6.2 })} quotes={null} onAction={onAction} onClose={onClose} />);
    expect(m.host.textContent).toContain('Overloaded · fails in 4 s');
    m.render(<SupplyPlate supply={supply({ usage: 0.8, overloadS: 3.5 })} quotes={null} onAction={onAction} onClose={onClose} />);
    expect(m.host.textContent).toContain('Overload clearing · 4 s left');
    m.render(<SupplyPlate supply={supply({ failed: true, rebootMs: 7200, usage: 0 })} quotes={null} onAction={onAction} onClose={onClose} />);
    expect(m.host.textContent).toContain('Reboots in 8 s');
  });
});

const cooler = (over: Partial<CoolerView> = {}): CoolerView => ({ tech: 'water', generation: 1, level: 2, duty: 0.6, setpointF: null, watts: 120,
  capacityW: 600, equilibriumF: 74, ...over });
const rack = { kind: 'rack', id: rackId(0) } as const;

describe('cooler plate: °F, technology, setpoint once researched', () => {
  it('shows temperature and efficiency, the crash countdown, and a locked setpoint', () => {
    const lockedSet = q({ type: 'setSetpoint', unit: rack, setpointF: 70 }, 0, { locked: researchLock('fanControl', 'Needs Fan control research') });
    m.render(<CoolerPlate unit={rack} cooler={cooler()} lump={{ tempF: 101.4, crashS: 3.2, crashed: false, eff: 0.5 }} quotes={result([lockedSet])}
      onAction={onAction} onClose={onClose} />);
    expect(m.host.querySelector('.p-title')?.textContent).toBe('Water cooling');
    expect(m.host.querySelector('.p-status')?.textContent).toBe('101°F · efficiency 50%');
    expect(m.host.textContent).toContain('At 100°F: crash in 7 s');
    expect(m.host.querySelector('.setpoint.lock')?.textContent).toContain('Needs Fan control research');
    expect(m.host.querySelectorAll('.setpoint .step')).toHaveLength(0);
  });
  it('steps the researched setpoint in 2 °F and sends setSetpoint', () => {
    m.render(<CoolerPlate unit={rack} cooler={cooler({ setpointF: 64 })} lump={{ tempF: 66, crashS: 0, crashed: false, eff: 1.02 }} quotes={null}
      onAction={onAction} onClose={onClose} />);
    expect(m.host.querySelector('.setpoint b')?.textContent).toBe('64°F');
    expect(m.host.textContent).toContain('Variable speed: fans at 60%');
    click(button(m.host, '−'));
    click(button(m.host, '+'));
    expect(acts).toEqual([{ type: 'setSetpoint', unit: rack, setpointF: 62 }, { type: 'setSetpoint', unit: rack, setpointF: 66 }]);
  });
});

const port = (speedHz: number, peer: number | null, active = false) => ({ speedHz, rung: 0, peer, active, family: null, progress: 0, queued: 0 });
const sw = (sameSpeed: boolean): SwitchView => ({ generation: 0, topHz: 500_000, sameSpeed, portCeiling: 12,
  ports: [port(50_000, 0, true), port(20_000, 1), port(5_000, 2), port(1_000, null)], uplinks: [port(20_000, null)] });
const rsw = { kind: 'rack', id: rackId(0) } as const;

describe('switch plate: port grid, per-port price, same-speed toggle with the summed price', () => {
  const perPort = [0, 1, 2, 3].map((i) => q({ type: 'upgradePort', sw: rsw, port: i }, 1000 + i * 1000,
    { effect: { ...effect(1, 1, null), unit: 'bit/s', capacityAfter: [100_000, 50_000, 10_000, 2_000][i] } }));
  const addPort = q({ type: 'addPorts', sw: rsw }, 30_200);

  it('lights active ports, dims unlinked ones, and prices the selected port', () => {
    m.render(<SwitchPlate sw={rsw} view={sw(false)} units={5} quotes={result([...perPort, addPort])} onAction={onAction} onClose={onClose} />);
    const cells = m.host.querySelectorAll('.cx-cell');
    expect(cells).toHaveLength(4);
    expect(cells[0].querySelector('b')?.textContent).toBe('50 kHz');
    expect(cells[0].querySelector('i')?.className).toBe('on');
    expect(cells[3].className).toContain('dim');
    expect(m.host.textContent).toContain('2 servers have no port, so no tasks');
    expect(button(m.host, 'Port 1').textContent).toContain('100 kHz');
    expect(button(m.host, 'Port 1').textContent).toContain('1,000');
    click(cells[2]);
    expect(button(m.host, 'Port 3 · 10 kHz').textContent).toContain('3,000');
    click(button(m.host, 'Port 3'));
    expect(acts).toEqual([perPort[2].action]);
    click(button(m.host, 'Add port 5'));
    expect(acts[1]).toEqual({ type: 'addPorts', sw: rsw });
  });

  it('the toggle sends setSameSpeed; while on, one key raises every port at the summed price', () => {
    m.render(<SwitchPlate sw={rsw} view={sw(false)} units={4} quotes={result(perPort)} onAction={onAction} onClose={onClose} />);
    const toggle = m.host.querySelector('[role="switch"]')!;
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(toggle.textContent).toContain('Each port upgrades alone');
    click(toggle);
    expect(acts).toEqual([{ type: 'setSameSpeed', sw: rsw, on: true }]);

    const all = q({ type: 'upgradePort', sw: rsw, port: 'all' }, 10_000, { effect: { ...effect(1, 1, null), capacityAfter: 100_000 } });
    m.render(<SwitchPlate sw={rsw} view={sw(true)} units={4} quotes={result([...perPort, all])} onAction={onAction} onClose={onClose} />);
    expect(m.host.querySelector('[role="switch"]')?.textContent).toContain('One upgrade raises every port');
    expect(m.host.querySelectorAll('.cx-cell.sel')).toHaveLength(0);
    const key = button(m.host, 'All 4 ports · 100 kHz');
    expect(key.textContent).toContain('10k');
    expect(buttons(m.host).some((b) => /^Port \d/.test(b.textContent ?? ''))).toBe(false);
    click(key);
    expect(acts[1]).toEqual(all.action);
  });

  it('a port at the switch top speed says so', () => {
    m.render(<SwitchPlate sw={rsw} view={sw(false)} units={4} quotes={result([])} onAction={onAction} onClose={onClose} />);
    expect(button(m.host, 'Port 1 · top speed').disabled).toBe(true);
  });
});

const lb = (over: Partial<LbView> = {}): LbView => ({ generation: 0, level: 2, strategy: 'firstFit', filters: [], queue: { slots: 1, level: 1, entries: [] },
  routedPerSec: 5, misroutesThisRound: 0, lastTarget: null, ...over });

describe('load balancer plate: strategies and filters locked by research, capacity upgrade', () => {
  const quotes = result([
    q({ type: 'upgradePart', part: { unit: rack, slot: { kind: 'lb' } } }, 30_700, { effect: { ...effect(12, 24, null), unit: 'tasks/s' } }),
    q({ type: 'setStrategy', unit: rack, strategy: 'firstFit' }, 0),
    q({ type: 'setStrategy', unit: rack, strategy: 'roundRobin' }, 0, { locked: researchLock('lbRoundRobin', 'Needs Round robin research') }),
    q({ type: 'setStrategy', unit: rack, strategy: 'leastConn' }, 0),
    q({ type: 'setFilter', unit: rack, filter: 'capability', on: true }, 0),
    q({ type: 'setFilter', unit: rack, filter: 'thermal', on: true }, 0, { locked: researchLock('thermalAware', 'Needs Thermal-aware research') }),
  ]);
  it('reads routing load and the blind warning; locked rows say Locked with a lock glyph and do nothing', () => {
    m.render(<LbPlate unit={rack} view={lb()} quotes={quotes} onAction={onAction} onClose={onClose} />);
    expect(m.host.querySelector('.p-status')?.textContent).toBe('5 routing decisions a second');
    expect(m.host.textContent).toContain('Server 1 first; if full, server 2, and so on.');
    expect(m.host.textContent).toContain('Capability-blind');
    const rr = button(m.host, 'Round robin');
    expect(rr.className).toContain('lock');
    expect(rr.textContent).toContain('Locked');
    expect(rr.querySelector('svg.lock')).not.toBeNull();
    click(rr);
    expect(acts).toEqual([]);
    expect(button(m.host, 'FIFO first-fit').getAttribute('aria-pressed')).toBe('true');
    click(button(m.host, 'Least connections'));
    click(button(m.host, 'Capability-aware'));
    expect(acts).toEqual([{ type: 'setStrategy', unit: rack, strategy: 'leastConn' }, { type: 'setFilter', unit: rack, filter: 'capability', on: true }]);
    const cap = button(m.host, 'Capacity · 24 a second');
    expect(cap.textContent).toContain('30.7k');
  });
  it('shows the router queue with a well per slot and buys the next slot (D25.7)', () => {
    const entries = [{ taskId: 7, family: 0 as never, units: 64, shard: null, sinceTick: 0, windowEndTick: null }];
    const next = q({ type: 'upgradeRouterQueue', unit: rack }, 379_843);
    m.render(<LbPlate unit={rack} view={lb({ queue: { slots: 2, level: 2, entries } })} quotes={quotes} queueQuote={next} onAction={onAction} onClose={onClose} />);
    expect(m.host.querySelector('[data-testid=lb-queue]')?.textContent).toBe('Queue1/2L2/32');
    expect(m.host.querySelectorAll('.lb-wells i.on')).toHaveLength(1);
    click(button(m.host, 'Queue 2 → 3'));
    expect(acts).toEqual([{ type: 'upgradeRouterQueue', unit: rack }]);
  });
  it('a capability filter clears the blind warning', () => {
    m.render(<LbPlate unit={rack} view={lb({ filters: ['capability'] })} quotes={quotes} onAction={onAction} onClose={onClose} />);
    expect(m.host.textContent).not.toContain('Capability-blind');
    expect(button(m.host, 'Capability-aware').getAttribute('aria-pressed')).toBe('true');
    click(button(m.host, 'Capability-aware'));
    expect(acts).toEqual([{ type: 'setFilter', unit: rack, filter: 'capability', on: false }]);
  });
});

describe('network rack: uplinks per rack and the room load balancer behind one key', () => {
  it('switches between ports and the LB without leaving the plate', () => {
    const room = roomId(0), rsw2 = { kind: 'room', id: room } as const;
    m.render(<NetworkRackPlate room={room} zone={0} network={{ switch: sw(true), lb: lb({ strategy: 'leastConn' }) }} racks={6}
      quotes={result([q({ type: 'upgradePort', sw: rsw2, port: 'all' }, 108_000_000)])} lbQuotes={result([])} onAction={onAction} onClose={onClose} />);
    expect(m.host.querySelector('.p-title')?.textContent).toBe('Network rack');
    expect(m.host.querySelector('.cx-cell')?.textContent).toContain('R1');
    expect(button(m.host, 'All 4 uplinks').textContent).toContain('108M');
    expect(m.host.textContent).toContain('3 racks have no uplink, so no tasks');
    click(button(m.host, 'Load balancer · LC'));
    expect(m.host.querySelector('.p-title')?.textContent).toBe('Room load balancer');
    expect(m.host.textContent).toContain('Fewest tasks in flight');
    click(button(m.host, 'Port speeds and count'));
    expect(m.host.querySelector('.p-title')?.textContent).toBe('Network rack');
  });
});

describe('market row with boot pips', () => {
  const unit = { kind: 'system', id: systemId(0) } as const;
  const market = { unit, on: true, live: 1, total: 1, drains: false, running: true, parentOff: null } as const;
  const unitAct = (online: boolean) => onAction({ type: 'setOnline', unit, online });
  const key = () => m.host.querySelector<HTMLButtonElement>('.mk')!;
  it('one key reads the switch, On market or Off market, and toggles it; ten pips drain while switching', () => {
    m.render(<OnlineRow mode="onMarket" timerS={null} market={market} onToggle={unitAct} />);
    expect(m.host.querySelector('.p-online')?.getAttribute('data-state')).toBe('online');
    expect(key().textContent).toBe('On market');
    expect(m.host.textContent).toContain('Taking tasks');
    click(key());
    expect(acts).toEqual([{ type: 'setOnline', unit, online: false }]);

    m.render(<OnlineRow mode="goingOffline" timerS={6.3} market={{ ...market, on: false }} onToggle={unitAct} />);
    expect(m.host.textContent).toContain('Going offline · 7 s');
    expect(m.host.querySelectorAll('.sw-pips i.on')).toHaveLength(7);
    expect(key().textContent).toBe('Off market');
    expect(key().disabled).toBe(false);

    m.render(<OnlineRow mode="boot" timerS={2.5} bootS={5} market={market} onToggle={unitAct} />);
    expect(m.host.querySelectorAll('.sw-pips i.on')).toHaveLength(5);
    m.render(<OnlineRow mode="cold" timerS={10} market={market} onToggle={unitAct} />);
    expect(m.host.textContent).toContain('Swapping');
    expect(m.host.querySelectorAll('.sw-pips i.on')).toHaveLength(10);
    expect(key().disabled).toBe(true);
  });
  it('says Drains first with Graceful drain, counts a rack, and plans the next round between rounds', () => {
    m.render(<OnlineRow mode="onMarket" timerS={null} market={{ ...market, drains: true }} onToggle={unitAct} />);
    expect(m.host.textContent).toContain('Drains first');
    m.render(<OnlineRow mode="onMarket" timerS={null} market={{ ...market, unit: { kind: 'rack', id: rackId(0) }, live: 6, total: 12 }} onToggle={unitAct} />);
    expect(m.host.textContent).toContain('6 / 12 on market');
    m.render(<OnlineRow mode="offline" timerS={null} market={{ ...market, on: false, running: false }} onToggle={unitAct} />);
    expect(m.host.textContent).toContain('Sits out next round');
    m.render(<OnlineRow mode="offline" timerS={null} market={{ ...market, parentOff: 'rack' }} onToggle={unitAct} />);
    expect(m.host.textContent).toContain('Off with its rack');
    expect(key().textContent).toBe('On market');
  });
});

describe('server plate: previous and next', () => {
  const slot = (i: number, used: boolean): ServerSlotView => ({ ...LEVEL_FIXTURES.rack.servers[0], systemId: used ? systemId(i) : null, kind: used ? 'server' as const : null, state: used ? 'onMarket' as const : 'empty' as const,
    load: 0, running: i === 4 ? 2 : 0, admitted: 0, reserved: 0, timerS: null, timerTotalS: null, port: i === 2 ? null : port(5000, i) });
  const servers = Array.from({ length: 12 }, (_, i) => slot(i, [0, 2, 4].includes(i)));
  it('wraps through occupied slots only', () => {
    expect(neighbours(servers, 0)).toEqual([4, 2]);
    expect(neighbours(servers, 4)).toEqual([2, 0]);
    expect(neighbours([servers[0], ...servers.slice(5)], 0)).toBeNull();
  });
  it('steps with ‹ › keys and says when a server has no port', () => {
    const onStep = vi.fn(), onGoInside = vi.fn();
    m.render(<ServerPlate slot={2} servers={servers} market={{ unit: { kind: 'system', id: systemId(2) }, on: true, live: 1, total: 1, drains: false, running: true, parentOff: null }} onStep={onStep} onGoInside={onGoInside} onAction={onAction} onClose={onClose} />);
    expect(m.host.querySelector('.p-title')?.textContent).toBe('Server 3');
    expect(m.host.querySelector('.p-status')?.textContent).toBe('No switch port, so no tasks');
    click(button(m.host, '‹ Server 1'));
    click(button(m.host, 'Server 5 ›'));
    click(button(m.host, 'Go inside'));
    expect(onStep.mock.calls).toEqual([[0], [4]]);
    expect(onGoInside).toHaveBeenCalled();
    expect(m.host.querySelector('.p-online')).not.toBeNull();
  });
});
