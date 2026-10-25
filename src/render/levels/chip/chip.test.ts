import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChipSnapshot, GameEvent, PartRef, Quote, QuoteResult, RenderSnapshot, SystemSnapshot } from '../../../game';
import { LabelBuffer, P, bandColor, createHitTarget, createLevelRegistry, rect } from '../../core';
import { familyId, systemId } from '../../../game';
import type { WorldForm, WorldFrame } from '../../core';
import { recordingContext } from '../../core/testCanvas';
import { createChipRenderer } from '.';
import { arrangementOf, coreSites, coreText, floorOf, queueWells } from './layout';
import { chipScene } from './scenes';
import { chipAfford, createChipAfford, drawWorld } from './world';

const VIEW = { selectedId: null, picked: null, quotes: null, reducedMotion: false };
beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => recordingContext().g as unknown as ReturnType<HTMLCanvasElement['getContext']>);
});
afterEach(() => vi.restoreAllMocks());

function frameAt(chip: ChipSnapshot, timeMs: number, o: { paused?: boolean; form?: WorldForm; events?: GameEvent[]; scale?: number } = {}): WorldFrame {
  const snapshot = { epoch: 1, tick: Math.floor(timeMs / 100), simTimeMs: timeMs, focus: chip, partner: null,
    events: o.events ?? [], lastSeq: 0, research: { progress: 0.4 } } as unknown as RenderSnapshot;
  return { snapshot, timeMs, paused: o.paused ?? false, reducedMotion: false, zoom: null, form: o.form ?? 'desktop', visible: null, scale: o.scale };
}
function draw(chip: ChipSnapshot, timeMs: number, o: Parameters<typeof frameAt>[2] = {}) {
  const level = createChipRenderer(createLevelRegistry()), rec = recordingContext();
  level.draw(rec.g, chip, VIEW, frameAt(chip, timeMs, o));
  return rec.fills;
}
function labelBuffer(chip: ChipSnapshot, form: WorldForm = 'desktop', paused = false, scale?: number): LabelBuffer {
  const level = createChipRenderer(createLevelRegistry()), out = new LabelBuffer();
  level.labels!(chip, VIEW, frameAt(chip, 2000, { form, paused, scale }), out);
  return out;
}
function labels(chip: ChipSnapshot, form: WorldForm = 'desktop', paused = false, scale?: number): Record<string, string> {
  const out = labelBuffer(chip, form, paused, scale), text: Record<string, string> = {};
  for (let i = 0; i < out.count; i++) {
    const l = out.labels[i]!, parts: string[] = [];
    for (let k = l.first; k < l.end; k++) parts.push(out.runs[k]!.text);
    text[l.id] = parts.join(' ');
  }
  return text;
}
/** A label's anchor in art px. */
function anchor(out: LabelBuffer, id: string): { x: number; y: number } | null {
  for (let i = 0; i < out.count; i++) if (out.labels[i]!.id === id) return { x: out.labels[i]!.x, y: out.labels[i]!.y };
  return null;
}

