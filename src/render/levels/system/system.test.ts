import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RenderSnapshot, SystemSnapshot, TransferView } from '../../../game';
import { LabelBuffer, P, bitRate, bitsText, createHitTarget, createLevelRegistry, hertz, wattsText, whole } from '../../core';
import type { ChildView, ViewPresentation, WorldForm, WorldFrame, ZoomState } from '../../core';
import { createFixtureLevels } from '../../core/fixtureLevels';
import type { Fill } from '../../core/testCanvas';
import { recordingContext } from '../../core/testCanvas';
import { createSystemRenderer } from '.';
import { BOARD, BOARDS, FOCUS, PSU, WORLD, packageRect } from './layout';
import { boardModel } from './model';
import { sizes } from './labels';
import { chipScene, systemScene } from './scenes';

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
    expect(level.entry!(s, { x: 0, y: 0 })).toEqual({ x: 33, y: 0 });
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
  it('lists the board, pipe, slots, every part, the PSU and save as targets', () => {
    const out = Array.from({ length: 32 }, createHitTarget), n = setup().targets(systemScene('system'), VIEW, out, 0);
    const list = out.slice(0, n);
    expect(list.map(t => t.id).sort()).toEqual(['cpu0', 'drive0', 'gpu0', 'pipe', 'psu', 'ram0', 'ram1', 'save', 'slot-drive1', 'slot-gpu1', 'slot-ram2', 'unit'].sort());
    const cpu = list.find(t => t.id === 'cpu0')!;
    expect(cpu).toMatchObject({ kind: 'part', drill: { level: 'chip', id: 0 }, part: { slot: { kind: 'cpu', socket: 0 } } });
    expect(cpu.rect).toEqual(packageRect(BOARDS.general, 0));
    expect(list.find(t => t.id === 'pipe')).toMatchObject({ kind: 'link', unit: { kind: 'system', id: 0 } });
    expect(list.find(t => t.id === 'psu')!.part?.slot).toEqual({ kind: 'psu' });
  });
});

describe('system value labels', () => {
  it('joins stick sizes the way L2 prints them', () => {
    expect(sizes([16384, 8192])).toBe('2 + 1 KiB'); expect(sizes([512, 8192])).toBe('512 bits + 1 KiB');
  });
  const s = systemScene('system'), gpu = s.gpu[0]!.gpu!;
  const expected = {
    port: `Port|${hertz(s.chip.pipe.speed)}`,
    cpu: `CPU|${hertz(s.chip.clock.hz)} · ${whole(s.chip.cores.length)} cores`,
    psu: `PSU|${wattsText(s.psu.capacityW)}`,
    ram: `RAM|${sizes(s.ram.map(p => p.capacityBits!))} · ${hertz(Math.min(...s.ram.map(p => p.rateBits!)))}`,
    drive: `Drive|${bitsText(s.storage[0]!.capacityBits!)} · ${bitRate(s.storage[0]!.rateBits!)}`,
    gpu: `GPU|G${gpu.model} · ${whole(gpu.cores)} cores · ${bitsText(gpu.vramBits)}`,
  };
  it.each(['desktop', 'phone'] as const)('labels every installed part with its snapshot values on %s', form => {
    const list = labels(s, form);
    expect(Object.fromEntries(list.map(l => [l.id, l.text]))).toEqual(expected);
    expect(list.every(l => l.lines === (form === 'phone' ? 1 : 2) && l.tag === (form === 'phone'))).toBe(true);
  });
  it('skips empty part types', () => {
    expect(labels(systemScene('boot'), 'desktop').map(l => l.id)).toEqual(['port', 'cpu', 'psu']);
  });
  it('draws leaders on desktop at rest only, never during a zoom or on phone', () => {
    const silk = (f: Fill[]) => f.filter(x => x.c === P.silk).length;
    const rest = silk(draw(s, 0)), zoom = { path: [], alphas: new Float32Array(2) } as unknown as ZoomState;
    expect(rest - silk(draw(s, 0, { zoom }))).toBe(12);
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
  it('rides a transfer down the cable at its real progress, and hides sub-0.25 s transfers', () => {
    const transfer = (bits: number, bitsSent: number): TransferView => ({ taskId: 1, family: 0 as TransferView['family'], systemId: 0 as TransferView['systemId'], link: 'pipe', bits, bitsSent, speed: 1000 });
    const withT = (t: TransferView) => ({ ...quiet(), chip: { ...quiet().chip, pipe: { speed: 1000, transfer: t, waiting: true } } });
    const bit = (fills: Fill[]) => fills.filter(f => f.c === P.bit).map(f => f.y);
    const early = bit(draw(withT(transfer(2000, 200), ), 0, { idleChip: true })), later = bit(draw(withT(transfer(2000, 200)), 500, { idleChip: true, simTimeMs: 0 }));
    expect(early.length).toBeGreaterThan(0);
    expect(Math.min(...later)).toBeGreaterThan(Math.min(...early));
    expect(bit(draw(withT(transfer(100, 0)), 0, { idleChip: true }))).toHaveLength(0);
  });
});
