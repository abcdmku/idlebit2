// DEV-only plate kit: every plate and the research list on fixture quotes, at
// /src/ui/plates/kit-qa.html?scene=<id>[&land]. The sim's quotes are still stubs, so this is
// how the plates are compared against the mockup shots. Never imported by the game.
import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { LEVEL_FIXTURES } from '../../game/fixtures';
import {
  rackId, researchId, roomId, systemId, type Amount, type GameAction, type LevelId, type LockReason, type PartRef, type Quote,
  type QuoteResult, type ResearchNodeView, type ServerSlotView, type SwitchView,
} from '../../game';
import { ConfigPlate } from './ConfigPlate';
import { CoolerPlate } from './CoolerPlate';
import { LbPlate } from './LbPlate';
import { NetworkRackPlate } from './NetworkRackPlate';
import { PartPlate } from './PartPlate';
import { SavePrompt } from './SavePrompt';
import { SupplyPlate } from './SupplyPlate';
import { SwitchPlate } from './SwitchPlate';
import { ServerPlate, UnitPlate } from './UnitPlate';
import { ResearchList } from '../research/ResearchDrawer';
import '../styles/tokens.css';
import '../styles/shell.css';

const params = new URLSearchParams(location.search);
const land = params.has('land'), scene = params.get('scene') ?? 'switch';
const W = land ? 844 : 390, H = land ? 390 : 780;
const bounds = land ? { x: 238, y: 8, w: W - 238 - 110, h: H - 16 } : { x: 8, y: 142, w: W - 16, h: H - 142 - 158 };

const q = (action: GameAction, cost: number, extra: Partial<Quote> = {}): Quote => ({ action, label: '', cost: String(cost) as Amount, currency: 'credits',
  affordable: true, locked: null, cold: false, downtimeMs: 0, effect: null, workOps: null, ...extra });
const R = (quotes: Quote[]): QuoteResult => ({ configRevision: 1, quotes });
const lockR = (node: string, text: string): LockReason => ({ code: 'research', node: researchId(node), text });
const eff = (before: number, after: number, unit: 'ops/s' | 'W' | 'bit/s' | 'tasks/s', paybackS: number | null, w0 = 2, w1 = 3) =>
  ({ capacityBefore: before, capacityAfter: after, unit, wattsBefore: w0, wattsAfter: w1, energyPerMinuteDelta: '1' as Amount, paybackS });
const noop = () => undefined, act = (a: GameAction) => console.info('action', JSON.stringify(a));
const common = { bounds, onAction: act, onClose: noop, onResearch: noop, researchName: (id: string) => ({ fabKhz: 'kHz fab', sw1M: 'MHz switching', rackWater: 'Rack water' } as Record<string, string>)[id] ?? id };

const sys = systemId(0), rack = { kind: 'rack', id: rackId(0) } as const, room = roomId(0);
const clockPart: PartRef = { unit: { kind: 'system', id: sys }, slot: { kind: 'clock', socket: 0 } };
const port = (speedHz: number, peer: number | null, active = false) => ({ speedHz, rung: 0, peer, active, family: null, progress: 0, queued: 0 });
const rackSwitch = (same: boolean): SwitchView => ({ generation: 0, topHz: 500_000, sameSpeed: same, portCeiling: 12,
  ports: [port(50_000, 0, true), port(20_000, 1), port(5_000, 2), port(5_000, 3), port(2_000, 4), port(1_000, 5)], uplinks: [port(20_000, null)] });
const portQuotes = (sw: { kind: 'rack' | 'room'; id: never }, n: number, base: number) =>
  Array.from({ length: n }, (_, i) => q({ type: 'upgradePort', sw, port: i }, base + i * 777, { effect: eff(5_000, 10_000, 'bit/s', null) }));
const lbView = { ...LEVEL_FIXTURES.rack.lb, level: 2, routedPerSec: 5, capacityPerSec: 12 };
const servers: ServerSlotView[] = LEVEL_FIXTURES.rack.servers.map((s, i) => i < 6
  ? { ...s, systemId: systemId(i), kind: 'server', state: i === 3 ? 'boot' : 'onMarket', running: i % 3, timerS: i === 3 ? 6.2 : null, timerTotalS: i === 3 ? 10 : null,
    port: i === 5 ? null : port(5000, i) }
  : s);

const lbQuotes = (unit: typeof rack | { kind: 'room'; id: typeof room }) => R([
  q({ type: 'upgradePart', part: { unit, slot: { kind: unit.kind === 'rack' ? 'lb' : 'roomLb' } } }, 30_700, { effect: eff(12, 24, 'tasks/s', null) }),
  ...(['firstFit', 'roundRobin', 'leastConn', 'binPack'] as const).map((s) => q({ type: 'setStrategy', unit, strategy: s }, 0,
    { locked: s === 'roundRobin' ? lockR('lbRoundRobin', 'Needs Round robin research') : null })),
  q({ type: 'setFilter', unit, filter: 'capability', on: true }, 0),
  q({ type: 'setFilter', unit, filter: 'thermal', on: true }, 0, { locked: lockR('thermalAware', 'Needs Thermal-aware research') }),
  q({ type: 'setPlacement', unit, mode: 'gang', on: true }, 0, { locked: lockR('gangRack', 'Needs Gang scheduling research') }),
]);

