import { formatHertz, formatSize } from '../../../game';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { familyId } from '../../../game';
import type { RenderSnapshot, SystemSnapshot, TransferView } from '../../../game';
import { LabelBuffer, P, createHitTarget, createLevelRegistry, flowColor, rect, wattsText, whole } from '../../core';
import type { Completion } from '../../core/pops';
import type { ChildView, ViewPresentation, WorldForm, WorldFrame, ZoomState } from '../../core';
import { createFixtureLevels } from '../../core/fixtureLevels';
import type { Fill } from '../../core/testCanvas';
import { recordingContext } from '../../core/testCanvas';
import { createSystemRenderer } from '.';
import { BOARD, BOARDS, CABLE_X, CONNECTOR, FOCUS, PSU, WORLD, packageRect, siteRect } from './layout';
import { boardModel } from './model';
import { sizes } from './labels';
import { chipScene, sceneInbound, systemScene } from './scenes';

const VIEW: ViewPresentation = { selectedId: null, picked: null, quotes: null, reducedMotion: false };
beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => recordingContext().g as unknown as ReturnType<HTMLCanvasElement['getContext']>);
});
afterEach(() => vi.restoreAllMocks());

function setup() {
  const registry = createLevelRegistry();
  // The chip's own mini is the chip level's concern; a fixture stands in so this suite tests the board.
  registry.register(createFixtureLevels(registry)[1]); registry.register(createSystemRenderer(registry));
  return registry.level('system');
}
function frameFor(s: SystemSnapshot, timeMs: number, o: { paused?: boolean; idleChip?: boolean; form?: WorldForm; zoom?: ZoomState | null; simTimeMs?: number } = {}): WorldFrame {
  const busy = chipScene('system');
  const chip = o.idleChip ? { ...busy, cores: busy.cores.map(c => ({ ...c, busy: 0, research: 0 })) } : busy;
  const snapshot = { epoch: 1, tick: Math.floor(timeMs / 100), simTimeMs: o.simTimeMs ?? timeMs, focus: s, partner: chip, events: [], research: { progress: 0 } } as unknown as RenderSnapshot;
  return { snapshot, timeMs, paused: o.paused ?? false, reducedMotion: false, zoom: o.zoom ?? null, form: o.form ?? 'desktop', visible: null };
}
function draw(s: SystemSnapshot, timeMs: number, o: Parameters<typeof frameFor>[2] = {}): Fill[] {
  const rec = recordingContext();
  setup().draw(rec.g, s, VIEW, frameFor(s, timeMs, o));
  return rec.fills;
}
const key = (fills: Fill[]) => fills.map(f => `${f.x},${f.y},${f.w},${f.h},${f.c},${f.a}`).join(';');
const inside = (f: Fill, r: { x: number; y: number; w: number; h: number }) => f.x >= r.x - 2 && f.y >= r.y - 6 && f.x < r.x + r.w + 2 && f.y < r.y + r.h + 2;
function labels(s: SystemSnapshot, form: WorldForm) {
  const out = new LabelBuffer();
  setup().labels!(s, VIEW, frameFor(s, 0, { form }), out);
  return Array.from({ length: out.count }, (_, i) => {
    const l = out.labels[i]!, runs = out.runs.slice(l.first, l.end).map(r => r.text);
    return { id: l.id, text: runs.join('|'), lines: l.lines, tag: l.tag };
  });
}

describe('original system board', () => {
  it('frames the whole board, with leader margins only on desktop', () => {
    const level = setup(), s = systemScene('system'), r = { x: 0, y: 0, w: 0, h: 0 };
    expect(level.size(s, r, 'desktop')).toEqual({ x: -16, y: 0, w: 200, h: 236 });
    expect(level.size(s, r, 'phone')).toEqual({ x: 0, y: 0, w: 168, h: 236 });
    expect(level.miniRect!(s, r)).toEqual(WORLD);
    expect(level.focus(s, r, r)).toEqual(FOCUS);
    expect([FOCUS.y <= BOARD.y - BOARD.z, FOCUS.y + FOCUS.h >= BOARD.y + BOARD.h, FOCUS.x <= BOARD.x, FOCUS.x + FOCUS.w >= BOARD.x + BOARD.w]).toEqual([true, true, true, true]);
    // the pipe ends exactly on the board's gold edge connector (no stem)
    expect(level.entry!(s, { x: 0, y: 0 })).toEqual({ x: CONNECTOR.x + (CONNECTOR.w >> 1), y: CONNECTOR.y - 2 });
  });
  it('puts every part in its own fixed site', () => {
    const m = boardModel(systemScene('system'));
    expect(m.sites.filter(x => x.state === 'part').map(x => `${x.type}${x.index}`).sort()).toEqual(['cpu0', 'drive0', 'gpu0', 'ram0', 'ram1']);
    expect(m.sites.filter(x => x.state === 'open')).toHaveLength(0);
    expect(m.sites).toHaveLength(16);
  });
  it('dives into the CPU through socket 1 package', () => {
    const out: ChildView[] = [{ ref: { level: 'chip', id: 0 } as ChildView['ref'], rect: { x: 0, y: 0, w: 0, h: 0 } }];
    expect(setup().children(systemScene('system'), out)).toBe(1);
    expect(out[0]!.rect).toEqual(packageRect(BOARDS.general, 0));
    expect(out[0]!.rect).toEqual({ x: 17, y: 63, w: 36, h: 36 });
  });
  it('lists the board, slots, every part, the PSU and save as targets; no port (D35)', () => {
    const out = Array.from({ length: 32 }, createHitTarget), n = setup().targets(systemScene('system'), VIEW, out, 0);
    const list = out.slice(0, n);
    expect(list.map(t => t.id).sort()).toEqual(['cpu0', 'drive0', 'gpu0', 'psu', 'ram0', 'ram1', 'save', 'slot-drive1', 'slot-gpu1', 'slot-ram2', 'unit'].sort());
    const cpu = list.find(t => t.id === 'cpu0')!;
    expect(cpu).toMatchObject({ kind: 'part', drill: { level: 'chip', id: 0 }, part: { slot: { kind: 'cpu', socket: 0 } } });
    expect(cpu.rect).toEqual(packageRect(BOARDS.general, 0));
    expect(list.find(t => t.id === 'pipe')).toBeUndefined();
    expect(list.find(t => t.id === 'psu')!.part?.slot).toEqual({ kind: 'psu' });
  });
});

