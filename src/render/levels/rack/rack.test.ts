import { describe, expect, it } from 'vitest';
import { P, TASK_TYPES, TYPE, createHitTarget, createLevelRegistry, mix, rect, typeOf } from '../../core';
import type { ChildView, HitTarget, NodeRef, ViewPresentation, WorldFrame, ZoomState } from '../../core';
import { RACK, RACK_RECTS } from '../room/layout';
import { createRackRenderer } from '.';
import { OFF, typeText } from './art';
import { LCD_IDLE, drawServer, serverLook } from './sprites';
import { CASES, rackCase } from './fixtures';
import { CAB_RECT, FOCUS, ROW_PITCH, ROW_W, SWITCH_RECT, UPLINK_JACK, WORLD, colX, portX } from './layout';
import { NEIGHBOUR_ALPHA } from './neighbour';
import { clampScroll, createRowScroll, rackRowScroll } from './row';
import { drillOf } from './world';

// jsdom has no Canvas2D: static layers and the neighbour buffer fall back to direct drawing.
HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext'];
const registry = createLevelRegistry(), rack = createRackRenderer(registry);
registry.register(rack);
const view: ViewPresentation = { selectedId: null, picked: null, quotes: null, reducedMotion: false };
const frame = (timeMs = 5000, paused = false, zoom: ZoomState | null = null): WorldFrame =>
  ({ snapshot: {} as WorldFrame['snapshot'], timeMs, paused, reducedMotion: false, zoom });

interface Fill { x: number; y: number; w: number; h: number; c: string; a: number }
/** A recording context that honours translate, save and restore (the row draws each rack in its column). */
function recorder() {
  const fills: Fill[] = [], texts: { t: string; c: string }[] = [], stack: { x: number; y: number; a: number }[] = [];
  let ox = 0, oy = 0, fillStyle = '', globalAlpha = 1;
  const g = {
    get fillStyle() { return fillStyle; }, set fillStyle(v: string) { fillStyle = v; },
    get globalAlpha() { return globalAlpha; }, set globalAlpha(v: number) { globalAlpha = v; },
    imageSmoothingEnabled: false, font: '', textAlign: 'left', textBaseline: 'alphabetic',
    fillRect(x: number, y: number, w: number, h: number) { fills.push({ x: x + ox, y: y + oy, w, h, c: fillStyle, a: globalAlpha }); },
    fillText(t: string) { texts.push({ t, c: fillStyle }); }, clearRect() {}, setTransform() {}, scale() {}, drawImage() {}, beginPath() {}, rect() {}, clip() {},
    translate(x: number, y: number) { ox += x; oy += y; },
    save() { stack.push({ x: ox, y: oy, a: globalAlpha }); },
    restore() { const s = stack.pop(); if (s) { ox = s.x; oy = s.y; globalAlpha = s.a; } },
  } as unknown as CanvasRenderingContext2D;
  return { g, fills, texts };
}
function draw(s = CASES.overview(5000), f = frame()): Fill[] {
  const { g, fills } = recorder(); rack.draw(g, s, view, f); return fills;
}
const at = (fills: Fill[], x: number, y: number): Fill | null => {
  for (let i = fills.length - 1; i >= 0; i--) { const f = fills[i]; if (x >= f.x && y >= f.y && x < f.x + f.w && y < f.y + f.h) return f; }
  return null;
};

