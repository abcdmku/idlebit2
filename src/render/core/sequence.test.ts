// Zoom sequencing: rapid level requests, both directions on every level pair, chained timing,
// framed rests at N, labels only at rest, and a broken level never stopping the loop.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LEVEL_FIXTURES } from '../../game/fixtures';
import type { LevelId, LevelSnapshot, NodeRef } from '../../game';
import { ZoomChain } from './chain';
import { DESKTOP_FRAMING, PHONE_FRAMING, framedRest, camera } from './camera';
import { createFixtureLevels, fixtureSnapshot } from './fixtureLevels';
import { copyRect, rect } from './geom';
import { P } from './palette';
import { R } from './px';
import { ORDER, createLevelRegistry, depth } from './registry';
import { recordingContext } from './testCanvas';
import type { Recording } from './testCanvas';
import { ZoomTransition, zoomSeconds } from './transition';
import { refOf } from './types';
import type { AnyLevelRenderer, CanvasRendererDebug, LevelRegistry, ViewPresentation } from './types';
import { createCanvasRenderer } from './view';

const VP = rect(24, 24, 1392, 648);
let contexts: Recording[] = [];
beforeEach(() => {
  contexts = [];
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => {
    const r = recordingContext(); contexts.push(r); return r.g as unknown as ReturnType<HTMLCanvasElement['getContext']>;
  });
});
afterEach(() => vi.restoreAllMocks());

const snap = (level: LevelId): LevelSnapshot => LEVEL_FIXTURES[level];
/** A box world for rack, room and global whose one child is the next fixture down. */
function boxLevel<L extends 'rack' | 'room' | 'global'>(id: L, w: number, h: number): AnyLevelRenderer {
  const child = ORDER[depth(id) - 1]!;
  return {
    id, name: id,
    size: (_s: unknown, out: ReturnType<typeof rect>) => copyRect(rect(0, 0, w, h), out),
    focus: (_s: unknown, _vp: unknown, out: ReturnType<typeof rect>) => copyRect(rect(0, 0, w, h), out),
    draw: (g: CanvasRenderingContext2D) => R(g, 0, 0, w, h, P.mask),
    drawMini: (g: CanvasRenderingContext2D, _s: unknown, r: ReturnType<typeof rect>) => R(g, r.x, r.y, r.w, r.h, P.steel),
    children(_s: unknown, out: { ref: NodeRef; rect: ReturnType<typeof rect> }[]) {
      out[0].ref = refOf(snap(child)); copyRect(rect(w / 2 - 10, h / 2 - 10, 20, 20), out[0].rect); return 1;
    },
    targets: (_s: unknown, _v: unknown, _o: unknown, from: number) => from,
    icon() {},
  } as unknown as AnyLevelRenderer;
}
function world(): { registry: LevelRegistry; renderer: CanvasRendererDebug } {
  const registry = createLevelRegistry();
  const [board, chip] = createFixtureLevels(registry);
  registry.register(chip); registry.register(board);
  registry.register(boxLevel('rack', 120, 240)); registry.register(boxLevel('room', 320, 200)); registry.register(boxLevel('global', 400, 220));
  const renderer = createCanvasRenderer(document.createElement('canvas'), registry);
  renderer.resize(1440, 900, 1, VP, DESKTOP_FRAMING);
  return { registry, renderer };
}

/** The UI view store's protocol (src/ui/viewState.ts): one level per step, the last request wins. */
function driver(renderer: CanvasRendererDebug, start: LevelId) {
  let focus = start, partner: LevelId | null = null, goal: LevelId | null = null, now = 0;
  const log: { from: LevelId; to: LevelId; at: number }[] = [];
  const view = (): ViewPresentation => ({ selectedId: null, picked: null, quotes: null, reducedMotion: false, zoomGoal: goal });
  const step = (to: LevelId) => {
    const next = ORDER[depth(focus) + Math.sign(depth(to) - depth(focus))]!;
    log.push({ from: focus, to: next, at: now }); partner = focus; focus = next; goal = next === to ? null : to;
  };
  renderer.draw(fixtureSnapshot(snap(focus)), view(), { nowS: 0, sincePublishMs: 0 });
  return {
    log,
    get focus() { return focus; },
    get settled() { return partner === null && goal === null && !renderer.transition; },
    request(to: LevelId) { if (partner) goal = to; else if (to !== focus) step(to); },
    frame(dt = 1 / 60) {
      now += dt;
      renderer.draw(fixtureSnapshot(snap(focus), partner ? snap(partner) : null), view(), { nowS: now, sincePublishMs: 0 });
      if (renderer.transition || !partner) return;
      partner = null;
      if (goal && goal !== focus) step(goal); else goal = null;
    },
    run(seconds: number) { for (let t = 0; t < seconds; t += 1 / 60) this.frame(); },
    get now() { return now; },
  };
}

