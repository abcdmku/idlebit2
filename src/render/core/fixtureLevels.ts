// Development and test fixture: two plain box levels (system board, chip) and a minimal
// RenderSnapshot. No sim code runs. Real levels come from R2 and R3.
import type { ChipSnapshot, GameEvent, RenderSnapshot, SupplyView, SystemSnapshot } from '../../game';
import { systemId } from '../../game';
import { ZERO_AMOUNT } from '../../game/amount';
import { copyRect, rect } from './geom';
import { P } from './palette';
import { R, prism } from './px';
import { silk } from './glyphs';
import { resetHitTarget } from './types';
import type { LevelRegistry, LevelRenderer, LevelSnapshot } from './types';
import type { Completion } from './pops';
import { drawUnitLamp, lampState } from './unit';

export const CHIP_SLOT = rect(52, 55, 76, 76);
export const SAVE_AT = rect(180, 16, 7, 7);
const chipSize = rect(0, 0, 192, 192), boardSize = rect(0, 0, 200, 256);
const chipFocus = rect(24, 10, 144, 178), boardFocus = rect(4, 4, 192, 248);
const SUPPLY: SupplyView = { kind: 'psu', generation: 0, level: 1, capacityW: 4, deliveredW: 0, usage: 0,
  overloadS: 0, failed: false, rebootMs: null, loss: 0, lossW: 0, capped: false, capFactor: 1, creditsPerMinute: 0 };

export function fixtureChip(online: ChipSnapshot['online'] = 'onMarket'): ChipSnapshot {
  return {
    level: 'chip', parent: { level: 'system', id: systemId(0) }, systemId: systemId(0), cpuCount: 1, online, tier: 0, psu: SUPPLY,
    clock: { hz: 1, effectiveHz: 1, generation: 0, level: 1 }, coreSites: 4,
    cores: [], cache: { levels: [], usedBits: 0, capacityBits: 0, spilledOutBits: 0 }, scheduler: null, queue: [], researchShare: 0, slots: [],
    pipe: { speed: 1000, transfer: null, waiting: false },
  };
}
export function fixtureSystem(online: SystemSnapshot['online'] = 'onMarket'): SystemSnapshot {
  const part = { slot: 0, kind: 'cpu' as const, generation: 0, level: 1, active: false, resourceBusy: 0 };
  return {
    level: 'system', parent: null, systemId: systemId(0), kind: 'server', board: 'general', cpuCount: 1, ramSlots: 1, etaCfg: 1,
    chip: fixtureChip(online), inbound: null, cpuBusy: [0], online, timerS: null, timerTotalS: null, cpu: part, ram: [], gpu: [], storage: [],
    psu: SUPPLY,
    running: [], memory: { tiers: [] }, queue: { cap: 0, count: 0, sample: [] }, reserved: 0, rates: { ops: 0, ramBits: 0, gpuOps: 0, ioBits: 0 },
    capacities: { cache: 0, ram: 0, vram: 0, storage: 0 }, used: { memory: 0, vram: 0, storage: 0 }, drawW: 0, saveable: true, slots: [],
  };
}
/** A complete idle snapshot for render core tests and the development harness. */
export function fixtureSnapshot(focus: LevelSnapshot, partner: LevelSnapshot | null = null,
  o: { simTimeMs?: number; epoch?: number; round?: 'running' | 'ended' | 'between'; events?: readonly GameEvent[]; completions?: readonly Completion[] } = {}): RenderSnapshot {
  const events = o.events ?? [];
  const round = o.round ?? 'running';
  return {
    completions: o.completions ?? [], failures: [], shardsDone: [],
    epoch: o.epoch ?? 1, tick: Math.floor((o.simTimeMs ?? 0) / 100), simTimeMs: o.simTimeMs ?? 0, bootMs: 10_000,
    hud: { credits: ZERO_AMOUNT, data: ZERO_AMOUNT, netPerMinute: ZERO_AMOUNT, sla: { met: 0, failed: 0, percent: 100, deliveredWork: 0, failedWork: 0, grace: 10 },
      roundState: round, roundIndex: 1, roundElapsedMs: o.simTimeMs ?? 0, autoReturnInMs: null },
    feed: { roundIndex: round === 'running' ? 1 : 2, timing: round === 'running' ? 'running' : 'onReturn',
      window: [], research: null, headDeadlineTick: round === 'running' ? 99 : null, blockedBy: null, transfers: [],
      inTransfer: 0, queued: 0, running: 0, taken: 0, dismissed: 0, intensity: 1, takesPerSec: 0,
      recentOutcomes: [], liveFailures: null, rates: { met: 0, fail: 0 }, failBin: null },
    research: { active: null, name: null, progress: 0, stoppedInsolvent: false, needsData: false, queued: 0, opsPerSec: 0 },
    unlocked: { chip: true, system: true, rack: true, room: true, global: true },
    home: { chip: { level: 'chip', id: systemId(0) }, system: { level: 'system', id: systemId(0) } },
    round: { index: 1, state: round, lastReport: null, canReturn: false, autoReturn: { available: false, on: false, inMs: null } },
    focus, partner, events, firstSeq: events[0]?.seq ?? 0, lastSeq: events.at(-1)?.seq ?? 0,
  };
}

