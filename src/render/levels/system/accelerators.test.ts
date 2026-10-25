import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FAMILIES, POOL_DOMAIN } from '../../../game';
import type { TaskView } from '../../../game';
import { DESKTOP_FRAMING, P, PHONE_FRAMING, createCanvasRenderer, createHitTarget, createLevelRegistry, rect } from '../../core';
import type { RestFraming } from '../../core';
import { fixtureSnapshot } from '../../core/fixtureLevels';
import { recordingContext } from '../../core/testCanvas';
import { createSystemRenderer } from '.';
import { BOARDS, siteCentre } from './layout';
import { boardModel } from './model';
import { sceneTaskRequirements, systemScene } from './scenes';
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
    expect(out.slice(0, n).filter(t => t.kind === 'slot').map(t => t.slot)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
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

const TASK: TaskView = { ...sceneTaskRequirements(FAMILIES.find(f => f.key === 'imageBlur')!, 8),
  key: 1, count: 1, stage: 1, resource: 'gpu', progress: 1, deadlineTick: null, accelDomain: 6 };
function flow(task: TaskView, npuSlot: number | null = null) {
  const m = boardModel({ ...full, gpu: full.gpu.map(p => p.slot === npuSlot ? { ...p, kind: 'npu', gpu: undefined } : p) });
  const rec = recordingContext(); drawStageBit(rec.g, m, task); return { ...rec, m };
}
describe('assigned accelerator task flow', () => {
  it('ends at the assigned module even when another module is the active one', () => {
    const { fills } = flow(TASK), c = siteCentre(BOARDS.accelerator, 'gpu', 6, { x: 0, y: 0 });
    const bit = fills.find(f => f.c === P.gpu)!;
    expect(Math.abs(bit.x + bit.w / 2 - c.x)).toBeLessThanOrEqual(3); expect(Math.abs(bit.y + bit.h / 2 - c.y)).toBeLessThanOrEqual(3);
  });
  it('draws no GPU path for an unassigned task', () => { expect(flow({ ...TASK, accelDomain: null }).fills).toHaveLength(0); });
  it('fans linked work out to real GPUs, excluding the NPU', () => {
    expect(flow({ ...TASK, accelDomain: POOL_DOMAIN }, 3).fills.filter(f => f.c === '#ffffff')).toHaveLength(7);
  });
  it('never portrays an NPU serving ordinary GPU work', () => {
    expect(flow({ ...TASK, accelDomain: 3 }, 3).fills).toHaveLength(0);
    const tensor = FAMILIES.find(f => f.tensor && f.gpuCoresMin === 0)!;
    expect(flow({ ...TASK, ...sceneTaskRequirements(tensor, 2), accelDomain: 3 }, 3).fills.some(f => f.c === P.rnd)).toBe(true);
  });
});
