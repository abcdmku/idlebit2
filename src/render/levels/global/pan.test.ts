import { describe, expect, it } from 'vitest';
import type { GlobalSnapshot } from '../../../game';
import { DESKTOP_FRAMING, PHONE_FRAMING, RestPan, rect } from '../../core';
import type { LevelRenderer } from '../../core';
import { CELLS, SIZE } from './layout';
import { worldCentre, worldFocus } from './pan';

const owned = (cells: number[]) => ({ level: 'global', sites: CELLS.map((_, i) => ({ siteId: cells.includes(i) ? i : null })) }) as unknown as GlobalSnapshot;

describe('World framing (A09)', () => {
  it('frames the owned sites with a region of context, and the whole map before any site is owned', () => {
    const out = rect();
    worldFocus(owned([0]), out);
    expect(out.x).toBe(SIZE.x); expect(out.x + out.w).toBeLessThan(SIZE.x + SIZE.w);
    worldFocus(owned([]), out);
    expect(out).toEqual(SIZE);
  });
  it('rests at 2 and pans on phone when the context does not fit, centred on the owned sites', async () => {
    const { frameRest } = await import('../../core/restPan');
    const pan = new RestPan(), focus = rect(), s = owned([0, 1, 5]), lv = { restCentre: (_s: unknown, o: { x: number; y: number }) => worldCentre(s, o) } as unknown as LevelRenderer;
    worldFocus(s, focus);
    // frameRest drives the shared pan; check the window maths on a private one too.
    pan.window({ ...focus }, 176, 242, { x: 50, y: 50 }, 2, { x: 96, y: 49 });
    expect(pan.active).toBe(true);
    const vp = rect(8, 8, 368, 692), f = { ...PHONE_FRAMING, pipe: { x: 32, y: 200, runY: 208 } };
    frameRest(lv, s, focus, vp, f, { w: 352, h: 484, scale: 2 }, null, () => {});
    expect(focus.w).toBe(176);
    const c = { x: 0, y: 0 }; worldCentre(s, c);
    expect(Math.abs(focus.x + focus.w / 2 - c.x)).toBeLessThanOrEqual(1);
    void DESKTOP_FRAMING;
  });
});