export function createFixtureLevels(registry: LevelRegistry): readonly [LevelRenderer<'system'>, LevelRenderer<'chip'>] {
  const chip: LevelRenderer<'chip'> = {
    id: 'chip', name: 'Fixture chip',
    size: (_s, out) => copyRect(chipSize, out),
    focus: (_s, _vp, out) => copyRect(chipFocus, out),
    draw(g) {
      prism(g, 36, 20, 120, 160, 2, { top: P.wafer, front: P.waferLo });
      for (let i = 0; i < 14; i++) { R(g, 29, 25 + i * 10, 4, 4, P.pad); R(g, 159, 25 + i * 10, 4, 4, P.pad); }
      for (let i = 0; i < 4; i++) prism(g, 47 + (i & 1) * 47, 65 + (i >> 1) * 47, 39, 33, 3, { top: P.logic, front: P.logicLo });
      silk(g, 48, 169, 'FIXTURE CHIP');
    },
    drawMini(g, source, r) {
      R(g, r.x, r.y, r.w, r.h, P.wafer);
      for (let i = 0; i < 4; i++) R(g, r.x + 8 + (i & 1) * 34, r.y + 14 + (i >> 1) * 30, 26, 22, source.cpu.active ? P.logicHi : P.logic);
    },
    children: () => 0,
    targets: (_s, _v, _out, from) => from,
    icon: g => R(g, 2, 2, 12, 12, P.wafer),
  };
  const board: LevelRenderer<'system'> = {
    id: 'system', name: 'Fixture board',
    size: (_s, out) => copyRect(boardSize, out),
    focus: (_s, _vp, out) => copyRect(boardFocus, out),
    draw(g, s, _view, frame) {
      prism(g, 8, 12, 184, 232, 4, { top: P.mask, front: P.maskLo });
      for (let i = 0; i < 18; i++) R(g, 18, 37 + i * 10, 164, 1, P.maskHi);
      registry.level('chip').drawMini(g, s, CHIP_SLOT, frame);
      drawUnitLamp(g, 20, 20, 10, lampState(s.online), (s.timerS ?? 0) * 1000, 10_000, frame.paused);
      silk(g, 20, 234, 'TAP CHIP TO ZOOM');
    },
    drawMini: (g, _source, r) => R(g, r.x, r.y, r.w, r.h, P.mask),
    children(s, out) { out[0].ref = { level: 'chip', id: s.systemId }; copyRect(CHIP_SLOT, out[0].rect); return 1; },
    targets(s, _view, out, from) {
      const t = resetHitTarget(out[from], 'save', 'save', { level: 'system', id: s.systemId });
      t.unit = { kind: 'system', id: s.systemId }; copyRect(SAVE_AT, t.rect); return from + 1;
    },
    payoutAnchor: (s, c, out) => (c.system === s.systemId ? (copyRect(CHIP_SLOT, out), 0) : -1),
    faults: (s, out) => (s.online === 'crashed' ? (copyRect(CHIP_SLOT, out[0]), 1) : 0),
    icon: g => R(g, 2, 1, 12, 14, P.mask),
  };
  return [board, chip];
}