describe('system value labels', () => {
  it('joins stick sizes the way L2 prints them', () => {
    expect(sizes([16384, 8192])).toBe('16.4 + 8.19 kb'); expect(sizes([512, 8192])).toBe('512 b + 8.19 kb');
  });
  const s = systemScene('system'), gpu = s.gpu[0]!.gpu!;
  const expected = {
    cpu: `CPU|${formatHertz(s.chip.clock.hz)} · ${whole(s.chip.cores.length)} cores`,
    psu: `Power supply|${wattsText(s.psu.capacityW)}`,
    ram: `RAM|${sizes(s.ram.map(p => p.capacityBits!))} · ${formatHertz(Math.min(...s.ram.map(p => p.rateBits!)))}`,
    drive: `Drive|${formatSize(s.storage[0]!.capacityBits!)} · ${formatHertz(s.storage[0]!.rateBits!)}`,
    gpu: `GPU|G${gpu.model} · ${whole(gpu.cores)} cores · ${formatSize(gpu.vramBits)}`,
  };
  it.each(['desktop', 'phone'] as const)('labels every installed part with its snapshot values on %s', form => {
    const list = labels(s, form);
    expect(Object.fromEntries(list.map(l => [l.id, l.text]))).toEqual(expected);
    expect(list.every(l => l.lines === (form === 'phone' ? 1 : 2) && l.tag === (form === 'phone'))).toBe(true);
  });
  it('skips empty part types', () => {
    expect(labels(systemScene('boot'), 'desktop').map(l => l.id)).toEqual(['cpu', 'psu']);
  });
  it('draws leaders on desktop at rest only, never during a zoom or on phone', () => {
    const silk = (f: Fill[]) => f.filter(x => x.c === P.silk).length;
    const rest = silk(draw(s, 0)), zoom = { path: [], alphas: new Float32Array(2) } as unknown as ZoomState;
    expect(rest - silk(draw(s, 0, { zoom }))).toBe(10);
    expect(silk(draw(s, 0, { form: 'phone' }))).toBe(silk(draw(s, 0, { zoom })));
  });
});

describe('system motion audit (v2 program §7)', () => {
  const quiet = () => ({ ...systemScene('system'), running: [], ram: systemScene('system').ram.map(p => ({ ...p, active: false })) });
  it('draws nothing animated while idle', () => {
    expect(new Set([0, 400, 1000, 2700].map(t => key(draw(quiet(), t, { idleChip: true })))).size).toBe(1);
  });
  it('lights a RAM module only while it serves a stage', () => {
    expect(draw(systemScene('system'), 0).filter(f => f.c === P.ram).length).toBeGreaterThan(0);
    expect(draw(quiet(), 0).filter(f => f.c === P.ram).length).toBe(0);
  });
  it('draws only steady power LEDs while paused', () => {
    const full = systemScene('full'), keys = [0, 500, 1300].map(t => key(draw(full, t, { paused: true })));
    expect(new Set(keys).size).toBe(1);
    const fills = draw(full, 0, { paused: true });
    expect(fills.some(f => f.c === P.ram || f.c === P.gpu || f.c === P.stor || f.c === P.op || f.c === P.cacheOn)).toBe(false);
    expect(fills.filter(f => f.c === P.led).every(f => inside(f, PSU))).toBe(true);
  });
  it('rides a shard down the cable at its real progress in its type colour; a sub-0.25 s one is a landing flash', () => {
    const transfer = (bits: number, bitsSent: number): TransferView => sceneInbound({ link: 'pipe', family: familyId(0), bits, bitsSent, speed: 1000 });
    const withT = (t: TransferView) => ({ ...quiet(), chip: { ...quiet().chip, pipe: { speed: 1000, transfer: t, waiting: true } } });
    const colour = flowColor(transfer(1, 0)), bit = (fills: Fill[]) => fills.filter(f => f.c === colour).map(f => f.y);
    const early = bit(draw(withT(transfer(2000, 200)), 0, { idleChip: true })), later = bit(draw(withT(transfer(2000, 200)), 500, { idleChip: true, simTimeMs: 0 }));
    expect(early.length).toBeGreaterThan(0);
    expect(Math.min(...later)).toBeGreaterThan(Math.min(...early));
    const flash = draw(withT(transfer(100, 0)), 0, { idleChip: true });
    expect(bit(flash)).toHaveLength(0);
    const end = BOARDS.general.sites.cpu[0]!.y + 4;
    expect(flash.filter(f => f.w === 4 && f.h === 4 && f.x === CABLE_X - 2 && f.y === end - 2)).toHaveLength(1);
  });
  it('draws the port shard from SystemSnapshot.inbound (D25) before the pipe transfer', () => {
    const s = { ...quiet(), inbound: sceneInbound(), chip: { ...quiet().chip, pipe: { speed: 1000, transfer: sceneInbound({ family: familyId(0) }), waiting: true } } };
    const fills = draw(s, 0, { idleChip: true });
    expect(fills.some(f => f.c === flowColor(sceneInbound()))).toBe(true);
    expect(fills.some(f => f.c === flowColor({ family: familyId(0) }))).toBe(false);
  });
});

