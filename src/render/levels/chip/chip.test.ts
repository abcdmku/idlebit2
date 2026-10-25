import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChipSnapshot, GameEvent, RenderSnapshot, SystemSnapshot } from '../../../game';
import { LabelBuffer, P, bandColor, createHitTarget, createLevelRegistry, rect } from '../../core';
import { familyId } from '../../../game';
import type { WorldForm, WorldFrame } from '../../core';
import { recordingContext } from '../../core/testCanvas';
import { createChipRenderer } from '.';
import { coreSites, floorOf, queueWells } from './layout';
import { chipScene } from './scenes';

const VIEW = { selectedId: null, picked: null, quotes: null, reducedMotion: false };
beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => recordingContext().g as unknown as ReturnType<HTMLCanvasElement['getContext']>);
});
afterEach(() => vi.restoreAllMocks());

function frameAt(chip: ChipSnapshot, timeMs: number, o: { paused?: boolean; form?: WorldForm; events?: GameEvent[] } = {}): WorldFrame {
  const snapshot = { epoch: 1, tick: Math.floor(timeMs / 100), simTimeMs: timeMs, focus: chip, partner: null,
    events: o.events ?? [], lastSeq: 0, research: { progress: 0.4 } } as unknown as RenderSnapshot;
  return { snapshot, timeMs, paused: o.paused ?? false, reducedMotion: false, zoom: null, form: o.form ?? 'desktop', visible: null };
}
function draw(chip: ChipSnapshot, timeMs: number, o: Parameters<typeof frameAt>[2] = {}) {
  const level = createChipRenderer(createLevelRegistry()), rec = recordingContext();
  level.draw(rec.g, chip, VIEW, frameAt(chip, timeMs, o));
  return rec.fills;
}
function labels(chip: ChipSnapshot, form: WorldForm = 'desktop', paused = false): Record<string, string> {
  const level = createChipRenderer(createLevelRegistry()), out = new LabelBuffer();
  level.labels!(chip, VIEW, frameAt(chip, 2000, { form, paused }), out);
  const text: Record<string, string> = {};
  for (let i = 0; i < out.count; i++) {
    const l = out.labels[i]!, parts: string[] = [];
    for (let k = l.first; k < l.end; k++) parts.push(out.runs[k]!.text);
    text[l.id] = parts.join(' ');
  }
  return text;
}

describe('CPU floorplan (D17)', () => {
  it.each(['desktop', 'phone'] as const)('stacks IN, queue, cache, cores and clock, then OUT, top to bottom (%s)', form => {
    const f = floorOf(form), level = createChipRenderer(createLevelRegistry()), chip = chipScene('mid');
    expect(f.inp.y).toBe(f.die.y);
    expect(f.queue.y).toBeLessThan(f.cache.y); expect(f.cache.y).toBeLessThan(f.cores.y);
    expect(f.clock.y).toBe(f.cores.y); expect(f.out.y).toBe(f.die.y + f.die.h);
    expect(level.entry!(chip, { x: 0, y: 0 }, form)).toEqual(f.inp);
    expect(level.miniRect!(chip, rect(), form)).toEqual(f.pkg);
    const focus = level.focus(chip, rect(), rect(), form);
    expect(focus.x).toBeLessThanOrEqual(f.pkg.x); expect(focus.y + focus.h).toBeGreaterThanOrEqual(f.pkg.y + f.pkg.h);
    for (const b of [f.pkg, f.queue, f.cache, f.cores]) { expect(b.x % 4).toBe(0); expect(b.y % 4).toBe(0); }
  });
});

describe('CPU labels', () => {
  it('names every block with its snapshot value', () => {
    expect(labels(chipScene('mid'))).toMatchObject({
      queue: 'Queue 2 / 4', cache: 'Cache 64 bits · 48 bits in use', clock: 'Clock 1,024 Hz',
      core0: 'Core 1 1,024 Hz', core0s: 'AND Mask', core0f: '62%', core1s: 'AND Mask', core1f: '25%',
    });
    expect(labels(chipScene('mid'), 'phone')).toMatchObject({ cache: 'Cache 64 bits', core0: 'Core 1 1,024 Hz', core0s: 'AND Mask' });
  });
  it('never shows a task number', () => {
    for (const form of ['desktop', 'phone'] as const) for (const s of ['mid', 'max', 'landing'] as const) {
      expect(Object.values(labels(chipScene(s), form)).filter(t => t.includes('#'))).toEqual([]);
    }
  });
  it('shows the pipe landing on an idle core, the empty queue and a locked site at boot', () => {
    expect(labels(chipScene('landing'))).toMatchObject({ queue: 'Queue none', core0s: 'landing', core1: 'Core 2 locked' });
  });
  it('summarises a 32-core grid in one tag', () => {
    expect(labels(chipScene('max')).cores).toBe('Cores 21 / 32 busy');
  });
  it('shows nothing working while paused', () => {
    expect(labels(chipScene('mid'), 'desktop', true)).toMatchObject({ queue: 'Queue 0 / 4', core0s: 'idle' });
  });
});