describe('CPU floorplan (D17)', () => {
  it.each(['desktop', 'phone'] as const)('stacks IN, queue, cache, then cores and clock, top to bottom (%s)', form => {
    const f = floorOf(form), level = createChipRenderer(createLevelRegistry()), chip = chipScene('mid');
    expect(f.inp.y).toBe(f.die.y);
    expect(f.queue.y).toBeLessThan(f.cache.y); expect(f.cache.y).toBeLessThan(f.cores.y);
    expect(f.clock.y).toBe(f.cores.y);
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
      queue: 'Queue 2 / 4', cache: 'Cache 64 b · 48 b in use', clock: 'Clock 1.02 kHz',
      core0: 'Core 1 · 1.02 kHz', core0s: 'AND Mask', core0f: '62%', core1s: 'AND Mask', core1f: '25%',
    });
    expect(labels(chipScene('mid'), 'phone')).toMatchObject({ cache: 'Cache 64 b', core0: 'Core 1 1.02 kHz', core0s: 'AND Mask' });
  });
  it('arranges core text by art scale, not form (A01): stacked at N = 2 on the desktop floor', () => {
    const site = coreSites(floorOf('desktop'), 2)[0]!, chip = chipScene('mid');
    const wide = labelBuffer(chip, 'desktop', false, 3), stacked = labelBuffer(chip, 'desktop', false, 2), none = labelBuffer(chip, 'desktop');
    // wide: the name beside the icon, its progress under the name
    expect(anchor(wide, 'core0s')).toEqual({ x: site.x + 27, y: site.y + 16 });
    expect(labels(chip, 'desktop', false, 3)).toMatchObject({ core0: 'Core 1 · 1.02 kHz', core0f: '62%' });
    expect(anchor(none, 'core0s')).toEqual(anchor(wide, 'core0s'));
    // stacked: name / Hz / icon / task / bar, each on its own 8 art line
    expect(anchor(stacked, 'core0')).toEqual({ x: site.x + 4, y: site.y + 4 });
    expect(anchor(stacked, 'core0s')).toEqual({ x: site.x + 4, y: site.y + 40 });
    expect(labels(chip, 'desktop', false, 2)).toMatchObject({ core0: 'Core 1 1.02 kHz', core0s: 'AND Mask' });
    expect(labels(chip, 'desktop', false, 2)).not.toHaveProperty('core0f');
    expect(labels(chip, 'phone', false, 3)).toHaveProperty('core0f');
  });
  it('fits the stacked arrangement inside both forms\' core sites', () => {
    for (const form of ['desktop', 'phone'] as const) {
      const r = coreSites(floorOf(form), 2)[0]!, c = coreText(r, 'stacked');
      expect(c.icon.y + 16).toBeLessThanOrEqual(c.line.y);
      expect(c.line.y + 8).toBeLessThanOrEqual(c.bar);
      expect(c.bar + 4).toBeLessThanOrEqual(r.y + r.h);
      expect(r.w - 2 * c.pad).toBeGreaterThanOrEqual(16);
    }
    expect(arrangementOf(undefined, 'desktop')).toBe('wide');
    expect(arrangementOf(undefined, 'phone')).toBe('stacked');
    expect(arrangementOf(2, 'desktop')).toBe('stacked');
    expect(arrangementOf(3, 'phone')).toBe('wide');
  });
  it('never shows a task number', () => {
    for (const form of ['desktop', 'phone'] as const) for (const s of ['mid', 'max', 'landing'] as const) {
      expect(Object.values(labels(chipScene(s), form)).filter(t => t.includes('#'))).toEqual([]);
    }
  });
  it('shows the pipe landing on an idle core, and no text on locked sites at boot (A25)', () => {
    const text = labels(chipScene('landing'));
    expect(text).toMatchObject({ core0s: 'landing' });
    expect(text).not.toHaveProperty('queue'); expect(text).not.toHaveProperty('core1');
  });
  it('keeps a short dim label on open sites', () => {
    const open = { ...chipScene('landing'), coreSites: 2, slots: [{ kind: 'core', index: 1, locked: false }, { kind: 'scheduler', index: 0, locked: false }] } as ChipSnapshot;
    expect(labels(open)).toMatchObject({ queue: 'Queue none', core1: 'Core 2 empty' });
  });
  it('summarises a 32-core grid in one tag', () => {
    expect(labels(chipScene('max')).cores).toBe('Cores 21 / 32 busy · 4 GHz');
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
  it('lights the IN pad only while a transfer lands', () => {
    const f = floorOf('desktop');
    const padAt = (fills: ReturnType<typeof draw>, y: number) => fills.filter(q => q.x === f.inp.x - 3 && q.y === y - 1 && q.w === 7).at(-1)?.c;
    expect(padAt(draw(chipScene('landing'), 2000), f.inp.y)).toBe(P.padHi);
    expect(padAt(draw(chipScene('boot'), 2000), f.inp.y)).toBe(P.pad);
  });
  it('draws no output pad or trace below the cores', () => {
    const f = floorOf('desktop'), below = f.cores.y + f.cores.h;
    const metal = draw(chipScene('mid'), 2000).filter(q => q.y >= below && q.y < f.die.y + f.die.h && (q.c === P.pad || q.c === P.padHi || q.c === P.copper));
    expect(metal).toEqual([]);
  });
});