describe('zoom chain', () => {
  it('plays a four-level jump as four slices of one 2.6 s curve', () => {
    const chain = new ZoomChain(), segs = [];
    for (let k = 0; k < 4; k++) { segs.push(chain.step(k, k + 1, 4, k * 0.65)); chain.end(k * 0.65 + 0.65); }
    expect(segs.map(s => [s.a, s.b, s.total])).toEqual([[0, 0.25, 2.6], [0.25, 0.5, 2.6], [0.5, 0.75, 2.6], [0.75, 1, 2.6]]);
  });
  it('restarts on a reversal, a late step or a single hop', () => {
    const chain = new ZoomChain();
    chain.step(0, 1, 3, 0); chain.end(1);
    expect(chain.step(1, 0, 0, 1)).toMatchObject({ a: 0, b: 1, total: zoomSeconds(1) });
    chain.end(2);
    chain.step(0, 1, 2, 2); chain.end(3);
    expect(chain.step(1, 2, 2, 3.6)).toMatchObject({ a: 0, b: 1 });
  });
  it('keeps the camera continuous across chained steps: each boundary is a level at rest', () => {
    const vp = rect(0, 0, 1392, 648), r = { x: 1, y: 1 };
    const zoom = new ZoomTransition(), rest = camera();
    const path = [
      { key: 'system:0', size: rect(0, 0, 168, 236), rect: rect(), focus: rect(6, 24, 156, 196) },
      { key: 'chip:0', size: rect(0, 0, 480, 400), rect: rect(17, 63, 36, 36), focus: rect(140, 100, 200, 180), mini: rect(144, 104, 192, 152) },
    ];
    zoom.begin(path, 'system:0', 'chip:0', vp, r, 0, false, { framing: DESKTOP_FRAMING, segment: { a: 0.5, b: 0.75, total: 2.6 } });
    expect(zoom.seconds).toBeCloseTo(0.65);
    zoom.sampleProgress(0, false);
    expect(zoom.camera.s).toBeCloseTo(framedRest(path[0].focus, vp, r, DESKTOP_FRAMING, rest).s);
    zoom.sampleProgress(1, false);
    expect(zoom.camera.s * zoom.maps[1].k).toBeCloseTo(3);
  });
});

describe('framed rest', () => {
  it('draws 1:1 at N and puts the world origin on the lattice', () => {
    const out = camera(), vp = rect(24, 24, 1392, 648);
    framedRest(rect(6, 24, 156, 196), vp, { x: 2, y: 2 }, DESKTOP_FRAMING, out);
    expect(out.s).toBe(6);
    const originX = ((vp.x + vp.w / 2) * 2 - out.cx * out.s) / 2, originY = ((vp.y + vp.h / 2) * 2 - out.cy * out.s) / 2;
    expect(Math.abs((originX - vp.x) % 24)).toBe(0); expect(Math.abs((originY - vp.y) % 24)).toBe(0);
    framedRest(rect(0, 0, 160, 120), rect(8, 8, 368, 504), { x: 1, y: 1 }, PHONE_FRAMING, out);
    expect(out.s).toBe(2);
  });
});