describe('CPU motion', () => {
  const lamp = (fills: ReturnType<typeof draw>) => {
    const f = floorOf('desktop'), x = f.clock.x + f.clock.w - 6;
    return fills.filter(q => q.w === 2 && q.h === 2 && q.x === x).at(-1)?.c;
  };
  it('ticks the clock lamp with real cycles: twice a second at 1 Hz, steady at 1 kHz, dark when paused', () => {
    const slow = { ...chipScene('mid'), clock: { hz: 1, effectiveHz: 1, generation: 0, level: 1 } };
    const seq = Array.from({ length: 21 }, (_, i) => lamp(draw(slow, i * 100)));
    expect(seq.filter((c, i) => i > 0 && c !== seq[i - 1])).toHaveLength(4);
    const fast = Array.from({ length: 5 }, (_, i) => lamp(draw(chipScene('mid'), i * 37)));
    expect(new Set(fast)).toEqual(new Set([P.amber]));
    expect(lamp(draw(chipScene('mid'), 0, { paused: true }))).not.toBe(P.amber);
  });
  it('lights the IN pad only while a transfer lands, and OUT only after a payout', () => {
    const f = floorOf('desktop');
    const padAt = (fills: ReturnType<typeof draw>, y: number) => fills.filter(q => q.x === f.inp.x - 3 && q.y === y - 1 && q.w === 7).at(-1)?.c;
    expect(padAt(draw(chipScene('landing'), 2000), f.inp.y)).toBe(P.padHi);
    expect(padAt(draw(chipScene('boot'), 2000), f.inp.y)).toBe(P.pad);
    const met = { seq: 1, tick: 19, kind: 'met', family: 0, count: 1, system: 0 } as unknown as GameEvent;
    expect(padAt(draw(chipScene('mid'), 2000, { events: [met] }), f.out.y)).toBe(P.padHi);
    expect(padAt(draw(chipScene('mid'), 2500, { events: [met] }), f.out.y)).toBe(P.pad);
  });
});

describe('CPU task identities (R42)', () => {
  it('draws each queued task family icon in its well, oldest first, and the running task icon on its core', () => {
    const chip = chipScene('mid'), fills = draw(chip, 2000), f = floorOf('desktop');
    const wells = queueWells(f, chip.scheduler!.q, 'desktop');
    const colours = (r: { x: number; y: number; w: number; h: number }) => new Set(fills.filter(q => q.w === 1 && q.x >= r.x && q.x < r.x + r.w && q.y >= r.y - 2 && q.y < r.y + r.h).map(q => q.c));
    expect(colours(wells[0]!).has(bandColor(chip.queue[0]!.family))).toBe(true);
    expect(colours(wells[2]!).size).toBe(0);
    const site = coreSites(f, 2)[0]!;
    expect(colours({ x: site.x, y: site.y + 16, w: 20, h: 16 }).has(bandColor(familyId(2)))).toBe(true);
  });
});

describe('CPU targets', () => {
  it('offers every block, empty sites as slots, and the pipe as a link', () => {
    const level = createChipRenderer(createLevelRegistry()), out = Array.from({ length: 64 }, createHitTarget);
    const n = level.targets(chipScene('landing'), VIEW, out, 0, 'desktop');
    expect(out.slice(0, n).map(t => `${t.kind}:${t.id}`)).toEqual(['part:clock', 'part:cache', 'slot:queue', 'part:core0', 'slot:site1', 'link:pipe']);
    expect(out[0]!.part).toEqual({ unit: { kind: 'system', id: 0 }, slot: { kind: 'clock', socket: 0 } });
    const again = Array.from({ length: 64 }, createHitTarget);
    level.targets(chipScene('landing'), VIEW, again, 0, 'desktop');
    expect(again[0]!.part).toBe(out[0]!.part);
  });
});

describe('CPU mini', () => {
  it('draws the package inside the socket rect it is given', () => {
    const level = createChipRenderer(createLevelRegistry()), rec = recordingContext(), r = rect(17, 63, 36, 36);
    const chip = chipScene('mid');
    level.drawMini(rec.g, { chip, systemId: chip.systemId } as unknown as SystemSnapshot, r, frameAt(chip, 0));
    expect(rec.fills.length).toBeGreaterThan(5);
    for (const q of rec.fills) {
      expect(q.x).toBeGreaterThanOrEqual(r.x - 1); expect(q.x + q.w).toBeLessThanOrEqual(r.x + r.w + 1);
      expect(q.y).toBeGreaterThanOrEqual(r.y - 1); expect(q.y + q.h).toBeLessThanOrEqual(r.y + r.h + 1);
    }
  });
});
