import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChipSnapshot, Quote, RenderSnapshot, SystemSnapshot } from '../../../game';
import { familyId } from '../../../game';
import { P, bandColor, createLevelRegistry, rect } from '../../core';
import type { WorldFrame } from '../../core';
import { recordingContext } from '../../core/testCanvas';
import { createChipRenderer } from '.';
import { coreSites, coreText, floorOf } from './layout';
import { chipScene } from './scenes';
import { drawWorld } from './world';

const VIEW = { selectedId: null, picked: null, quotes: null, reducedMotion: false };
beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => recordingContext().g as unknown as ReturnType<HTMLCanvasElement['getContext']>);
});
afterEach(() => vi.restoreAllMocks());
function frameAt(chip: ChipSnapshot, timeMs: number, paused = false): WorldFrame {
  const snapshot = { epoch: 1, tick: Math.floor(timeMs / 100), simTimeMs: timeMs, focus: chip, partner: null, events: [], lastSeq: 0, research: { progress: 0.4 } } as unknown as RenderSnapshot;
  return { snapshot, timeMs, paused, reducedMotion: false, zoom: null, form: 'desktop', visible: null };
}
function draw(chip: ChipSnapshot, timeMs: number, o: { paused?: boolean } = {}) {
  const rec = recordingContext();
  createChipRenderer(createLevelRegistry()).draw(rec.g, chip, VIEW, frameAt(chip, timeMs, o.paused));
  return rec.fills;
}
describe('CPU shards (D25)', () => {
  const sites = coreSites(floorOf('desktop'), 2), PAR = bandColor(familyId(13));
  const onSite = (fills: ReturnType<typeof draw>, r: { x: number; y: number; w: number; h: number }, c: string) =>
    fills.filter(q => q.c === c && q.x >= r.x && q.x + q.w <= r.x + r.w && q.y >= r.y && q.y + q.h <= r.y + r.h);
  it('outlines the cores of one shard as one group, joined across the gap, in the task type colour', () => {
    const fills = draw(chipScene('shard'), 2000), [a, b] = [sites[0]!, sites[1]!];
    for (const r of [a, b]) expect(fills.some(q => q.c === PAR && q.x === r.x && q.y === r.y && q.w === r.w && q.h === 1)).toBe(true);
    const gap = b.x - (a.x + a.w);
    expect(fills.filter(q => q.c === PAR && q.x === a.x + a.w && q.w === gap && q.h === 1).map(q => q.y)).toEqual([a.y, a.y + a.h - 1]);
  });
  it('does not join cores running different shards', () => {
    const mid = chipScene('mid'), [a, b] = [sites[0]!, sites[1]!], c = bandColor(familyId(2));
    const fills = draw(mid, 2000);
    expect(fills.some(q => q.c === c && q.x === a.x && q.y === a.y && q.w === a.w && q.h === 1)).toBe(true);
    expect(fills.filter(q => q.c === c && q.x === a.x + a.w && q.w === b.x - a.x - a.w)).toEqual([]);
    const split = { ...mid, cores: mid.cores.map(k => ({ ...k, taskId: 9, shard: k === mid.cores[0] ? 0 : 1 })) };
    expect(draw(split, 2000).filter(q => q.c === c && q.x === a.x + a.w && q.w === b.x - a.x - a.w)).toEqual([]);
  });
  it('drains each core piece: the gauge holds the remaining work, 1 - progress', () => {
    const r = sites[0]!, c = coreText(r, 'wide'), inner = r.w - 2 * c.pad - 2;
    const gauge = (progress: number) => {
      const chip = chipScene('shard');
      const s = { ...chip, cores: chip.cores.map(k => ({ ...k, progress })) };
      const fills = draw(s, 2000);
      return sites.flatMap(r => fills.filter(q => q.c === PAR && q.y === c.bar + 1 && q.x === r.x + c.pad + 1).map(q => q.w));
    };
    expect(gauge(0)).toEqual([inner, inner]);
    expect(gauge(0.4)).toEqual([Math.round(inner * 0.6), Math.round(inner * 0.6)]);
    expect(gauge(1)).toEqual([]);
  });
  it('drains a piece on every small grid core too, and joins grid neighbours of one shard', () => {
    const max = chipScene('max'), grid = coreSites(floorOf('desktop', 32), 32), fills = draw(max, 2000);
    const c1 = bandColor(familyId(2)), r1 = grid[1]!, r2 = grid[2]!;
    // Under the speed label: the task's type mini, then its piece draining beside it along the foot.
    expect(onSite(fills, r1, c1).some(q => q.h === 2 && q.x === r1.x + 11 && q.y === r1.y + r1.h - 7 && q.w === Math.round((r1.w - 15) * (1 - max.cores[1]!.progress)))).toBe(true);
    expect(fills.some(q => q.c === c1 && q.x === r1.x + r1.w && q.w === r2.x - r1.x - r1.w)).toBe(true);
    // cores 2 and 3 run different shards (3 is idle): no bridge
    expect(fills.some(q => q.c === c1 && q.x === r2.x + r2.w && q.w === grid[3]!.x - r2.x - r2.w)).toBe(false);
  });
  it('draws no pieces or groups while paused', () => {
    const fills = draw(chipScene('shard'), 2000, { paused: true });
    expect(fills.filter(q => q.c === PAR)).toEqual([]);
  });
  it('lights each busy core of the mini as a lane in its shard colour, filled to its remaining work', () => {
    const level = createChipRenderer(createLevelRegistry()), rec = recordingContext(), r = rect(17, 63, 36, 36), chip = chipScene('shard');
    level.drawMini(rec.g, { chip, systemId: chip.systemId } as unknown as SystemSnapshot, r, frameAt(chip, 0));
    const lanes = rec.fills.filter(q => q.c === PAR);
    expect(lanes).toHaveLength(2);
    const box = rec.fills.find(q => q.c === P.logicLo && q.x === lanes[0]!.x && q.w === lanes[0]!.w)!;
    expect(lanes[0]!.h).toBe(Math.round(box.h * 0.6));
    expect(lanes[0]!.y + lanes[0]!.h).toBe(box.y + box.h);
  });
});

describe('A25 per-core gold bracket', () => {
  it('never brackets an installed core: a core has no upgrade of its own (D34, no lanes)', () => {
    const chip = chipScene('mid'), [a, b] = coreSites(floorOf('desktop'), 2), rec = recordingContext();
    const quote = (index: number, affordable: boolean): Quote => ({ action: { type: 'upgradePart', part: { unit: { kind: 'system', id: chip.systemId }, slot: { kind: 'core', socket: 0, index } } },
      label: 'Upgrade', cost: '10' as Quote['cost'], currency: 'credits', affordable, locked: null, cold: false, downtimeMs: 0, effect: null, workOps: null });
    drawWorld(rec.g, chip, frameAt(chip, 2000), 'desktop', { ...VIEW, quotes: { configRevision: 1, quotes: [quote(0, false), quote(1, true)] } });
    const gold = rec.fills.filter(q => q.c === P.gold);
    expect(gold.filter(q => q.x >= a!.x - 2 && q.x <= b!.x + b!.w + 2 && q.y >= a!.y - 2 && q.y <= a!.y + a!.h + 2)).toEqual([]);
  });
});