describe('renderer zoom sequencing', () => {
  it('plays every level pair in both directions and settles at the far end', () => {
    const { renderer } = world(), ui = driver(renderer, 'chip');
    for (const to of ['system', 'rack', 'room', 'global', 'room', 'rack', 'system', 'chip'] as LevelId[]) {
      ui.request(to); ui.frame();
      expect(renderer.transition?.direction).toBe(depth(to) > depth(ui.log.at(-1)!.from) ? 'out' : 'in');
      ui.run(1.3);
      expect(renderer.transition).toBeNull(); expect(ui.focus).toBe(to);
    }
    expect(ui.log.map(s => `${s.from}>${s.to}`)).toEqual([
      'chip>system', 'system>rack', 'rack>room', 'room>global', 'global>room', 'room>rack', 'rack>system', 'system>chip']);
  });
  it('chains a CPU to World jump in about 2.6 s, one step per level', () => {
    const { renderer } = world(), ui = driver(renderer, 'chip');
    ui.request('global'); ui.frame();
    let t = 0;
    while (!ui.settled) { ui.frame(); t += 1 / 60; if (t > 5) break; }
    expect(ui.log.map(s => s.to)).toEqual(['system', 'rack', 'room', 'global']);
    expect(t).toBeGreaterThan(2.5); expect(t).toBeLessThan(2.8);
  });
  it('queues rapid requests: the last one wins and no step is cut', () => {
    const { renderer } = world(), ui = driver(renderer, 'chip');
    ui.request('global'); ui.frame(); ui.run(0.2);
    ui.request('room'); ui.request('chip'); ui.run(0.1);
    expect(renderer.transition).toMatchObject({ from: { level: 'chip' }, to: { level: 'system' } });
    let progress = renderer.transition!.progress;
    for (let i = 0; i < 400 && !ui.settled; i++) {
      ui.frame();
      const p = renderer.transition?.progress ?? 1;
      if (renderer.transition && p < progress) expect(ui.log.length).toBeGreaterThan(1);
      progress = p;
    }
    expect(ui.log.map(s => `${s.from}>${s.to}`)).toEqual(['chip>system', 'system>chip']);
    expect(ui.focus).toBe('chip');
  });
  it('survives a level that throws: the frame is reported once and the loop goes on', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { registry, renderer } = world(), ui = driver(renderer, 'system');
    const rack = registry.level('rack');
    rack.draw = () => { throw new Error('bad rack frame'); };
    ui.request('rack');
    expect(() => ui.run(1.4)).not.toThrow();
    expect(ui.focus).toBe('rack'); expect(renderer.transition).toBeNull();
    expect(errors.mock.calls.filter(c => String(c[0]).includes('rack draw'))).toHaveLength(1);
    ui.request('system'); ui.run(1.4); expect(ui.focus).toBe('system');
  });
});

describe('labels', () => {
  it('draws level labels at the body size at rest and never during a zoom', () => {
    const { registry, renderer } = world(), ui = driver(renderer, 'system');
    const board = registry.level('system');
    board.labels = (_s, _v, _f, out) => { out.label('psu', 120, 40, 'left').text('PSU', 'silk', true).br().text('64 W', 'value'); };
    ui.frame();
    const texts = () => contexts[0].texts.map(t => `${t.text}|${t.font}`);
    expect(texts()).toEqual(['PSU|700 16px "Chakra Petch"', '64 W|500 16px "Chakra Petch"']);
    contexts[0].texts.length = 0;
    ui.request('chip'); ui.frame(); ui.frame();
    expect(renderer.transition).not.toBeNull(); expect(contexts[0].texts).toHaveLength(0);
  });
});

describe('R38 core hooks', () => {
  it('maps the child world onto `world` when a parent gives one, and keeps `rect` for taps', async () => {
    const { zoomPath } = await import('./paths');
    const { registry } = world(), rack = registry.level('rack');
    rack.children = (_s, out) => { out[0].ref = refOf(snap('system')); copyRect(rect(50, 110, 20, 20), out[0].rect); out[0].world = rect(10, 100, 100, 40); return 1; };
    const scratch = Array.from({ length: 4 }, () => ({ ref: refOf(snap('chip')), rect: rect() }));
    const path = zoomPath(registry, snap('rack'), snap('system'), VP, scratch)!;
    expect(path[1].rect).toEqual(rect(10, 100, 100, 40));
    rack.children = (_s, out) => { out[0].ref = refOf(snap('system')); copyRect(rect(50, 110, 20, 20), out[0].rect); return 1; };
    expect(zoomPath(registry, snap('rack'), snap('system'), VP, scratch)![1].rect).toEqual(rect(50, 110, 20, 20));
  });
  it('follows a moving focus with no framing lerp while the level says so', () => {
    const { registry, renderer } = world(), rack = registry.level('rack');
    let x = 0, follow = false;
    rack.focus = (_s, _vp, out) => copyRect(rect(x, 0, 120, 240), out);
    rack.followFocus = () => follow;
    rack.targets = (s, _v, out, from) => { const t = out[from]; t.id = 'probe'; t.kind = 'part'; t.owner = refOf(s); copyRect(rect(0, 0, 8, 8), t.rect); return from + 1; };
    const at = rect(), draw = (now: number) => renderer.draw(fixtureSnapshot(snap('rack')), { selectedId: null, picked: null, quotes: null, reducedMotion: false }, { nowS: now, sincePublishMs: 0 });
    draw(0); renderer.anchor('probe', at); const x0 = at.x;
    x = 40; draw(0.01); renderer.anchor('probe', at); expect(at.x).toBeGreaterThan(x0 - 120);
    expect(at.x).not.toBe(x0 - 120);
    follow = true; x = 80; draw(0.02); renderer.anchor('probe', at);
    expect(at.x).toBe(x0 - 240);
  });
});