const addQuotes = (kind: 'system' | 'rack') => {
  const parent = kind === 'system' ? rack : { kind: 'room' as const, id: room }, a = (source: never, cost: number, label: string, extra: Partial<Quote> = {}) =>
    q({ type: 'addUnit', parent, slot: 7, source }, cost, { label, ...extra });
  return R([
    a({ kind: 'barebones', tier: 0 } as never, kind === 'system' ? 40 : 9_600, 'Hz'),
    a({ kind: 'barebones', tier: 1 } as never, kind === 'system' ? 2_400 : 96_000, 'kHz'),
    a({ kind: 'barebones', tier: 2 } as never, 96_000, 'MHz', { locked: lockR('fabMhz', 'Needs MHz fab research') }),
    a({ kind: 'barebones', tier: 3 } as never, 4_100_000, 'GHz', { locked: lockR('fabGhz', 'Needs GHz fab research') }),
    ...[3_100, 2_980, 980, 1_200].map((c, i) => a({ kind: 'copy', from: { kind: kind === 'system' ? 'system' : 'rack', id: i } } as never, c,
      kind === 'system' ? `Server ${i + 1}` : `Rack ${'ABCD'[i]}`)),
    a({ kind: 'saved', name: 'kHz web box 2' } as never, 3_100, 'kHz web box 2'),
    a({ kind: 'saved', name: 'Hz starter' } as never, 40, 'Hz starter'),
    a({ kind: 'saved', name: 'GPU render 1' } as never, 18_400, 'GPU render 1', { locked: lockR('gpu', 'Needs Vector compute research') }),
  ]);
};

const node = (id: string, name: string, state: ResearchNodeView['state'], extra: Partial<ResearchNodeView> = {}): ResearchNodeView => ({
  id: researchId(id), name, category: 'compute', state, progress: 0, dataCost: '150000' as Amount, workOps: 3e6, requires: [], lockedBy: null,
  level: 'system', era: 'khz', tier: 6, needsData: false, effect: '', summary: '', ...extra });
