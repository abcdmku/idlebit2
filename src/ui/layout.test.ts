import { describe, expect, it } from 'vitest';
import { shellLayout } from './layout';

const on = (n: number, step: number) => n % step === 0;
const edges = (r: { x: number; y: number; w: number; h: number }) => [r.x, r.y, r.x + r.w, r.y + r.h];

describe('L2 shell geometry', () => {
  it('desktop 1440 × 900 matches the approved layout (D17)', () => {
    const L = shellLayout(1440, 900);
    expect(L.kind).toBe('desktop');
    expect([L.N, L.w, L.h, L.x, L.y]).toEqual([3, 1440, 888, 0, 6]);
    expect(L.world).toEqual({ x: 24, y: 24, w: 1392, h: 648 });
    expect(L.band).toEqual({ x: 24, y: 24, w: 1392, h: 48 });
    expect(L.strip).toEqual({ x: 24, y: 72, w: 1392, h: 48 });
    expect(L.headSlot).toEqual({ x: 24, y: 72, w: 240, h: 48 });
    expect(L.cards.map(c => c.x)).toEqual([264, 552, 840, 1128]);
    expect(L.view.y).toBe(120);
    expect(L.now).toEqual({ x: 24, y: 696, w: 696, h: 120 });
    expect(L.buy).toEqual({ x: 24, y: 816, w: 696, h: 48 });
    expect(L.kind === 'desktop' && L.rows[0]).toEqual({ x: 744, y: 696, w: 672, h: 24 });
    expect(L.research).toEqual({ x: 744, y: 816, w: 672, h: 48 });
    expect(L.pipeSrc).toEqual({ x: 72, y: 120 });
    expect(L.pipeRunY).toBe(144);
  });
  it('phone 390 × 780 matches, with the thumb zone bottom right', () => {
    const L = shellLayout(390, 780);
    expect(L.kind).toBe('phone');
    expect([L.N, L.w, L.h, L.x]).toEqual([2, 384, 776, 3]);
    expect(L.world).toEqual({ x: 8, y: 8, w: 368, h: 600 });
    expect(L.band).toEqual({ x: 8, y: 8, w: 368, h: 80 });
    expect(L.rungs.map(r => [r.x, r.w, r.h])).toEqual([[8, 48, 48], [56, 48, 48], [104, 48, 48], [152, 48, 48], [200, 48, 48]]);
    expect(L.strip).toEqual({ x: 8, y: 88, w: 368, h: 64 });
    expect(L.now).toEqual({ x: 8, y: 616, w: 368, h: 80 });
    expect(L.dismiss).toEqual({ x: 264, y: 632, w: 96, h: 48 });
    expect(L.kind === 'phone' && L.build).toEqual({ x: 8, y: 704, w: 80, h: 64 });
    expect(L.research).toEqual({ x: 96, y: 704, w: 112, h: 64 });
    expect(L.buy).toEqual({ x: 216, y: 704, w: 160, h: 64 });
    expect(L.pipeSrc).toEqual({ x: 32, y: 152 });
  });
  it('smaller desktops drop to N = 2 on a 16 px cell; narrow screens use the phone deck', () => {
    expect([shellLayout(1280, 800).kind, shellLayout(1280, 800).N]).toEqual(['desktop', 2]);
    expect(shellLayout(1440, 800).N).toBe(2);
    expect(shellLayout(820, 1180).kind).toBe('phone');
  });
  it('every box sits on the 8 px grid and the strip and ladder on the lattice, at every size', () => {
    for (const [w, h] of [[1440, 900], [1920, 1080], [1280, 800], [1366, 768], [390, 780], [375, 667], [430, 932]] as const) {
      const L = shellLayout(w, h);
      const boxes = [L.world, L.band, L.strip, L.headSlot, ...L.cards, L.now, L.dismiss, L.buy, L.research, L.drawer, ...L.rungs,
        ...(L.kind === 'desktop' ? L.rows : [L.build])];
      for (const b of boxes) for (const e of edges(b)) expect(on(e, 8), `${w}x${h} edge ${e}`).toBe(true);
      for (const b of [L.headSlot, ...L.cards, ...L.rungs]) for (const e of edges(b)) expect(on(e, L.lat), `${w}x${h} lattice ${e}`).toBe(true);
      expect(L.world.x + L.world.w + L.gutter).toBe(L.w);
    }
  });
  it('safe areas push the stage inside them', () => {
    const L = shellLayout(390, 844, { top: 47, right: 0, bottom: 34, left: 0 });
    expect(L.y).toBe(47);
    expect(L.h).toBe(760);
  });
});
