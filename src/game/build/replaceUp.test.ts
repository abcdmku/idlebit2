import { applyAction } from '../core/actions';
import { baseRouter } from '../core/defaults';
import { buildState } from '../testkit/builders';
import type { RackBuild, RoomBuild, SiteBuild, SystemSpec } from '../types/build';
import { rackId, roomId, siteId, systemId, type NodeRef, type PartRef, type PartSlot, type ScopeRef } from '../types/ids';
import type { Quote, QuoteRequest } from '../types/quotes';
import type { GameState } from '../types/state';
import { evaluateGpu, GPU_MODEL_IDS, gpuModel, LADDERS } from './catalog';
import { readPart } from './partAccess';
import { quote } from './quotes';
import { defaultStartCtl } from './startCtl';

/**
 * User, 25 Oct: "you shouldnt be given a 'replace with' a lower tier". Every part sits at a mid generation
 * (gen 1; the GPU a mid gen-2 model), and no quote anywhere offers a replace at or below what is installed.
 */
const sys = systemId(0), rack = rackId(0), room = roomId(0), site = siteId(0);
const MID: SystemSpec = {
  kind: 'server', board: 'general',
  cpu: { cpu: { gen: 1, level: 1 }, cores: [{ gen: 1, level: 1 }, { gen: 1, level: 1 }], clock: { gen: 1, level: 2 },
    l1: { gen: 1, level: 2 }, l2: { gen: 1, level: 2 }, l3: { gen: 1, level: 2 } },
  cpuCount: 1, scheduler: { gen: 1, level: 2, strategy: 'fifo' },
  ram: [{ gen: 2, level: 3, ecc: false }], drives: [{ gen: 1, level: 2 }],
  accels: [{ kind: 'gpu', model: '2560', upgrades: 1 }, { kind: 'npu', gen: 1, level: 2 }],
  psu: { gen: 2, level: 12, capped: false }, settings: { dvfs: false, turbo: false, cStateLimit: 0 },
};
const ladder = (row: keyof typeof LADDERS, g: number) => LADDERS[row].baseK[g]!;

function midFleet(): GameState {
  return buildState({
    sites: 1, zonesPerSite: 1, racksPerZone: 1, serversPerRack: 1, unlocks: 'max', credits: '1' + '0'.repeat(40), data: '1' + '0'.repeat(30),
    system: (id, r, slot) => ({ id, rack: r, slot, online: true, spec: MID }),
    rack: (r: RackBuild) => ({ ...r, cooler: { ...r.cooler, gen: 1 }, pdu: { ...r.pdu, gen: 1 }, powerCtl: defaultStartCtl(1),
      switch: { ...r.switch, gen: 2, ports: r.switch.ports.map(() => ladder('switch', 2)), uplinks: r.switch.uplinks.map(() => ladder('switch', 2)) } }),
    room: (z: RoomBuild) => ({ ...z, cooler: { ...z.cooler, gen: 2 }, ups: z.ups.map((u) => ({ ...u, gen: 1 })), start: defaultStartCtl(1),
      switch: { ...z.switch, gen: 2, ports: z.switch.ports.map(() => ladder('roomSwitch', 2)), uplinks: z.switch.uplinks.map(() => ladder('roomSwitch', 2)) } }),
    site: (s: SiteBuild) => ({ ...s, dataPlane: { ...s.dataPlane, gen: 1, k: ladder('dataPlane', 1) }, grid: { ...s.grid, gen: 1 },
      backbone: { gen: 1, k: ladder('backbone', 1) }, generation: { gen: 1, level: 1 } }),
    global: { scheduler: baseRouter(1), start: defaultStartCtl(1) },
  });
}

const at = (unit: ScopeRef, slot: PartSlot): PartRef => ({ unit, slot });
const S: ScopeRef = { kind: 'system', id: sys }, R: ScopeRef = { kind: 'rack', id: rack }, Z: ScopeRef = { kind: 'room', id: room };
const T: ScopeRef = { kind: 'site', id: site }, G: ScopeRef = { kind: 'global' };
const PARTS_TO_SWEEP: readonly PartRef[] = [
  at(S, { kind: 'cpu', socket: 0 }), at(S, { kind: 'clock', socket: 0 }), at(S, { kind: 'l1', socket: 0 }), at(S, { kind: 'l2', socket: 0 }),
  at(S, { kind: 'l3', socket: 0 }), at(S, { kind: 'core', socket: 0, index: 0 }), at(S, { kind: 'scheduler' }), at(S, { kind: 'psu' }),
  at(S, { kind: 'ram', index: 0 }), at(S, { kind: 'drive', index: 0 }), at(S, { kind: 'gpu', index: 0 }), at(S, { kind: 'gpu', index: 1 }),
  at(R, { kind: 'rackCooler' }), at(R, { kind: 'pdu' }), at(R, { kind: 'lb' }), at(R, { kind: 'switch' }), at(R, { kind: 'powerCtl' }),
  at(Z, { kind: 'roomCooler' }), at(Z, { kind: 'roomLb' }), at(Z, { kind: 'roomSwitch' }), at(Z, { kind: 'ups', index: 0 }), at(Z, { kind: 'roomStart' }),
  at(T, { kind: 'dataPlane' }), at(T, { kind: 'grid' }), at(T, { kind: 'backbone' }), at(T, { kind: 'generation' }),
  at(G, { kind: 'globalScheduler' }), at(G, { kind: 'globalStart' }),
];
const NODES: readonly NodeRef[] = [{ level: 'chip', id: sys }, { level: 'system', id: sys }, { level: 'rack', id: rack }, { level: 'room', id: room }, { level: 'global', id: 0 }] as never;