describe('system payout anchors (D25: only a task\'s last shard pops)', () => {
  const at = (s: SystemSnapshot, c: Partial<Completion>) => {
    const out = rect(), key = setup().payoutAnchor!(s, { system: 0, cpu: 0, core: 0, gpu: null, ...c } as Completion, out, 'desktop');
    return { key, out };
  };
  it('lands a GPU completion on the card in that slot, and a CPU completion on its package', () => {
    const full = systemScene('full');
    expect(at(full, { cpu: null, core: null, gpu: 6 })).toEqual({ key: 14, out: siteRect(BOARDS.accelerator, 'gpu', 6, rect()) });
    expect(at(full, { cpu: 0, core: 2 })).toEqual({ key: 0, out: packageRect(BOARDS.accelerator, 0) });
    expect(at(full, { system: 3 }).key).toBe(-1);
  });
});

describe('D26 memory tiers', () => {
  it('fills RAM and the drive, hatches spilled bits, lights the tier being read, and labels the spill', async () => {
    const { drawTiers, drawReadLights, tierOf } = await import('./memory');
    const { boardModel } = await import('./model');
    const s = systemScene('spill'), m = boardModel(s), rec = recordingContext();
    drawTiers(rec.g, s, m, true);
    expect(rec.fills.some(f => f.c === P.ram)).toBe(true); expect(rec.fills.some(f => f.c === P.stor)).toBe(true);
    expect(rec.fills.filter(f => f.c === P.ink && f.w === 1 && f.h === 1).length).toBeGreaterThan(10);
    const lights = recordingContext();
    drawReadLights(lights.g, s, m, 1100, true);
    expect(lights.fills.some(f => f.c === P.amber)).toBe(true);
    expect(tierOf(s, 'disk')!.spilledBits).toBeGreaterThan(0);
    const level = createSystemRenderer(createLevelRegistry()), out = new LabelBuffer();
    level.labels!(s, VIEW, { snapshot: { focus: s } as never, timeMs: 1000, paused: false, reducedMotion: false, zoom: null, form: 'desktop', visible: null }, out);
    const texts: string[] = [];
    for (let i = 0; i < out.count; i++) { const l = out.labels[i]!; for (let k = l.first; k < l.end; k++) texts.push(out.runs[k]!.text); }
    expect(texts.some(t => t.endsWith('spilled'))).toBe(true);
  });
});

describe('system parts as tiles (user: where to click)', () => {
  it('outlines every tappable part on exactly its hit rect, and marks open slots with a "+"', () => {
    const s = systemScene('system'), fills = draw(s, 0), out = Array.from({ length: 32 }, createHitTarget);
    const n = setup().targets(s, VIEW, out, 0);
    const parts = out.slice(0, n).filter(t => t.kind === 'part' || t.kind === 'slot');
    expect(parts.length).toBeGreaterThan(4);
    for (const t of parts) {
      const r = t.rect;
      expect(fills.some(f => f.x === r.x && f.y === r.y && f.w === r.w && f.h === 1)).toBe(true);
      expect(fills.some(f => f.x === r.x && f.y === r.y + r.h - 1 && f.w === r.w && f.h === 1)).toBe(true);
    }
    const open = new Set(boardModel(s).sites.filter(x => x.state === 'open').map(x => `slot-${x.type}${x.index}`));
    for (const t of parts.filter(p => p.kind === 'slot' && open.has(p.id))) {
      const cx = t.rect.x + (t.rect.w >> 1), cy = t.rect.y + (t.rect.h >> 1);
      expect(fills.some(f => f.x === cx - 2 && f.y === cy && f.w === 5 && f.h === 1)).toBe(true);
    }
  });
});
