import { describe, expect, it } from 'vitest';
import { capacity } from '../build/catalog/curves';
import { POWER_CTL } from '../build/catalog/infra';
import { defaultStartCtl } from '../build/startCtl';
import { applyAction } from '../core/actions';
import { advanceGame, advanceGameOwned, copyGameState } from '../core/advance';
import { barebonesSpec, baseRouter } from '../core/defaults';
import { MODE } from '../core/timers';
import { buildState } from '../testkit/builders';
import type { StartCtl } from '../types/build';
import type { GameAction } from '../types/actions';
import type { GameState } from '../types/state';

/** D31 runtime: start controllers, standby, demand wake, rack batteries and site generation. */

const act = (s: GameState, a: GameAction): GameState => {
  const out = applyAction(s, a);
  if (!out.ok) throw new Error(JSON.stringify(out.rejection));
  return out.state;
};
/** End the opening round and Return: controllers and batteries apply at Return. */
const fromReturn = (s: GameState): GameState => act(act({ ...s, wallet: { ...s.wallet, credits: '1000000000000000000000000' as never } }, { type: 'endRound' }), { type: 'returnToMarket' });

interface Fleet { racks?: number; servers?: number; rack?: StartCtl | null; room?: StartCtl | null; global?: StartCtl | null; generation?: { gen: number; level: number } | null }
function fleet(f: Fleet = {}): GameState {
  const base = buildState({
    seed: 7, sites: 1, zonesPerSite: 1, racksPerZone: f.racks ?? 2, serversPerRack: f.servers ?? 4, unlocks: 'max',
    rack: (r) => ({ ...r, opened: true, powerCtl: f.rack === undefined ? null : f.rack }),
    room: (m) => ({ ...m, start: f.room ?? null }),
    site: (s) => ({ ...s, generation: f.generation ?? null }),
  });
  const global = { scheduler: f.global ? baseRouter(0) : base.build.global.scheduler, start: f.global ?? null };
  return { ...base, build: { ...base.build, global } };
}
const modesOf = (s: GameState, from: number, n: number) => [...s.hot.sys.mode.subarray(from, from + n)];
const billed = (s: GameState) => Number(s.ledger.energy) + s.wallet.energyMeter;

describe('D31 start controllers', () => {
  it('1. stays delta-invariant and owned = pure with all three controllers, batteries and mid-round wakes', () => {
    const ctl = { ...defaultStartCtl(1), trigger: { headWaitS: 1, busyPct: 60 } };
    const start = fromReturn(fleet({ rack: ctl, room: ctl, global: ctl }));
    const one = advanceGame(start, 20_000).state;
    const two = advanceGame(advanceGame(start, 7_300).state, 12_700).state;
    expect(two).toEqual(one);
    expect(advanceGameOwned(copyGameState(start), 20_000).state).toEqual(one);
  });

  it('2. never routes work to an asleep or standby system', () => {
    let s = fromReturn(fleet({ rack: { ...defaultStartCtl(0), trigger: { headWaitS: 2, busyPct: null } }, room: defaultStartCtl(0) }));
    let sleepers = 0;
    for (let i = 0; i < 400; i += 1) {
      s = advanceGame(s, 100).state;
      const h = s.hot.sys;
      for (let k = 0; k < h.len; k += 1) {
        if (h.mode[k] !== MODE.asleep && h.mode[k] !== MODE.standby) continue;
        sleepers += 1;
        expect(h.running[k]! + h.queueLen[k]! + h.reserved[k]!).toBe(0);
      }
    }
    expect(sleepers).toBeGreaterThan(0);
  });

  it('3. a generation-0 rack controller started with 1 system wakes the rest as the climb rises, with no head timeouts', () => {
    const s0 = fromReturn(fleet({ racks: 1, servers: 4, rack: { ...defaultStartCtl(0), trigger: { headWaitS: 1, busyPct: null } } }));
    expect(modesOf(s0, 0, 4)).toEqual([MODE.onMarket, MODE.asleep, MODE.asleep, MODE.asleep]);
    let s = s0, allAwakeAt = -1;
    for (let t = 1; t <= 600 && allAwakeAt < 0; t += 1) {
      s = advanceGame(s, 100).state;
      if (modesOf(s, 0, 4).every((m) => m === MODE.onMarket)) allAwakeAt = t;
    }
    // Generation 0 wakes one a second once the head waits 1 s: all four are up well inside a minute.
    expect(allAwakeAt).toBeGreaterThan(0);
    expect(allAwakeAt).toBeLessThan(600);
    expect(s.round.phase).toBe('running');
    const report = act(s, { type: 'endRound' }).round.reports.at(-1)!;
    expect(report.failedByCause.timeout).toBe(0);
  });
});

