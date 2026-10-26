import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChipSnapshot, GameEvent, PartRef, Quote, QuoteResult, RenderSnapshot, SystemSnapshot } from '../../../game';
import { LabelBuffer, P, bandColor, createHitTarget, createLevelRegistry, rect } from '../../core';
import { familyId, systemId } from '../../../game';
import type { WorldForm, WorldFrame } from '../../core';
import { recordingContext } from '../../core/testCanvas';
import { createChipRenderer } from '.';
import { TILE_H, arrangementOf, coreSites, coreText, floorOf, gridCells, queueWells } from './layout';
import { chipScene } from './scenes';
import { readySpeedText } from './speed';
import { formatHertz } from '../../../game';
import { chipAfford, createChipAfford, drawWorld, siteCount } from './world';

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
  it.each(['desktop', 'phone'] as const)('stacks IN, queue, cache, then cores and clock (beside them, or a row above on phone), top to bottom (%s)', form => {
    const f = floorOf(form), level = createChipRenderer(createLevelRegistry()), chip = chipScene('mid');
    expect(f.inp.y).toBe(f.die.y);
    expect(f.queue.y).toBeLessThan(f.cache.y); expect(f.cache.y).toBeLessThan(f.cores.y);
    if (f.clockAbove) { expect(f.clock.y).toBeLessThan(f.cores.y); expect(f.clock.y).toBeGreaterThan(f.cache.y); expect(f.cores.w).toBe(f.clock.w); }
    else expect(f.clock.y).toBe(f.cores.y);
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
  it('names the add site and what it sells', () => {
    const open = { ...chipScene('landing'), coreSites: 2, slots: [{ kind: 'core', index: 1, locked: false }, { kind: 'scheduler', index: 0, locked: false }] } as ChipSnapshot;
    expect(labels(open)).toMatchObject({ queue: 'Queue none', core1: 'Add Core 2' });
  });
  it('gives every grid core its own speed, 32 included, and draws no busy tag', () => {
    const max = chipScene('max'), full = labels(max);
    expect(full).not.toHaveProperty('cores');
    expect(Object.keys(full).filter(k => /^core[0-9]+$/.test(k))).toHaveLength(32);
    expect(full.core31).toBe('4 GHz');
    // D34: two cores and the add site take the 2 × 2 grid; the tag sits in its free row
    const four = { ...max, coreSites: 32, cores: max.cores.slice(0, 2), slots: [] };
    expect(labelBuffer(four, 'desktop', false, 2).find('cores')).toBeNull();
    expect(labels(four, 'desktop', false, 3).core0).toBe('4 GHz');
  });
  it('shows a sleeping core dimmed with its C-state instead of its speed', () => {
    const mid = chipScene('mid'), asleep = { ...mid, cores: [{ ...mid.cores[0]!, busy: 0, hz: 0, sleep: 'C1' as const }, mid.cores[1]!] };
    expect(labels(asleep).core0).toBe('Core 1 · C1');
    const fills = draw(asleep, 2000);
    expect(fills.some(f => f.c === P.ink && f.a < 1 && f.w > 20)).toBe(true);
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
    // D34: no add site before Multi-core (the next core slot is locked)
    expect(out.slice(0, n).map(t => `${t.kind}:${t.id}`)).toEqual(['part:clock', 'part:cache', 'slot:queue', 'part:cores', 'link:pipe']);
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
    // an installed core's own upgrade quote (lanes, gone in D34) is never a buy on the chip
    expect([b.clock, b.cache, b.queue, b.site]).toEqual([false, true, true, true]);
    const none = chipAfford(result(up({ kind: 'clock', socket: 0 }, false), q({ type: 'upgradePart', part: { unit: { kind: 'system', id: systemId(1) }, slot: { kind: 'l1', socket: 0 } } }),
      q(add('core').action, true, { code: 'research', node: null, text: 'Needs research' })), sys, b);
    expect([none.clock, none.cache, none.queue, none.site]).toEqual([false, false, false, false]);
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
  it('brackets the whole cores block when a core is affordable, never with no add site', () => {
    const boot = chipScene('landing'), sites = coreSites(floorOf('desktop'), 2), view = { ...VIEW, quotes: result(add('core'), add('scheduler')) };
    const locked = recordingContext();
    drawWorld(locked.g, boot, frameAt(boot, 2000), 'desktop', view);
    expect(locked.fills.filter(r => r.c === P.gold)).toEqual([]);
    const open = { ...boot, coreSites: 2, slots: [{ kind: 'core', index: 1, locked: false }, { kind: 'scheduler', index: 0, locked: false }] } as ChipSnapshot;
    const rec = recordingContext();
    drawWorld(rec.g, open, frameAt(open, 2000), 'desktop', view);
    const gold = rec.fills.filter(r => r.c === P.gold);
    // one bracket around the block: its left corners at core 1, its right corners past the add site
    expect(gold.some(r => r.x === sites[0]!.x - 2 && r.y === sites[0]!.y - 2)).toBe(true);
    expect(gold.some(r => r.x + r.w === sites[1]!.x + sites[1]!.w + 2)).toBe(true);
    expect(gold.some(r => r.x === sites[1]!.x - 2 && r.y === sites[1]!.y - 2)).toBe(false);
    expect(gold.some(r => r.y === floorOf('desktop').queue.y - 2)).toBe(true);
  });
  it('draws no site at all where a core cannot be added yet (D34: no locked sites)', () => {
    const boot = chipScene('landing'), r = gridCells(floorOf('desktop'), 2)[1]!, rec = recordingContext();
    expect(siteCount(boot)).toBe(1);
    drawWorld(rec.g, boot, frameAt(boot, 2000), 'desktop');
    expect(rec.fills.filter(q => q.x === r.x && q.y === r.y && q.w === r.w && q.h === r.h)).toEqual([]);
    expect(rec.fills.filter(q => q.c === P.silkLo && q.x === r.x && q.y === r.y)).toHaveLength(0);
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

describe('CPU incoming queue wells', () => {
  it('shows wells reserved for tasks on the pipe: the landing one dimmed with its real progress in its type colour', () => {
    const mid = chipScene('mid'), t = mid.pipe.transfer ?? { taskId: 9, family: familyId(2), systemId: mid.systemId, link: 'pipe' as const, bitsSent: 500, bits: 1000, speed: 1000, shard: 0, shards: 1, units: 1, from: null, to: { level: 'system' as const, id: mid.systemId }, key: 9 * 256 };
    const chip = { ...mid, scheduler: { ...mid.scheduler!, reserved: 1 }, pipe: { ...mid.pipe, transfer: { ...t, bitsSent: t.bits / 2 } } };
    const f = floorOf('desktop'), wells = queueWells(f, chip.scheduler.q, 'desktop'), w = wells[chip.queue.length]!;
    const fills = draw(chip, mid.pipe.transfer ? 2000 : 0);
    const bar = fills.find(q => q.y === w.y + w.h - 2 && q.x === w.x && q.h === 2 && q.c === bandColor(t.family));
    expect(bar).toBeDefined();
    expect(bar!.w).toBeGreaterThan(0); expect(bar!.w).toBeLessThan(w.w);
    const empty = wells[chip.queue.length + 1]!;
    expect(fills.some(q => q.y === empty.y + empty.h - 2 && q.x === empty.x && q.h === 2 && q.c === bandColor(t.family))).toBe(false);
  });
});

describe('CPU core grids (user: always show the clock speed; the die grows)', () => {
  it.each([['desktop', 4], ['phone', 4]] as const)('keeps a fixed column count and adds rows, the cache, queue and clock in place (%s)', (form, cols) => {
    const small = floorOf(form, 3);
    for (const n of [3, 6, 12, 33]) {
      const f = floorOf(form, n), cells = gridCells(f, n), rows = Math.ceil(Math.min(32, n) / cols);
      expect(cells).toHaveLength(rows * cols);
      expect(new Set(cells.map(r => r.x)).size).toBe(cols); expect(new Set(cells.map(r => r.y)).size).toBe(rows);
      for (const r of cells) {
        expect(Number.isInteger(r.x) && Number.isInteger(r.y)).toBe(true); expect(r.h).toBeGreaterThanOrEqual(TILE_H);
        expect(r.x + r.w).toBeLessThanOrEqual(f.cores.x + f.cores.w); expect(r.y + r.h).toBeLessThanOrEqual(f.cores.y + f.cores.h);
      }
      expect([f.queue, f.cache, f.clock]).toEqual([small.queue, small.cache, small.clock]);
      expect(f.focus.y + f.focus.h).toBeLessThanOrEqual(f.world.h);
    }
    expect(floorOf(form, 33).pkg.h).toBeGreaterThan(floorOf(form, 6).pkg.h);
    // the rest frame fits the free width at the form's scale (phone: 352 CSS px at 2×; desktop 3×)
    expect(small.focus.w * (form === 'phone' ? 2 : 3)).toBeLessThanOrEqual(form === 'phone' ? 352 : 864);
  });
});

describe('D34: installed cores plus one add site', () => {
  const at = (n: number): ChipSnapshot => { const max = chipScene('max'); return { ...max, coreSites: 32, cores: max.cores.slice(0, n), slots: [] }; };
  // the CPU rests at the form's own scale always (panAtRestScale): 3× desktop, 2× phone
  it.each([['desktop', 3], ['phone', 2]] as const)('draws n + 1 sites up to 32, never overlapping, each core with its speed (%s at %i)', (form, scale) => {
    for (let n = 1; n <= 32; n++) {
      const chip = at(n), f = floorOf(form, siteCount(chip)), sites = coreSites(f, siteCount(chip));
      expect(sites).toHaveLength(n < 32 ? n + 1 : 32);
      for (let i = 0; i < sites.length; i++) for (let j = i + 1; j < sites.length; j++) {
        const p = sites[i]!, q = sites[j]!;
        expect(p.x < q.x + q.w && q.x < p.x + p.w && p.y < q.y + q.h && q.y < p.y + p.h).toBe(false);
      }
      const text = labels(chip, form, false, scale);
      for (let i = 0; i < n; i++) expect(text[`core${i}`]).toMatch(/Hz/);
      expect(text).not.toHaveProperty('cores');
    }
  });
  it('makes the cores one target over every core and the add site', () => {
    const level = createChipRenderer(createLevelRegistry()), out = Array.from({ length: 64 }, createHitTarget), chip = at(5), f = floorOf('desktop', siteCount(chip));
    const n = level.targets(chip, VIEW, out, 0, 'desktop'), ids = out.slice(0, n).map(t => t.id);
    expect(ids.filter(id => /^(core[0-9]+|site[0-9]+|cores)$/.test(id))).toEqual(['cores']);
    const t = out.slice(0, n).find(h => h.id === 'cores')!, sites = coreSites(f, siteCount(chip));
    expect(t.kind).toBe('part'); expect(t.slot).toBe(5);
    for (const s of sites) { expect(s.x).toBeGreaterThanOrEqual(t.rect.x); expect(s.x + s.w).toBeLessThanOrEqual(t.rect.x + t.rect.w); expect(s.y + s.h).toBeLessThanOrEqual(t.rect.y + t.rect.h); }
    const full = level.targets(at(32), VIEW, out, 0, 'desktop');
    expect(out.slice(0, full).find(h => h.id === 'cores')!.slot).toBeNull();
  });
  it('draws no add site before Multi-core', () => {
    const one = { ...at(1), coreSites: 1 }, locked = { ...at(4), slots: [{ kind: 'core' as const, index: 4, locked: true }] };
    expect(siteCount(one)).toBe(1); expect(siteCount(locked)).toBe(4); expect(siteCount(at(4))).toBe(5);
  });
});

describe('QA-24: a core between rounds', () => {
  it('shows the clock it is ready to run at when it reports 0 Hz, and its own speed while live', () => {
    const chip = chipScene('mid'), c = { ...chip.cores[0]!, hz: 0, sleep: null };
    expect(readySpeedText(c, chip, false)).toBe(formatHertz(chip.clock.hz));
    expect(readySpeedText(c, chip, true)).toBe(formatHertz(0));
    expect(readySpeedText({ ...c, sleep: 'C3' }, chip, false)).toBe('C3');
  });
});

describe('"+" add sites are their own targets (user: tapping + buys it)', () => {
  it('puts an add:core target on the add site, inside the cores block, and a tap there picks it', () => {
    const max = chipScene('max'), chip = { ...max, coreSites: 32, cores: max.cores.slice(0, 5), slots: [] } as ChipSnapshot;
    const level = createChipRenderer(createLevelRegistry()), out = Array.from({ length: 64 }, createHitTarget);
    const n = level.targets(chip, VIEW, out, 0, 'desktop'), list = out.slice(0, n);
    const add = list.find(t => t.id === 'add:core')!, block = list.find(t => t.id === 'cores')!;
    expect(add).toMatchObject({ kind: 'add', slot: 5, unit: { kind: 'system', id: chip.systemId } });
    const site = coreSites(floorOf('desktop', siteCount(chip)), siteCount(chip))[5]!;
    expect(add.rect).toEqual(site);
    expect(add.rect.x).toBeGreaterThanOrEqual(block.rect.x); expect(add.rect.y + add.rect.h).toBeLessThanOrEqual(block.rect.y + block.rect.h);
    // no add site at 32: no add target
    const full = level.targets(max, VIEW, out, 0, 'desktop');
    expect(out.slice(0, full).some(t => t.kind === 'add')).toBe(false);
  });
});