describe('rack row positions', () => {
  it('stands each rack at the room row position scaled to rack art px (15 room px → 120)', () => {
    expect([RACK.w * 8, RACK.h * 8]).toEqual([WORLD.w, WORLD.h]);
    for (let c = 0; c < 8; c++) expect((RACK_RECTS[c].x - RACK_RECTS[0].x) * 8).toBe(colX(c));
    expect(ROW_PITCH).toBe(120);
    expect(rack.size(CASES.overview(0), rect())).toEqual(rect(0, 0, ROW_W, 240));
  });
  it('frames the active rack in its own column and puts its parts and servers there', () => {
    rackRowScroll.reset();
    const s = CASES.overview(0);
    expect(rack.focus(s, rect(), rect()).x).toBe(colX(2) + FOCUS.x);
    const kids: ChildView[] = Array.from({ length: 32 }, () => ({ ref: { level: 'chip', id: 0 } as NodeRef, rect: rect() }));
    expect(rack.children(s, kids)).toBe(9);
    expect(kids[0].rect.x).toBe(colX(2) + 13);
    const out: HitTarget[] = Array.from({ length: 128 }, createHitTarget), n = rack.targets(s, view, out, 0), byId = new Map(out.slice(0, n).map(t => [t.id, t]));
    expect(byId.get('switch')?.rect.x).toBe(colX(2) + SWITCH_RECT.x);
    expect(byId.get('entry')?.rect.x).toBe(colX(2) + 119);
    expect(byId.get('port3')?.port).toBe(3);
    expect(byId.get('uplink')?.port).toBe(-1);
  });
  it('makes every built neighbour a target that activates it, at its true column', () => {
    const s = CASES.overview(0), out: HitTarget[] = Array.from({ length: 128 }, createHitTarget), n = rack.targets(s, view, out, 0);
    const nb = out.slice(0, n).filter(t => t.id.startsWith('rack'));
    expect(nb.map(t => t.id)).toEqual(['rack0', 'rack1', 'rack3', 'rack4', 'rack6']);
    for (const t of nb) {
      const c = Number(t.id.slice(4));
      expect(t.rect.x).toBe(colX(c) + CAB_RECT.x);
      expect(t.drill).toEqual({ level: 'rack', id: s.row[c].rackId });
      expect(t.kind).toBe('unit');
    }
  });
});

describe('rack row scroll', () => {
  it('clamps from the first built rack to the last one centred, in whole steps', () => {
    const s = CASES.overview(0);   // active at column 2, racks in 0, 1, 2, 3, 4, 6
    expect(clampScroll(s, 1e6, 8)).toBe(4 * 120);
    expect(clampScroll(s, -1e6, 8)).toBe(-2 * 120);
    expect(clampScroll(s, 13, 8)).toBe(16);
    expect(clampScroll(s, 13, 4)).toBe(12);
    expect(clampScroll(CASES.alone(0), 200, 8)).toBe(0);
    expect(clampScroll(s, Number.NaN, 8)).toBe(0);
  });
  it('moves the rest focus with the offset and resets on a new rack', () => {
    const scroll = createRowScroll(), a = CASES.overview(0);
    scroll.apply(a);
    expect(scroll.scrollBy(100)).toBe(104);
    expect(scroll.scrollBy(1e4)).toBe(480);
    expect(scroll.apply(a)).toBe(480);
    expect(scroll.apply(rackCase({ id: 5, slot: 4 }, 0))).toBe(0);
  });
  it('a tapped neighbour becomes active where it stands: the camera does not move', () => {
    const scroll = createRowScroll(), a = rackCase({ id: 0, slot: 2 }, 0), b = rackCase({ id: 7, slot: 4 }, 0);
    scroll.apply(a); scroll.scrollTo(48);
    const before = colX(2) + 48;
    scroll.holdView();
    expect(colX(4) + scroll.apply(b)).toBe(before);
    // Room → Rack (no hold) lands centred.
    scroll.apply(a);
    expect(scroll.offset).toBe(0);
  });
});