describe('D31 standby and batteries', () => {
  it('4. a standby rack draws 0 W and keeps its battery; a rack without Power control powers all its systems at Return', () => {
    const s0 = fromReturn(fleet({ racks: 2, servers: 2, rack: defaultStartCtl(0), room: { ...defaultStartCtl(0), trigger: { headWaitS: 9, busyPct: null } } }));
    expect([s0.hot.rack.powered[0], s0.hot.rack.powered[1]]).toEqual([1, 0]);
    expect(modesOf(s0, 2, 2)).toEqual([MODE.standby, MODE.standby]);
    const cap = capacity(POWER_CTL, 0, 1);
    expect(s0.hot.rack.batteryJ[1]).toBe(cap);
    const s = advanceGame(s0, 3_000).state;
    expect(s.hot.rack.powered[1]).toBe(0);
    expect(s.hot.rack.drawW[1]).toBe(0);
    expect(s.hot.rack.batteryJ[1]).toBe(cap);
    const plain = fromReturn(fleet({ racks: 1, servers: 3 }));
    expect(modesOf(plain, 0, 3)).toEqual([MODE.onMarket, MODE.onMarket, MODE.onMarket]);
  });

  it('5. a rack bills nothing while its battery lasts, then bills; Return refills it at 25% of the price', () => {
    const s0 = fromReturn(fleet({ racks: 1, servers: 2, rack: { ...defaultStartCtl(0), startWith: 2 } }));
    // Leave 2 s of charge at the rack's draw, so the test sees both sides.
    const warm = advanceGame(s0, 500).state;
    const drawW = warm.hot.rack.drawW[0]!;
    expect(drawW).toBeGreaterThan(0);
    const low = copyGameState(warm);
    low.hot.rack.batteryJ[0] = 2 * drawW;
    const during = advanceGame(low, 1_000).state;
    expect(billed(during)).toBeCloseTo(billed(low), 6);
    expect(during.hot.rack.batteryJ[0]).toBeGreaterThan(0);
    const after = advanceGame(during, 3_000).state;
    expect(after.hot.rack.batteryJ[0]).toBe(0);
    expect(billed(after)).toBeGreaterThan(billed(during));
    // Refill at Return: capacity minus what is left, at 25% of the us-east price (0.01).
    const ended = act(after, { type: 'endRound' });
    const back = act(ended, { type: 'returnToMarket' });
    expect(back.hot.rack.batteryJ[0]).toBe(capacity(POWER_CTL, 0, 1));
    expect(billed(back) - billed(ended)).toBeCloseTo(capacity(POWER_CTL, 0, 1) * 0.25 * 0.01, 3);
  });

  it('6. site generation meets draw first: solar imports nothing and refills free; a fuel cell bills 0.4 of the price', () => {
    const plain = fromReturn(fleet({ racks: 1, servers: 2 }));
    const solar = fromReturn(fleet({ racks: 1, servers: 2, generation: { gen: 0, level: 1 } }));
    const fuel = fromReturn(fleet({ racks: 1, servers: 2, generation: { gen: 2, level: 1 } }));
    const run = (s: GameState) => billed(advanceGame(s, 5_000).state) - billed(s);
    const base = run(plain);
    expect(base).toBeGreaterThan(0);
    expect(run(solar)).toBe(0);
    expect(run(fuel)).toBeCloseTo(0.4 * base, 6);
    // Solar headroom makes the site's marginal price 0, so the battery refill at Return is free.
    const withBattery = fromReturn(fleet({ racks: 1, servers: 2, rack: defaultStartCtl(0), generation: { gen: 0, level: 1 } }));
    const ended = act(advanceGame(withBattery, 2_000).state, { type: 'endRound' });
    const back = act(ended, { type: 'returnToMarket' });
    expect(back.hot.rack.batteryJ[0]).toBe(capacity(POWER_CTL, 0, 1));
    expect(billed(back)).toBe(billed(ended));
  });
});