const tree = (phase: 'running' | 'between') => ({
  nodes: [node('fabKhz', 'kHz fab', 'active', { progress: 0.4, effect: 'Gen 1 of core, clock, L1, L2, L3, scheduler and CPU package' }),
    node('l3Cache', 'L3 cache', 'available', { effect: 'New chip part L3, shared', dataCost: '5000' as Amount, workOps: 3e5 }),
    node('octaCore', '8 cores', 'locked', { lockedBy: researchId('fabKhz'), effect: 'Core sites 4→8' }),
    node('ddr', 'DDR', 'available', { category: 'memory', needsData: true, effect: 'RAM gen 1: 2× bandwidth', dataCost: '2000000' as Amount }),
    node('rackWater', 'Rack water', 'locked', { category: 'cooling', lockedBy: researchId('rack'), effect: 'Rack cooler technology 2: water' }),
    node('pipelining', 'Pipelining', 'done')],
  active: researchId('fabKhz'), mode: 'shared' as const, opsPerSec: 6400, queue: [], queueSlots: 0, horizon: 'system' as const, lenders: [],
  creditsPerMinute: (phase === 'between' ? '9960' : '0') as Amount,
});
const supplyPdu = { ...LEVEL_FIXTURES.rack.pdu, level: 2, capacityW: 4096, deliveredW: 4710, usage: 1.15, overloadS: 6.2, lossW: 520, loss: 0.11 };
const scenes: Record<string, { level: LevelId; plate: ReactNode }> = {
  part: { level: 'system', plate: <PartPlate {...common} title="Clock" sub="1 kHz" level={2} pips={[2, 4]} status="Drives every lane on the die" lines={[]}
    quotes={R([q({ type: 'upgradePart', part: clockPart }, 360, { effect: eff(1000, 2000, 'ops/s', 250) }),
      q({ type: 'replacePart', part: clockPart, generation: 1, preserveCapacity: true }, 2_400, { label: 'kHz clock', cold: true, downtimeMs: 10_000, effect: eff(1000, 16_000, 'ops/s', 7_500, 2, 6) })])} /> },
  'part-locked': { level: 'system', plate: <PartPlate {...common} title="Clock" sub="1 kHz" level={4} pips={[4, 4]} status="Drives every lane on the die"
    quotes={R([q({ type: 'replacePart', part: clockPart, generation: 1, preserveCapacity: true }, 2_400, { label: 'kHz clock', cold: true, downtimeMs: 10_000, locked: lockR('fabKhz', 'Needs kHz fab research') })])} /> },
  psu: { level: 'system', plate: <SupplyPlate {...common} supply={{ ...LEVEL_FIXTURES.system.psu, capacityW: 64, deliveredW: 5.5, usage: 0.086, lossW: 1.65 }} maxLevel={4}
    quotes={R([q({ type: 'upgradePart', part: { unit: { kind: 'system', id: sys }, slot: { kind: 'psu' } } }, 180, { effect: eff(64, 128, 'W', null) })])} /> },
  pdu: { level: 'rack', plate: <SupplyPlate {...common} supply={supplyPdu} maxLevel={4}
    quotes={R([q({ type: 'upgradePart', part: { unit: rack, slot: { kind: 'pdu' } } }, 7_480, { effect: eff(4096, 8192, 'W', null) }),
      q({ type: 'replacePart', part: { unit: rack, slot: { kind: 'pdu' } }, generation: 1, preserveCapacity: true }, 64_000, { label: 'Metered PDU', cold: true, downtimeMs: 10_000, locked: lockR('meteredPdu', 'Needs Metered PDU research') })])} /> },
  cooler: { level: 'rack', plate: <CoolerPlate {...common} unit={rack} cooler={{ ...LEVEL_FIXTURES.rack.cooler, level: 2, capacityW: 600, watts: 140, equilibriumF: 84 }}
    lump={{ tempF: 83, crashS: 0, crashed: false, eff: 0.93 }} maxLevel={4}
    quotes={R([q({ type: 'upgradePart', part: { unit: rack, slot: { kind: 'rackCooler' } } }, 23_400, { effect: eff(600, 1100, 'W', null) }),
      q({ type: 'replacePart', part: { unit: rack, slot: { kind: 'rackCooler' } }, generation: 1, preserveCapacity: true }, 64_000, { label: 'Water loop', cold: true, downtimeMs: 10_000, locked: lockR('rackWater', 'Needs Rack water research') }),
      q({ type: 'setSetpoint', unit: rack, setpointF: 70 }, 0, { locked: lockR('fanControl', 'Needs Fan control research') })])} /> },
  switch: { level: 'rack', plate: <SwitchPlate {...common} sw={rack} view={rackSwitch(false)} units={7} initialPort={2}
    quotes={R([...portQuotes(rack as never, 6, 4_332), q({ type: 'addPorts', sw: rack }, 30_200),
      q({ type: 'replacePart', part: { unit: rack, slot: { kind: 'switch' } }, generation: 1, preserveCapacity: true }, 180_000, { label: '1 MHz switch', locked: lockR('sw1M', 'Needs MHz switching research') })])} /> },
  'switch-same': { level: 'rack', plate: <SwitchPlate {...common} sw={rack} view={rackSwitch(true)} units={6}
    quotes={R([...portQuotes(rack as never, 6, 4_332), q({ type: 'upgradePort', sw: rack, port: 'all' }, 61_400, { effect: eff(1, 100_000, 'bit/s', null) }), q({ type: 'addPorts', sw: rack }, 30_200)])} /> },
  lb: { level: 'rack', plate: <LbPlate {...common} unit={rack} view={lbView} quotes={lbQuotes(rack)} /> },
  netrack: { level: 'room', plate: <NetworkRackPlate {...common} room={room} zone={0} racks={6}
    network={{ switch: { ...rackSwitch(true), ports: Array.from({ length: 7 }, (_, i) => port(1e6, i < 6 ? i : null, i % 3 === 1)) }, lb: { ...lbView, strategy: 'leastConn' } }}
    quotes={R([q({ type: 'upgradePort', sw: { kind: 'room', id: room }, port: 'all' }, 108_000_000, { effect: eff(1e6, 2e6, 'bit/s', null) }), q({ type: 'addPorts', sw: { kind: 'room', id: room } }, 56_500)])}
    lbQuotes={lbQuotes({ kind: 'room', id: room })} /> },
  server: { level: 'rack', plate: <ServerPlate {...common} slot={3} servers={servers} onStep={noop} onGoInside={noop} /> },
  rackunit: { level: 'rack', plate: <UnitPlate {...common} unit={rack} title="Rack A" sub="6 servers" status="72°F · PDU 40%" mode="onMarket" timerS={null}
    lines={[{ text: '5 of 6 servers have a switch port', tone: 'muted' }]} onSave={noop} saveLabel="Save this rack" /> },
  'config-system': { level: 'rack', plate: <ConfigPlate {...common} kind="system" sub="Rack A · slot 8" credits={'1500' as Amount} landscape={land} quotes={addQuotes('system')} /> },
  'config-rack': { level: 'room', plate: <ConfigPlate {...common} kind="rack" sub="AZ a · slot 7" landscape={land} quotes={addQuotes('rack')} /> },
  save: { level: 'rack', plate: <SavePrompt bounds={bounds} unit={rack} defaultName="Rack A 1" onAction={act} onClose={noop} /> },
  research: { level: 'system', plate: <ResearchList tree={tree('running')} phase="running" focusProject={researchId('l3Cache')} onAction={act} onClose={noop} /> },
  'research-between': { level: 'system', plate: <ResearchList tree={tree('between')} phase="between" focusProject={null} onAction={act} onClose={noop} /> },
};

function Kit() {
  const s = scenes[scene] ?? scenes.switch;
  return <main className={`br-shell scr ${land ? 'l-desktop' : 'l-phone'}`} style={{ width: W, height: H }}>
    {s.plate}
  </main>;
}

createRoot(document.getElementById('root')!).render(<Kit />);