describe('rack rendering', () => {
  it('draws the active rack at full alpha and its neighbours at 30%', () => {
    const fills = draw();
    const sw = at(fills, colX(2) + SWITCH_RECT.x + 30, SWITCH_RECT.y + 6);
    expect(sw?.a).toBe(1);
    for (const c of [0, 1, 3, 4, 6]) {
      const f = fills.filter(q => q.x >= colX(c) + CAB_RECT.x && q.x < colX(c) + CAB_RECT.x + CAB_RECT.w && q.y > 40 && q.y < 200);
      expect(f.length).toBeGreaterThan(50);
      expect(f.every(q => q.a <= NEIGHBOUR_ALPHA + 1e-9)).toBe(true);
    }
    // the empty slots (5, 7) stay bare
    expect(fills.some(q => q.x >= colX(7) + 12 && q.y > 40 && q.y < 200)).toBe(false);
    // a rack alone in its row: nothing beside it
    expect(draw(CASES.alone(5000)).some(q => q.x >= WORLD.w + 4)).toBe(false);
  });
  it('lights a switch port only while that port carries a real transfer', () => {
    const ax = colX(2), light = (fills: Fill[], i: number) => at(fills, ax + portX(i) + 1, SWITCH_RECT.y + 2)?.c;
    const live = draw(rackCase({ active: [3], uplink: true }, 5000)), idle = draw(rackCase({ active: [], uplink: false }, 5000));
    expect(light(live, 3)).toBe(P.net);
    expect(light(live, 4)).toBe(OFF);
    expect(light(idle, 3)).toBe(OFF);
    expect(at(live, ax + UPLINK_JACK.x + 1, SWITCH_RECT.y + 1)?.c).toBe(P.net);
    expect(at(idle, ax + UPLINK_JACK.x + 1, SWITCH_RECT.y + 1)?.c).toBe(OFF);
    // a packet is the glow halo (alpha < 1); the LB's routed-slot light is steady
    expect(live.some(f => f.c === P.bit && f.a < 0.5)).toBe(true);
    expect(idle.some(f => f.c === P.bit && f.a < 0.5)).toBe(false);
    const paused = draw(rackCase({ active: [3], uplink: true }, 5000), frame(5000, true));
    expect(light(paused, 3)).toBe(OFF);
    expect(paused.some(f => f.c === P.bit)).toBe(false);
  });
  it('slides the drilled server out on the zoom to System', () => {
    const s = CASES.overview(0), id = s.servers[4].systemId!;
    const zoom = { from: 'rack:0', to: `system:${id}`, direction: 'in', progress: 0.5, eased: 0.5, fromIndex: 0, toIndex: 1,
      path: [{ key: 'rack:0' }, { key: `system:${id}` }], alphas: new Float32Array([1, 0]) } as unknown as ZoomState;
    expect(drillOf(s, frame(0, false, zoom))).toEqual({ slot: 4, out: 1 });
    (zoom as { eased: number }).eased = 0.1;
    const d = drillOf(s, frame(0, false, zoom));
    expect(d.slot).toBe(4); expect(d.out).toBeGreaterThan(0); expect(d.out).toBeLessThan(1);
    expect(drillOf(s, frame()).slot).toBe(-1);
  });
});

describe('rack performance', () => {
  it('draws the full row with a stable cost and no growth per frame', () => {
    let n = 0;
    const g = {
      fillStyle: '', globalAlpha: 1, imageSmoothingEnabled: false, font: '',
      fillRect() { n++; }, fillText() { n++; }, clearRect() {}, setTransform() {}, translate() {}, scale() {}, drawImage() { n++; },
      save() {}, restore() {}, beginPath() {}, rect() {}, clip() {},
    } as unknown as CanvasRenderingContext2D;
    const s = CASES.full(5000), f = frame();
    rack.draw(g, s, view, f);
    const per = n; n = 0;
    let ms = Infinity;
    for (let b = 0; b < 5; b++) {
      const t0 = performance.now();
      for (let i = 0; i < 40; i++) rack.draw(g, s, view, f);
      ms = Math.min(ms, (performance.now() - t0) / 40);
    }
    expect(n).toBe(per * 200);
    expect(ms).toBeLessThan(6);
  });
});

