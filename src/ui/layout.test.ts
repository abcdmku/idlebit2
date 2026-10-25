import { describe, expect, it } from 'vitest';
import { shellLayout } from './layout';

const on = (n: number, step: number) => n % step === 0;
const edges = (r: { x: number; y: number; w: number; h: number }) => [r.x, r.y, r.x + r.w, r.y + r.h];

describe('L2 shell geometry', () => {
  it('desktop 1440 × 900: ladder | SLA | wallet; five strip cards; the head card over Buy, the rows over Research', () => {
    const L = shellLayout(1440, 900);
    expect(L.kind).toBe('desktop');
    expect([L.N, L.w, L.h, L.x, L.y]).toEqual([3, 1440, 888, 0, 6]);
    expect(L.world).toEqual({ x: 24, y: 24, w: 1392, h: 648 });
    expect(L.band).toEqual({ x: 24, y: 24, w: 1392, h: 48 });
    expect([L.sla, L.endKey, L.wallet]).toEqual([{ x: 512, y: 24, w: 480, h: 48 }, { x: 1000, y: 24, w: 112, h: 48 }, { x: 1192, y: 24, w: 200, h: 48 }]);
    expect(L.strip).toEqual({ x: 24, y: 72, w: 1392, h: 48 });
    expect(L.headSlot).toEqual({ x: 24, y: 72, w: 336, h: 48 });
    expect(L.cards.map(c => [c.x, c.w])).toEqual([[360, 264], [624, 264], [888, 264], [1152, 264]]);
    expect(L.view.y).toBe(120);
    expect(L.now).toEqual({ x: 24, y: 696, w: 672, h: 120 });
    expect(L.dismiss).toEqual({ x: 528, y: 720, w: 144, h: 48 });
    expect(L.buy).toEqual({ x: 24, y: 816, w: 672, h: 48 });
    expect(L.kind === 'desktop' && L.rows[0]).toEqual({ x: 720, y: 696, w: 696, h: 24 });
    expect(L.research).toEqual({ x: 720, y: 816, w: 696, h: 48 });
    expect(L.pipeSrc).toEqual({ x: 72, y: 120 });
    expect(L.pipeRunY).toBe(144);
  });
  it('phone 390 × 780: ladder with the stacked wallet, SLA under it; head card full width above Build · Research · Buy', () => {
    const L = shellLayout(390, 780);
    expect(L.kind).toBe('phone');
    expect([L.N, L.w, L.h, L.x]).toEqual([2, 384, 776, 3]);
    expect(L.world).toEqual({ x: 8, y: 8, w: 368, h: 600 });
    expect(L.band).toEqual({ x: 8, y: 8, w: 368, h: 96 });
    expect(L.rungs.map(r => [r.x, r.w, r.h])).toEqual([[8, 48, 48], [56, 48, 48], [104, 48, 48], [152, 48, 48], [200, 48, 48]]);
    expect([L.wallet, L.sla, L.endKey]).toEqual([{ x: 256, y: 8, w: 112, h: 48 }, { x: 8, y: 56, w: 280, h: 48 }, { x: 296, y: 56, w: 80, h: 48 }]);
    expect(L.strip).toEqual({ x: 8, y: 104, w: 368, h: 64 });
    expect(L.headSlot).toEqual({ x: 8, y: 104, w: 112, h: 64 });
    expect(L.cards.map(c => [c.x, c.w])).toEqual([[120, 64], [184, 64], [248, 64], [312, 64]]);
    expect(L.now).toEqual({ x: 8, y: 616, w: 368, h: 80 });
    expect(L.dismiss).toEqual({ x: 264, y: 632, w: 96, h: 48 });
    expect(L.kind === 'phone' && L.build).toEqual({ x: 8, y: 704, w: 80, h: 64 });
    expect(L.research).toEqual({ x: 96, y: 704, w: 112, h: 64 });
    expect(L.buy).toEqual({ x: 216, y: 704, w: 160, h: 64 });
    expect(L.pipeSrc).toEqual({ x: 32, y: 168 });
  });
  it('the strip head holds the longest name with its state on one line at every desktop size', () => {
    for (const [w, h] of [[1440, 900], [1920, 1080], [1280, 720], [1200, 760], [1100, 700], [1366, 768]] as const) {
      const L = shellLayout(w, h), text = 'Replicated Write restarting'.length * 0.56 * L.body;
      expect(L.headSlot.w - (L.lat + 16 * L.N + 8) - 8, `${w}x${h}`).toBeGreaterThanOrEqual(text);
    }
  });
  it('N = 3 from 1200 × 760 (A01); smaller desktops drop to N = 2; narrow screens use the phone deck', () => {
    expect([shellLayout(1280, 800).kind, shellLayout(1280, 800).N, shellLayout(1200, 760).N, shellLayout(1440, 800).N]).toEqual(['desktop', 3, 3, 3]);
    expect([shellLayout(1100, 700).kind, shellLayout(1100, 700).N]).toEqual(['desktop', 2]);
    // build rows are never under 24 px, at any size
    for (const [w, h] of [[1100, 700], [1280, 800], [1440, 900]] as const) { const L = shellLayout(w, h); expect(L.kind === 'desktop' && L.rows[0].h).toBe(24); }
    expect(shellLayout(820, 1180).kind).toBe('phone');
  });
  it('every box sits on the 8 px grid and the strip and ladder on the lattice, at every size', () => {
    for (const [w, h] of [[1440, 900], [1920, 1080], [1280, 800], [1200, 760], [1100, 700], [1366, 768], [390, 780], [375, 667], [430, 932]] as const) {
      const L = shellLayout(w, h);
      const boxes = [L.world, L.band, L.strip, L.headSlot, ...L.cards, L.now, L.dismiss, L.buy, L.research, L.drawer, L.lab, L.sla, L.endKey, L.wallet, ...L.rungs,
        ...(L.kind === 'desktop' ? L.rows : [L.build])];
      for (const b of boxes) for (const e of edges(b)) expect(on(e, 8), `${w}x${h} edge ${e}`).toBe(true);
      for (const b of [L.headSlot, ...L.cards, ...L.rungs]) for (const e of edges(b)) expect(on(e, L.lat), `${w}x${h} lattice ${e}`).toBe(true);
      expect(L.world.x + L.world.w + L.gutter).toBe(L.w);
      for (const k of [L.dismiss, L.buy, L.research]) expect(k.h, `${w}x${h} key height`).toBeGreaterThanOrEqual(44);
    }
  });
  it('safe areas push the stage inside them', () => {
    const L = shellLayout(390, 844, { top: 47, right: 0, bottom: 34, left: 0 });
    expect(L.y).toBe(47);
    expect(L.h).toBe(760);
  });
});