describe('D31 configurations', () => {
  it('7. a rack configuration copies Power control and its Start settings', () => {
    const ctl: StartCtl = { ...defaultStartCtl(0, 2), startWith: 2, order: 'fastest', trigger: { headWaitS: 3, busyPct: null } };
    const s0 = fleet({ racks: 2, servers: 2 });
    const withCtl = { ...s0, build: { ...s0.build, racks: s0.build.racks.map((r, i) => (i === 0 && r ? { ...r, powerCtl: ctl } : r)) } };
    const saved = act({ ...withCtl, wallet: { ...withCtl.wallet, credits: '1000000000000000000' as never } }, { type: 'saveConfig', unit: { kind: 'rack', id: 0 as never }, name: 'battery' });
    const applied = act(saved, { type: 'applyConfig', unit: { kind: 'rack', id: 1 as never }, name: 'battery' });
    expect(applied.build.racks[1]!.powerCtl).toEqual(ctl);
    expect(BigInt(applied.wallet.credits)).toBeLessThan(BigInt(saved.wallet.credits));
  });
});

describe('QA-13 regressions', () => {
  it('a shard landing on a server switched off in transit fails as swap, never stranded in its queue', () => {
    // QA's case: the original powerRack fixture (eight kHz servers on a 4-port switch, start with 2), 10 s in, server 0 toggled off.
    const built = buildState({
      seed: 42, sites: 1, zonesPerSite: 2, racksPerZone: 1, serversPerRack: 8, unlocks: 'max', round: 'between', credits: '1000000000',
      system: (id, rack, slot) => ({ id, rack, slot, online: true, spec: barebonesSpec(1) }),
      rack: (r) => ({ ...r, powerCtl: { ...defaultStartCtl(0, 1), startWith: 2 } }),
    });
    let s = advanceGame(act(built, { type: 'returnToMarket' }), 10_000).state;
    s = act(s, { type: 'setOnline', unit: { kind: 'system', id: 0 as never }, online: false });
    s = advanceGame(s, 12_000).state;
    expect(s.hot.sys.mode[0]).toBe(MODE.offline);
    expect(s.hot.sys.queueLen[0]! + s.hot.sys.running[0]! + s.hot.sys.reserved[0]!).toBe(0);
  });

  it('a start controller keeps and wakes only servers with a switch port', () => {
    // Eight servers on the starter 4-port switch: four have no link and can never take work.
    let s = fromReturn(fleet({ racks: 1, servers: 8, rack: { ...defaultStartCtl(0), startWith: 2, order: 'fastest', trigger: { headWaitS: 1, busyPct: null } } }));
    const port = s.compiled.sys.port;
    for (let i = 0; i < 300; i += 1) {
      s = advanceGame(s, 100).state;
      for (let k = 0; k < 8; k += 1) {
        if (port[k]! >= 0) continue;
        expect(s.hot.sys.mode[k] === MODE.onMarket && s.hot.sys.running[k]! > 0).toBe(false);
        expect(s.hot.sys.wakeTicks[k]).toBe(0);
      }
    }
  });
});
