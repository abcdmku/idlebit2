import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFixtureLevels, fixtureChip, fixtureSnapshot, fixtureSystem, SAVE_AT } from './fixtureLevels';
import { createLevelRegistry } from './registry';
import { createCanvasRenderer } from './view';
import { rect } from './geom';
import { P } from './palette';
import { recordingContext } from './testCanvas';
import type { Recording } from './testCanvas';
import type { CanvasRendererDebug, LevelRegistry, ViewPresentation, WorldFrame } from './types';
import type { Completion } from './pops';

const VIEW: ViewPresentation = { selectedId: null, picked: null, quotes: null, reducedMotion: false };
const VP = rect(0, 138, 390, 492);
let contexts: Recording[] = [];
beforeEach(() => {
  contexts = [];
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => {
    const r = recordingContext(); contexts.push(r); return r.g as unknown as ReturnType<HTMLCanvasElement['getContext']>;
  });
});
afterEach(() => vi.restoreAllMocks());

it.each([false, true])('waits for the font, then redraws the latest frame unless disposed: %s', async disposed => {
  const resolvers: ((faces: FontFace[]) => void)[] = [];
  const resolve = (faces: FontFace[]) => { for (const done of resolvers) done(faces); };
  const load = vi.fn(() => new Promise<FontFace[]>(done => { resolvers.push(done); }));
  const previous = Object.getOwnPropertyDescriptor(document, 'fonts');
  Object.defineProperty(document, 'fonts', { configurable: true, value: { load } });
  try {
    const { renderer, frames } = setup();
    renderer.draw(fixtureSnapshot(fixtureSystem(), null, { simTimeMs: 1000 }), VIEW, { nowS: 1, sincePublishMs: 0 });
    renderer.draw(fixtureSnapshot(fixtureSystem(), null, { simTimeMs: 2000 }), VIEW, { nowS: 2, sincePublishMs: 0 });
    expect(load).toHaveBeenCalledWith('600 7px "Chakra Petch"', 'BR-1');
    expect(frames).toHaveLength(0);
    if (disposed) renderer.dispose();
    resolve([{} as FontFace]);
    await vi.waitFor(() => expect(frames).toHaveLength(disposed ? 0 : 1));
    if (!disposed) expect(frames[0].timeMs).toBe(2000);
    renderer.dispose();
  } finally {
    if (previous) Object.defineProperty(document, 'fonts', previous);
    else Reflect.deleteProperty(document, 'fonts');
  }
});

function setup(): { renderer: CanvasRendererDebug; registry: LevelRegistry; frames: WorldFrame[]; main: Recording } {
  const registry = createLevelRegistry(), frames: WorldFrame[] = [];
  const [board, chip] = createFixtureLevels(registry);
  const draw = board.draw;
  board.draw = (g, s, v, f) => { frames.push({ ...f }); draw(g, s, v, f); };
  registry.register(board); registry.register(chip);
  const renderer = createCanvasRenderer(document.createElement('canvas'), registry);
  renderer.resize(390, 780, 2, VP);
  return { renderer, registry, frames, main: contexts[0] };
}
function center(r: { x: number; y: number; w: number; h: number }) { return { x: r.x + r.w / 2, y: r.y + r.h / 2 }; }