function everyQuote(s: GameState): Quote[] {
  const requests: QuoteRequest[] = [
    ...PARTS_TO_SWEEP.map((part) => ({ kind: 'part', part }) as const),
    { kind: 'switch', sw: { kind: 'rack', id: rack } }, { kind: 'switch', sw: { kind: 'room', id: room } },
    ...(['cooling', 'power', 'lb', 'switch', 'powerCtl'] as const).map((slot) => ({ kind: 'infra', unit: { kind: 'rack', id: rack }, slot }) as const),
    ...(['cooling', 'power', 'lb', 'switch'] as const).map((slot) => ({ kind: 'infra', unit: { kind: 'room', id: room }, slot }) as const),
    ...[R, Z, T, G].map((unit) => ({ kind: 'power', unit }) as const),
    ...NODES.map((n) => ({ kind: 'tray', at: n }) as const),
    { kind: 'meet', system: sys, need: { cacheBits: 1e30, ramBits: 1e30, diskBits: 1e30, cores: 32, vramBits: 1e30, gpuCores: 1e9, ecc: true } } as QuoteRequest,
    ...Array.from({ length: 9 }, (_, g) => ({ kind: 'gpuModels', system: sys, index: 0, generation: (g + 1) as never }) as const),
  ];
  return requests.flatMap((r) => quote(s, r).quotes);
}

describe('replace only offers a higher generation (user, 25 Oct)', () => {
  const s = midFleet();

  it('installs a mid generation in every swept slot', () => {
    for (const ref of PARTS_TO_SWEEP) expect(readPart(s.build, ref), JSON.stringify(ref.slot)).not.toBeNull();
  });

  it('finds no replace at or below the installed generation in any quote', () => {
    const quotes = everyQuote(s);
    let replaces = 0;
    for (const q of quotes) {
      const a = q.action;
      if (a.type === 'replacePart') {
        const have = readPart(s.build, a.part);
        if (!have) continue; // an empty slot's install
        replaces += 1;
        expect(a.generation, `${q.label} over ${have.id} gen ${have.gen}`).toBeGreaterThan(have.gen);
      }
      if (a.type === 'installGpu' && a.index !== null) {
        const card = s.build.systems[sys]!.spec.accels[a.index]!;
        if (card.kind !== 'gpu') continue;
        replaces += 1;
        const was = evaluateGpu(card.model, 0), next = evaluateGpu(a.model, 0);
        expect(next.opsPerS, q.label).toBeGreaterThan(was.opsPerS);
        expect(next.vramBits, q.label).toBeGreaterThanOrEqual(was.vramBits);
      }
      if (a.type === 'replaceCpu') {
        const out = applyAction(s, a);
        if (out.ok) expect(out.state.build.systems[sys]!.spec.cpu!.cpu.gen, q.label).toBeGreaterThan(MID.cpu!.cpu.gen);
      }
    }
    // The sweep saw real upward replaces (it would pass vacuously on an empty list).
    expect(replaces).toBeGreaterThan(20);
  });

  it('the model picker omits sidegrades and lower cards; the actions refuse them too', () => {
    const picker = quote(s, { kind: 'gpuModels', system: sys, index: 0, generation: 2 }).quotes.map((q) => (q.action as { model: string }).model);
    expect(picker).not.toContain('2560');
    expect(picker).not.toContain('2330');
    expect(picker).toContain('2580');
    expect(GPU_MODEL_IDS.filter((m) => gpuModel(m)!.generation === 1).some((m) => picker.includes(m))).toBe(false);
    expect(applyAction(s, { type: 'installGpu', system: sys, index: 0, model: '2330' }).ok).toBe(false);
    expect(applyAction(s, { type: 'replacePart', part: at(S, { kind: 'ram', index: 0 }), generation: 1, preserveCapacity: false }).ok).toBe(false);
    expect(applyAction(s, { type: 'replacePart', part: at(R, { kind: 'switch' }), generation: 1, preserveCapacity: false }).ok).toBe(false);
    expect(applyAction(s, { type: 'replacePart', part: at(T, { kind: 'generation' }), generation: 0, preserveCapacity: false }).ok).toBe(false);
    expect(applyAction(s, { type: 'replacePart', part: at(S, { kind: 'ram', index: 0 }), generation: 3, preserveCapacity: false }).ok).toBe(true);
  });
});