describe('CPU task identities (R42)', () => {
  it('draws each queued task family icon in its well, oldest first, and the running task icon on its core', () => {
    const chip = chipScene('mid'), fills = draw(chip, 2000), f = floorOf('desktop');
    const wells = queueWells(f, chip.scheduler!.q, 'desktop');
    const colours = (r: { x: number; y: number; w: number; h: number }) => new Set(fills.filter(q => q.h === 1 && q.x >= r.x && q.x < r.x + r.w && q.y >= r.y - 2 && q.y < r.y + r.h).map(q => q.c));
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

describe('CPU affordable brackets and locked sites (A25)', () => {
  const sys = systemId(0);
  const q = (action: Quote['action'], affordable = true, locked: Quote['locked'] = null): Quote => ({
    action, label: 'Buy', cost: '10' as Quote['cost'], currency: 'credits', affordable, locked, cold: false, downtimeMs: 0, effect: null, workOps: null,
  });
  const up = (slot: PartRef['slot'], affordable = true) => q({ type: 'upgradePart', part: { unit: { kind: 'system', id: sys }, slot } }, affordable);
  const add = (kind: 'core' | 'scheduler', affordable = true) => q({ type: 'addPart', system: sys, kind, generation: 0 }, affordable);
  const result = (...quotes: Quote[]): QuoteResult => ({ configRevision: 1, quotes });

  it('reads per-part affordability from the tray quotes, ignoring locked, unaffordable and other systems', () => {
    const a = chipAfford(result(up({ kind: 'clock', socket: 0 })), sys, createChipAfford());
    expect([a.clock, a.cache, a.queue, a.site]).toEqual([true, false, false, false]);
    const b = chipAfford(result(up({ kind: 'l1', socket: 0 }), add('core'), add('scheduler'), up({ kind: 'core', socket: 0, index: 1 })), sys, createChipAfford());
    expect([b.clock, b.cache, b.queue, b.site, b.core[0], b.core[1]]).toEqual([false, true, true, true, false, true]);
    const none = chipAfford(result(up({ kind: 'clock', socket: 0 }, false), q({ type: 'upgradePart', part: { unit: { kind: 'system', id: systemId(1) }, slot: { kind: 'l1', socket: 0 } } }),
      q(add('core').action, true, { code: 'research', node: null, text: 'Needs research' })), sys, b);
    expect([none.clock, none.cache, none.queue, none.site, none.core[1]]).toEqual([false, false, false, false, false]);
    expect(chipAfford(null, sys, createChipAfford()).clock).toBe(false);
  });
  it('draws a 1 art px gold bracket just outside each affordable part', () => {
    const f = floorOf('desktop'), chip = chipScene('mid'), rec = recordingContext();
    drawWorld(rec.g, chip, frameAt(chip, 2000), 'desktop', { ...VIEW, quotes: result(up({ kind: 'clock', socket: 0 })) });
    const gold = rec.fills.filter(r => r.c === P.gold);
    expect(gold.length).toBe(8);
    for (const r of gold) {
      expect(Math.min(r.w, r.h)).toBe(1);
      expect(r.x).toBeGreaterThanOrEqual(f.clock.x - 2); expect(r.x + r.w).toBeLessThanOrEqual(f.clock.x + f.clock.w + 2);
    }
    const plain = recordingContext();
    drawWorld(plain.g, chip, frameAt(chip, 2000), 'desktop', VIEW);
    expect(plain.fills.filter(r => r.c === P.gold)).toEqual([]);
  });
  it('brackets the next open core site when a core is affordable, never a locked one', () => {
    const boot = chipScene('landing'), sites = coreSites(floorOf('desktop'), 2), view = { ...VIEW, quotes: result(add('core'), add('scheduler')) };
    const locked = recordingContext();
    drawWorld(locked.g, boot, frameAt(boot, 2000), 'desktop', view);
    expect(locked.fills.filter(r => r.c === P.gold)).toEqual([]);
    const open = { ...boot, coreSites: 2, slots: [{ kind: 'core', index: 1, locked: false }, { kind: 'scheduler', index: 0, locked: false }] } as ChipSnapshot;
    const rec = recordingContext();
    drawWorld(rec.g, open, frameAt(open, 2000), 'desktop', view);
    const gold = rec.fills.filter(r => r.c === P.gold);
    expect(gold.some(r => r.x === sites[1]!.x - 2)).toBe(true);
    expect(gold.some(r => r.x === sites[0]!.x - 2 && r.y >= sites[0]!.y - 2)).toBe(false);
    expect(gold.some(r => r.y === floorOf('desktop').queue.y - 2)).toBe(true);
  });
  it('draws a locked site as bare die, one dim outline and the lock glyph: no dotted ghost', () => {
    const boot = chipScene('landing'), r = coreSites(floorOf('desktop'), 2)[1]!, rec = recordingContext();
    drawWorld(rec.g, boot, frameAt(boot, 2000), 'desktop');
    const inside = rec.fills.filter(q => q.x > r.x && q.y > r.y && q.x + q.w < r.x + r.w && q.y + q.h < r.y + r.h);
    expect(inside).toEqual([]);
    expect(rec.fills.filter(q => q.x === r.x && q.y === r.y && q.w === r.w && q.h === r.h).map(q => q.c)).toEqual([P.wafer]);
    expect(rec.fills.filter(q => q.c === P.silkLo && q.x === r.x && q.y === r.y)).toHaveLength(2);
  });
});

describe('CPU grid tag speed', () => {
  it('prints one rate when the cores match, else the range', async () => {
    const { rateRange } = await import('./labels');
    expect(rateRange([{ rate: 2000 }, { rate: 2000 }])).toBe('2 kHz');
    expect(rateRange([{ rate: 1000 }, { rate: 2000 }])).toBe('1–2 kHz');
    expect(rateRange([{ rate: 512 }, { rate: 1000 }])).toBe('512 Hz–1 kHz');
  });
});

describe('CPU cache levels', () => {
  it('lists each level after the total when there are several, so the deck rows match a number', () => {
    const mid = chipScene('mid'), lv = (kind: 'l1' | 'l2', bits: number) => ({ kind, bits, generation: 0, level: 1 });
    const chip = { ...mid, cache: { ...mid.cache, capacityBits: 196_608, levels: [lv('l1', 65_536), lv('l2', 131_072)] } };
    expect(labels(chip).cache).toBe('Cache 197 kb · L1 65.5 kb · L2 131 kb');
    expect(labels(mid).cache).toBe('Cache 64 b · 48 b in use');
  });
});

describe('D26 cache spill', () => {
  it('shows bits that overflowed cache as a hatched RAM-coloured block and a warning run', () => {
    const mid = chipScene('mid'), chip = { ...mid, cache: { ...mid.cache, spilledOutBits: 4096 } };
    const fills = draw(chip, 2000);
    expect(fills.some(q => q.c === P.ram)).toBe(true);
    expect(labels(chip).cache).toBe('Cache 64 b · 48 b in use · 4.1 kb spilled');
    expect(draw(mid, 2000).some(q => q.c === P.ram)).toBe(false);
  });
});