describe('canvas renderer', () => {
  it('draws the focus world with presentation time capped at 100 ms past the publish', () => {
    const { renderer, frames } = setup();
    renderer.draw(fixtureSnapshot(fixtureSystem(), null, { simTimeMs: 5000 }), VIEW, { nowS: 1, sincePublishMs: 40 });
    renderer.draw(fixtureSnapshot(fixtureSystem(), null, { simTimeMs: 5000 }), VIEW, { nowS: 1.5, sincePublishMs: 500 });
    expect(frames.map(f => [f.timeMs, f.paused])).toEqual([[5040, false], [5100, false]]);
    expect(renderer.transition).toBeNull();
  });
  it('freezes time and veils the world while the round is not running', () => {
    const { renderer, frames, main } = setup();
    renderer.draw(fixtureSnapshot(fixtureSystem(), null, { simTimeMs: 1000, round: 'ended' }), VIEW, { nowS: 1, sincePublishMs: 10 });
    renderer.draw(fixtureSnapshot(fixtureSystem(), null, { simTimeMs: 9000, round: 'ended' }), VIEW, { nowS: 2, sincePublishMs: 10 });
    expect(frames.map(f => [f.timeMs, f.paused])).toEqual([[1010, true], [1010, true]]);
    expect(main.fills.some(f => f.c === P.veil && f.w === 780 && f.h === 984)).toBe(true);
    renderer.draw(fixtureSnapshot(fixtureSystem(), null, { simTimeMs: 9000 }), VIEW, { nowS: 3, sincePublishMs: 0 });
    expect(frames.at(-1)?.timeMs).toBe(9000);
  });
  it('hits level targets in front of child drills, pads small targets to 44 CSS px, and anchors by id', () => {
    const { renderer } = setup();
    renderer.draw(fixtureSnapshot(fixtureSystem()), VIEW, { nowS: 0, sincePublishMs: 0 });
    const save = rect(), chip = rect();
    expect(renderer.anchor('save', save)).toBe(true); expect(renderer.anchor('child0', chip)).toBe(true);
    expect(save.w).toBeLessThan(44);
    const s = center(save), c = center(chip);
    expect(renderer.hit(s.x, s.y)).toMatchObject({ kind: 'save', unit: { kind: 'system', id: 0 } });
    expect(renderer.hit(s.x + 18, s.y)?.kind).toBe('save');
    expect(renderer.hit(c.x, c.y)).toMatchObject({ kind: 'child', drill: { level: 'chip', id: 0 } });
    expect(renderer.hit(c.x, 10)).toBeNull();
    expect(SAVE_AT.w).toBe(7);
  });
  it('zooms in when the focus moves to a child and the partner is the old focus, then settles', () => {
    const { renderer } = setup();
    renderer.draw(fixtureSnapshot(fixtureSystem()), VIEW, { nowS: 10, sincePublishMs: 0 });
    renderer.draw(fixtureSnapshot(fixtureChip(), fixtureSystem()), VIEW, { nowS: 10.1, sincePublishMs: 0 });
    expect(renderer.transition).toMatchObject({ from: { level: 'system' }, to: { level: 'chip' }, direction: 'in' });
    expect(renderer.hit(195, 400)).toBeNull();
    renderer.draw(fixtureSnapshot(fixtureChip(), fixtureSystem()), VIEW, { nowS: 10.6, sincePublishMs: 0 });
    expect(renderer.transition?.progress).toBeGreaterThan(0);
    renderer.draw(fixtureSnapshot(fixtureChip(), fixtureSystem()), VIEW, { nowS: 12, sincePublishMs: 0 });
    expect(renderer.transition).toBeNull();
    expect(renderer.bufferCount).toBe(2);
  });
  it('zooms out, holds for QA, and cuts without a partner', () => {
    const { renderer } = setup();
    renderer.draw(fixtureSnapshot(fixtureChip()), VIEW, { nowS: 0, sincePublishMs: 0 });
    renderer.hold(0.5);
    renderer.draw(fixtureSnapshot(fixtureSystem(), fixtureChip()), VIEW, { nowS: 0.1, sincePublishMs: 0 });
    renderer.draw(fixtureSnapshot(fixtureSystem(), fixtureChip()), VIEW, { nowS: 9, sincePublishMs: 0 });
    expect(renderer.transition).toMatchObject({ direction: 'out', progress: 0.5 });
    renderer.hold(null);
    renderer.draw(fixtureSnapshot(fixtureSystem(), fixtureChip()), VIEW, { nowS: 20, sincePublishMs: 0 });
    expect(renderer.transition).toBeNull();
    renderer.draw(fixtureSnapshot(fixtureChip()), VIEW, { nowS: 21, sincePublishMs: 0 });
    expect(renderer.transition).toBeNull();
  });
  it('smokes only while a level reports a live fault', () => {
    const { renderer, main } = setup();
    renderer.draw(fixtureSnapshot(fixtureSystem('crashed')), VIEW, { nowS: 0, sincePublishMs: 0 });
    renderer.draw(fixtureSnapshot(fixtureSystem('crashed')), VIEW, { nowS: 0.05, sincePublishMs: 0 });
    expect(main.fills.some(f => f.c === P.steelLo)).toBe(true);
    main.fills.length = 0;
    renderer.draw(fixtureSnapshot(fixtureSystem()), VIEW, { nowS: 0.1, sincePublishMs: 0 });
    expect(main.fills.some(f => f.c === P.steelLo)).toBe(false);
  });
});
describe('payout pops', () => {
  const done = (seq: number, system: number, credits: number, data = 0, tick = 9): Completion =>
    ({ seq, tick, system, cpu: 0, core: 0, gpu: null, type: 'compute', credits, data, tau: 0.5, rack: null, room: null, site: null, taskId: seq, shards: 1, work: credits });
  const pops = (main: Recording) => main.texts.filter(t => t.text.startsWith('+')).map(t => t.text);
  const at = (ms: number, completions: Completion[], round: 'running' | 'ended' = 'running') =>
    fixtureSnapshot(fixtureSystem(), null, { simTimeMs: ms, completions, round });
  it('pops the sum of one component completions once, and never for replays or other systems', () => {
    const { renderer, main } = setup();
    renderer.draw(at(1000, []), VIEW, { nowS: 0, sincePublishMs: 0 });
    renderer.draw(at(1000, [done(1, 0, 12, 1.5), done(2, 0, 30, 0.2), done(3, 5, 99)]), VIEW, { nowS: 0.01, sincePublishMs: 0 });
    expect(pops(main)).toEqual(['+42', '+1']);
    main.texts.length = 0;
    // A republished list: seq 1 to 3 are already shown; the pop stays up with the same values.
    renderer.draw(at(1100, [done(2, 0, 30), done(3, 0, 99)]), VIEW, { nowS: 0.1, sincePublishMs: 0 });
    expect(pops(main)).toEqual(['+42', '+1']);
    main.texts.length = 0;
    renderer.draw(at(2200, []), VIEW, { nowS: 1.2, sincePublishMs: 0 });
    expect(pops(main)).toEqual([]);
  });
  it('drops completions older than a pop lifetime and pops nothing while the round is over', () => {
    const { renderer, main } = setup();
    renderer.draw(at(1000, []), VIEW, { nowS: 0, sincePublishMs: 0 });
    renderer.draw(at(5000, [done(1, 0, 7, 0, 10)]), VIEW, { nowS: 0.01, sincePublishMs: 0 });
    renderer.draw(at(5000, [done(2, 0, 8, 0, 49)], 'ended'), VIEW, { nowS: 0.02, sincePublishMs: 0 });
    renderer.draw(at(5100, []), VIEW, { nowS: 0.03, sincePublishMs: 0 });
    expect(pops(main)).toEqual([]);
  });
});
