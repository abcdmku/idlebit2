import { describe, expect, it } from 'vitest';
import { P, createHitTarget, createLevelRegistry, mix, rect } from '../../core';
import type { ChildView, HitTarget, NodeRef, ViewPresentation, WorldFrame } from '../../core';
import { colorAt, recordingContext } from '../../core/testCanvas';
import type { Fill } from '../../core/testCanvas';
import type { RoomSnapshot } from '../../../game';
import { createRoomRenderer } from '.';
import { CASES, roomCase } from './fixtures';
import { portSpeed } from './labels';
import { LB_RECT, NET_FOOT, SPINE, THERMO } from './layout';

// jsdom has no Canvas2D: static layers fall back to direct drawing (quietly).
HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext'];
const registry = createLevelRegistry();
const room = createRoomRenderer(registry);
registry.register(room);
const view: ViewPresentation = { selectedId: null, picked: null, quotes: null, reducedMotion: false };
const frameAt = (_s: RoomSnapshot, timeMs: number, paused = false): WorldFrame =>
  ({ snapshot: {} as WorldFrame['snapshot'], timeMs, paused, reducedMotion: false, zoom: null });
function draw(s: RoomSnapshot, timeMs = 5000, paused = false): Fill[] {
  const { g, fills } = recordingContext(); room.draw(g, s, view, frameAt(s, timeMs, paused)); return fills;
}
// Network rack jack i: the top face sits SPINE.z above the footprint; jacks start 8 px down its front.
const jack = (i: number) => ({ x: NET_FOOT.x + 1 + (i % 7) * 2, y: NET_FOOT.y - SPINE.z + NET_FOOT.h + 8 + Math.floor(i / 7) * 2 });
const crac = (fills: Fill[]) => fills.filter(f => f.x >= 59 && f.x < 76 && f.y >= 104 && f.y < 125).map(f => `${f.x},${f.y},${f.c}`).join('|');

describe('room motion audit', () => {
  it('lights a port jack only while that port carries a real transfer', () => {
    const live = draw(roomCase({ active: [0] }, 5000)), idle = draw(roomCase({ active: [] }, 5000));
    expect(colorAt(live, jack(0).x, jack(0).y)).toBe(P.net);
    expect(colorAt(live, jack(1).x, jack(1).y)).toBe(mix(P.net, P.ink, 0.7));
    expect(colorAt(idle, jack(0).x, jack(0).y)).toBe(mix(P.net, P.ink, 0.7));
    expect(live.some(f => f.c === P.bit && f.w > 1)).toBe(true);
    expect(idle.some(f => f.c === P.bit && f.w > 1)).toBe(false);
  });
  it('paused draws no activity: no packets, no lit jacks, no decision light, blank thermostat', () => {
    const fills = draw(roomCase({ active: [0, 1, 2], uplink: true, routed: 500 }, 5000), 5000, true);
    expect(colorAt(fills, jack(0).x, jack(0).y)).not.toBe(P.net);
    expect(fills.some(f => f.c === P.bit)).toBe(false);
    expect(fills.some(f => f.c === P.led && f.y > THERMO.y && f.y < THERMO.y + THERMO.h && f.x > THERMO.x && f.x < THERMO.x + THERMO.w)).toBe(false);
  });
  it('spins the CRAC fans at the real duty and holds them still at duty 0', () => {
    const still = roomCase({ duty: 0 }, 0);
    expect(crac(draw(still, 1000))).toBe(crac(draw(still, 1040)));
    const run = roomCase({ duty: 1 }, 0);
    draw(run, 1000);
    expect(crac(draw(run, 1000))).not.toBe(crac(draw(run, 1040)));
  });
  it('shows a crash as HALT in red with a red hall outline', () => {
    const fills = draw(CASES.crash(5000));
    expect(fills.some(f => f.c === P.fault && f.y >= THERMO.y && f.y < THERMO.y + THERMO.h)).toBe(true);
    expect(fills.some(f => f.c === P.fault && f.h > 100)).toBe(true);
  });
  it('a failed UPS darkens the hall: red cabinet frames, no CRAC status light, no packets', () => {
    const fills = draw(CASES.dark(5000));
    expect(fills.some(f => f.c === P.fault)).toBe(true);
    expect(fills.some(f => f.c === P.bit)).toBe(false);
    expect(fills.some(f => f.c === P.led && f.w === 1 && f.h === 1 && f.y > 100 && f.y < 130 && (f.x < 80 || f.x > 200))).toBe(false);
  });
});