describe('rack core hooks', () => {
  it('enters the pipe at the active rack ceiling uplink and lands System on the pulled-out sled', () => {
    const s = CASES.overview(0);
    expect(rack.entry!(s, { x: 0, y: 0 })).toEqual({ x: colX(2) + 120, y: 0 });
    const kids: ChildView[] = Array.from({ length: 32 }, () => ({ ref: { level: 'chip', id: 0 } as NodeRef, rect: rect(), world: null }));
    rack.children(s, kids);
    // server 0 at row 3 (y 67, under Power control, switch and LB): tap on its row, System on the 75 × 96 board 16 px above it
    expect(kids[0].rect).toEqual(rect(colX(2) + 13, 67, 100, 12));
    expect(kids[0].world).toEqual(rect(colX(2) + 16, 51, 75, 96));
  });
  it('lets the camera follow the row only while the UI reports a drag', () => {
    const s = CASES.overview(0);
    rackRowScroll.setDragging(true); expect(rack.followFocus!(s)).toBe(true);
    rackRowScroll.setDragging(false); expect(rack.followFocus!(s)).toBe(false);
  });
});

describe('rack LCDs (A19, A28)', () => {
  const s = CASES.overview(5000);
  const live = s.servers.filter(v => serverLook(s, v, false) === 'live');
  it('shows a running task as its type mini and type name, never a squeezed task name', () => {
    const v = live.find(q => q.running > 0 && q.family !== null)!, type = typeOf(v.family!), { g, fills, texts } = recorder();
    drawServer(g, 0, 0, 100, 12, v, 'live', 0, false);
    // The 5×5 mini in its type colours, inside the LCD window (rows 3 to 7 of the 12 px face).
    const mini = fills.filter(f => f.y >= 3 && f.y < 8 && f.h === 1 && f.c === TYPE[type].a);
    expect(mini.length).toBeGreaterThan(0);
    expect(texts.some(t => [4, 5, 6, 7].some(m => t.t === typeText(type, m)))).toBe(true);
    for (const t of TASK_TYPES) for (const max of [4, 5, 6, 7]) expect(typeText(t, max).length).toBeLessThanOrEqual(max);
    expect(TASK_TYPES.map(t => typeText(t, 4))).toEqual(['COMP', 'PARL', 'MEM', 'GPU', 'STOR', 'DIST', 'ZONE', 'REGN']);
  });
  it('draws idle text in the lit segment colour at 60%, not dark on dark', () => {
    const v = live[0]!, idle = { ...v, cores: 1, running: 0, busyCores: 0, port: v.port && { ...v.port, active: false } }, { g, texts } = recorder();
    drawServer(g, 0, 0, 100, 12, idle, 'live', 0, false);
    expect(texts).toContainEqual({ t: 'IDLE', c: LCD_IDLE[0] });
    expect(LCD_IDLE[0]).toBe(mix(P.led, mix(P.ledOff, P.ink, 0.4), 0.4));
  });
  it('reads the cooler display as °F over a bare efficiency percent', () => {
    const { g, texts } = recorder();
    rack.draw(g, CASES.overview(5000), view, frame());
    const lines = texts.map(t => t.t);
    expect(lines.some(t => /^\d+°F$/i.test(t))).toBe(true);
    expect(lines.some(t => /^E\d+%$/.test(t))).toBe(false);
  });
});

describe('between rounds: ready vs sitting out', () => {
  it('a paused sled on market looks ready; one whose switch is off sits out', () => {
    const s = CASES.sitout!(0);
    expect(s.servers.map(v => serverLook(s, v, true))).toEqual(['paused', 'paused', 'out', 'paused', 'paused', 'out', 'paused', 'paused', 'paused', 'out', 'paused', 'paused']);
    // during a round the same sleds keep the live looks
    expect(serverLook(s, { ...s.servers[2]!, state: 'onMarket' }, false)).toBe(s.servers[2]!.port ? 'live' : 'noport');
  });
});
