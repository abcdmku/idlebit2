import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FAMILIES, POOL_DOMAIN } from '../../../game';
import type { TaskView } from '../../../game';
import { DESKTOP_FRAMING, P, PHONE_FRAMING, createCanvasRenderer, createHitTarget, createLevelRegistry, flowColor, rect } from '../../core';
import type { RestFraming } from '../../core';
import { fixtureSnapshot } from '../../core/fixtureLevels';
import { recordingContext } from '../../core/testCanvas';
import { createSystemRenderer } from '.';
import { BOARDS } from './layout';
import { boardModel } from './model';
import { sceneTask, sceneTaskRequirements, systemScene } from './scenes';
import { drawGpuPiece } from './shards';
import { drawStageBit } from './world';

const VIEW = { selectedId: null, picked: null, quotes: null, reducedMotion: false };
const overlaps = (a: { x: number; y: number; w: number; h: number }, b: typeof a) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => recordingContext().g as unknown as ReturnType<HTMLCanvasElement['getContext']>);
});
afterEach(() => vi.restoreAllMocks());

const full = systemScene('full');
const empty = { ...full, gpu: [], slots: Array.from({ length: 8 }, (_, index) => ({ kind: 'gpu' as const, index, locked: false })) };

describe('accelerator board', () => {
  it('seats the baseboard GPUs, vertical DIMMs and M.2 drives in their own sites', () => {
    const m = boardModel(full);
    expect(m.b).toBe(BOARDS.accelerator);
    expect(m.installed.gpu.map(s => s.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(m.installed.ram.map(s => s.index)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(m.installed.drive.map(s => s.index)).toEqual([0, 1, 2, 3]);
    const out = Array.from({ length: 64 }, createHitTarget), n = createSystemRenderer(createLevelRegistry()).targets(full, VIEW, out, 0);
    const gpus = out.slice(0, n).filter(t => /^gpu\d$/.test(t.id));
    expect(gpus).toHaveLength(8);
    for (const [i, a] of gpus.entries()) for (const b of gpus.slice(i + 1)) expect(overlaps(a.rect, b.rect)).toBe(false);
  });
  it('offers empty open sites as slot targets', () => {
    const out = Array.from({ length: 64 }, createHitTarget), n = createSystemRenderer(createLevelRegistry()).targets(empty, VIEW, out, 0);
    expect(out.slice(0, n).filter(t => t.kind === 'slot' || t.kind === 'add').map(t => t.slot)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });
  it.each([['desktop', DESKTOP_FRAMING, 1440, 900, rect(24, 24, 1392, 648)], ['phone', PHONE_FRAMING, 390, 780, rect(8, 8, 368, 600)]] as const)(
    'gives every GPU a distinct, tappable anchor on %s', (_name, framing: RestFraming, w, h, vp) => {
      const registry = createLevelRegistry(); registry.register(createSystemRenderer(registry));
      const renderer = createCanvasRenderer(document.createElement('canvas'), registry);
      renderer.resize(w, h, 1, vp, framing);
      renderer.draw(fixtureSnapshot(full), VIEW, { nowS: 0, sincePublishMs: 0 });
      const rects = Array.from({ length: 8 }, (_, i) => {
        const r = rect(); expect(renderer.anchor(`gpu${i}`, r)).toBe(true);
        expect(renderer.hit(r.x + r.w / 2, r.y + r.h / 2)?.id).toBe(`gpu${i}`);
        return r;
      });
      for (const [i, a] of rects.entries()) for (const b of rects.slice(i + 1)) expect(overlaps(a, b)).toBe(false);
      renderer.dispose();
    });
});

const TASK: TaskView = sceneTask('imageBlur', 8, { resource: 'gpu', progress: 0.25, accelDomain: 6 });
const BLUR = flowColor(TASK);
function piece(task: TaskView, npuSlot: number | null = null) {
  const m = boardModel({ ...full, gpu: full.gpu.map(p => p.slot === npuSlot ? { ...p, kind: 'npu', gpu: undefined } : p) });
  const rec = recordingContext(), n = drawGpuPiece(rec.g, m, task);
  return { ...rec, m, n, lit: rec.fills.filter(f => f.c === flowColor(task)) };
}
/** The site index of the card a fill lies on. */
const cardOf = (f: { x: number; y: number }) => BOARDS.accelerator.sites.gpu.findIndex(r => f.x >= r.x && f.x < r.x + r.w && f.y >= r.y - 6 && f.y < r.y + r.h);
describe('a GPU-stage shard (D25)', () => {
  it('lights its piece on the assigned module, in its task type colour, even when another module is the active one', () => {
    const { lit, n } = piece(TASK);
    expect(n).toBe(1);
    expect(lit).toHaveLength(1);
    expect(cardOf(lit[0]!)).toBe(6);
  });
  it('drains the piece as the stage runs: the remaining work, 1 - progress', () => {
    const width = (progress: number) => piece({ ...TASK, progress }).lit[0]?.w ?? 0;
    const full0 = width(0);
    expect(full0).toBeGreaterThan(20);
    expect(width(0.25)).toBe(Math.round(full0 * 0.75));
    expect(width(0.5)).toBe(Math.round(full0 * 0.5));
    expect(width(1)).toBe(0);
    expect(BLUR).not.toBe(P.gpu);
  });
  it('draws no piece for an unassigned shard or a CPU stage, and no travelling GPU bit', () => {
    expect(piece({ ...TASK, accelDomain: null }).fills).toHaveLength(0);
    expect(piece({ ...TASK, resource: 'compute' }).fills).toHaveLength(0);
    const rec = recordingContext(); drawStageBit(rec.g, boardModel(full), TASK);
    expect(rec.fills).toHaveLength(0);
  });
  it('splits linked work over the real GPUs, excluding the NPU', () => {
    const { lit } = piece({ ...TASK, accelDomain: POOL_DOMAIN }, 3);
    expect(lit.map(cardOf).sort()).toEqual([0, 1, 2, 4, 5, 6, 7]);
  });
  it('never portrays an NPU serving ordinary GPU work', () => {
    expect(piece({ ...TASK, accelDomain: 3 }, 3).fills).toHaveLength(0);
    const tensor = FAMILIES.find(f => f.tensor && f.gpuCoresMin === 0)!;
    const t = { ...TASK, ...sceneTaskRequirements(tensor, 2), accelDomain: 3 };
    expect(piece(t, 3).lit.map(cardOf)).toEqual([3]);
  });
});