describe('room targets', () => {
  const out: HitTarget[] = Array.from({ length: 64 }, createHitTarget);
  const kids: ChildView[] = Array.from({ length: 32 }, () => ({ ref: { level: 'rack', id: 0 } as NodeRef, rect: rect() }));
  it('offers exactly one rack build site: the next free slot in FIFO order', () => {
    const s = CASES.overview(0), n = room.targets(s, view, out, 0), slots = out.slice(0, n).filter(t => t.kind === 'add');
    expect(slots.map(t => t.slot)).toEqual([4]);
    const full = CASES.full(0), m = room.targets(full, view, out, 0);
    expect(out.slice(0, m).some(t => t.kind === 'add')).toBe(false);
  });
  it('opens the network rack (room switch) and its load balancer display', () => {
    const s = CASES.overview(0), n = room.targets(s, view, out, 0), byId = new Map(out.slice(0, n).map(t => [t.id, t]));
    expect(byId.get('netrack')?.part?.slot).toEqual({ kind: 'roomSwitch' });
    expect(byId.get('netrack')?.sw).toEqual({ kind: 'room', id: s.roomId });
    expect(byId.get('roomlb')?.part?.slot).toEqual({ kind: 'roomLb' });
    expect(byId.get('roomlb')?.rect).toEqual(LB_RECT);
    expect(byId.get('thermo')?.part?.slot).toEqual({ kind: 'roomCooler' });
  });
  it('the door walks to the next built zone, and only exists when there is one', () => {
    let n = room.targets(CASES.overview(0), view, out, 0);
    expect(out.slice(0, n).some(t => t.id === 'door')).toBe(false);
    n = room.targets(CASES.azB(0), view, out, 0);
    const door = out.slice(0, n).find(t => t.id === 'door');
    expect(door?.drill).toEqual({ level: 'room', id: 0 });
  });
  it('maps each rack zoom over its whole row (the 968 × 240 rack row at 1/8), and taps on its own 16 × 30 slot', () => {
    const s = CASES.overview(0), n = room.children(s, kids);
    expect(n).toBe(6);
    expect(kids[0].ref).toEqual({ level: 'rack', id: 0 });
    const world = kids[0].world!;
    expect([world.w * 8, world.h * 8]).toEqual([968, 240]);
    expect(kids[4].world!.x).toBe(world.x);
    // rack 9 (row 1, column 1): taps on its own slot, one 15 px pitch into its row's span
    expect(kids[5].ref).toEqual({ level: 'rack', id: 9 });
    expect([kids[5].rect.w * 8, kids[5].rect.h * 8]).toEqual([128, 240]);
    expect(kids[5].rect.x - kids[5].world!.x).toBe(15);
    expect(kids[5].world!.y).toBe(kids[5].rect.y);
  });
});

describe('room performance', () => {
  function counting() {
    let n = 0;
    const g = {
      fillStyle: '', globalAlpha: 1, imageSmoothingEnabled: false,
      fillRect() { n++; }, fillText() { n++; }, clearRect() {}, setTransform() {}, translate() {}, scale() {}, drawImage() { n++; },
      save() {}, restore() {}, beginPath() {}, rect() {}, clip() {},
    } as unknown as CanvasRenderingContext2D;
    return { g, get n() { return n; }, reset() { n = 0; } };
  }
  it('draws the 24-rack hall with a stable cost per frame', () => {
    const c = counting(), s = CASES.full(5000), f = frameAt(s, 5000);
    room.draw(c.g, s, view, f);
    const per = c.n; c.reset();
    // Best of 5 batches of 40 frames: robust to other work on a shared machine.
    let ms = Infinity;
    for (let b = 0; b < 5; b++) {
      const t0 = performance.now();
      for (let i = 0; i < 40; i++) room.draw(c.g, s, view, f);
      ms = Math.min(ms, (performance.now() - t0) / 40);
    }
    expect(c.n).toBe(per * 200);
    expect(ms).toBeLessThan(4);
  });
  it('draws 24 zone minis cheaply', () => {
    const c = counting(), z = { roomId: null, zone: 0, state: 'onMarket' as const, tempF: 78, load: 0.6, upsUsage: 0.4 };
    const f = frameAt(CASES.full(0), 0), r = rect(0, 0, 18, 16);
    let ms = Infinity;
    for (let b = 0; b < 5; b++) {
      const t0 = performance.now();
      for (let k = 0; k < 10; k++) for (let i = 0; i < 24; i++) { r.x = i * 20; room.drawMini(c.g, z, r, f); }
      ms = Math.min(ms, (performance.now() - t0) / 10);
    }
    expect(ms).toBeLessThan(2);
  });
});

describe('QA-25: the Net rack tag', () => {
  it('reads the room switch port speed (what the deck upgrades), not the uplink', () => {
    const s = CASES.overview!(0);
    expect(portSpeed(s)).toBe(s.network.switch.ports[0]!.speedHz);
    const mixed = { ...s, network: { ...s.network, switch: { ...s.network.switch, ports: [{ ...s.network.switch.ports[0]!, speedHz: 2e5 }, { ...s.network.switch.ports[0]!, speedHz: 1e5 }] } } };
    expect(portSpeed(mixed)).toBe(1e5);
  });
});
