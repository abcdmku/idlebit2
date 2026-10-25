import { P } from './palette';
type DrawSprite = (g: CanvasRenderingContext2D) => void;
export function context2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext('2d');
  if (!context) throw new Error('idlebit2 requires Canvas2D');
  context.imageSmoothingEnabled = false;
  return context;
}
export function createSpriteCache() {
  const cache = new Map<string, HTMLCanvasElement>();
  return {
    get size() { return cache.size; },
    cached(key: string, w: number, h: number, draw: DrawSprite): HTMLCanvasElement {
      let canvas = cache.get(key);
      if (!canvas || canvas.width !== w || canvas.height !== h) {
        canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
        draw(context2d(canvas)); cache.set(key, canvas);
      }
      return canvas;
    },
    clear() { cache.clear(); },
  };
}
const shared = createSpriteCache();
export const cached = shared.cached;
export const clearSpriteCache = shared.clear;
export function pix(rows: readonly string[], map: Readonly<Record<string, string>>): HTMLCanvasElement {
  const canvas = document.createElement('canvas'); canvas.width = rows[0]?.length ?? 0; canvas.height = rows.length;
  const g = context2d(canvas);
  for (let y = 0; y < rows.length; y++) for (let x = 0; x < rows[y].length; x++) {
    const color = map[rows[y][x]];
    if (color) { g.fillStyle = color; g.fillRect(x, y, 1, 1); }
  }
  return canvas;
}
export function stamp(g: CanvasRenderingContext2D, sprite: CanvasImageSource, x: number, y: number): void { g.drawImage(sprite, x | 0, y | 0); }
export function dataURL(canvas: HTMLCanvasElement, scale = 1): string {
  if (scale === 1) return canvas.toDataURL();
  const out = document.createElement('canvas'); out.width = canvas.width * scale; out.height = canvas.height * scale;
  context2d(out).drawImage(canvas, 0, 0, out.width, out.height); return out.toDataURL();
}
const COIN5 = ['.kkk.', 'kwyyk', 'kyyok', 'kyook', '.kkk.'];
const COIN8 = ['..kkkk..', '.kwyyyk.', 'kwyyyyok', 'kwyyyyok', 'kyyyyyok', 'kyyyyook', '.kooook.', '..kkkk..'];
const GEM8 = ['...kk...', '..kwtk..', '.kwttdk.', 'kwtttddk', 'kttttddk', '.kttddk.', '..kddk..', '...kk...'];
const LOCK = ['..kkk..', '.k...k.', '.k...k.', 'kkkkkkk', 'kgggggk', 'kggkggk', 'kgggggk', 'kkkkkkk'];
const ARROW = ['...k...', '..kwk..', '.kyyyk.', 'kkyyykk', '..kyk..', '..kok..', '..kkk..'];
const coinMap = { k: P.goldInk, w: P.goldHi, y: P.gold, o: P.goldLo };
const drawCoin5: DrawSprite = g => g.drawImage(pix(COIN5, coinMap), 0, 0);
const drawCoin8: DrawSprite = g => g.drawImage(pix(COIN8, coinMap), 0, 0);
const drawGem: DrawSprite = g => g.drawImage(pix(GEM8, { k: '#06372a', w: P.dataHi, t: P.data, d: P.dataLo }), 0, 0);
const drawLock: DrawSprite = g => g.drawImage(pix(LOCK, { k: P.ink, g: P.silk }), 0, 0);
const drawArrow: DrawSprite = g => g.drawImage(pix(ARROW, { k: P.ink, w: P.goldHi, y: P.gold, o: P.goldLo }), 0, 0);
const drawArrowDim: DrawSprite = g => g.drawImage(pix(ARROW, { k: P.ink, w: P.silkLo, y: P.silkLo, o: P.silkLo }), 0, 0);
export const SPR = {
  get coin5() { return cached('coin5', 5, 5, drawCoin5); },
  get coin8() { return cached('coin8', 8, 8, drawCoin8); },
  get gem8() { return cached('gem8', 8, 8, drawGem); },
  get lock() { return cached('lock', 7, 8, drawLock); },
  get arrow() { return cached('arrow', 7, 7, drawArrow); },
  get arrowDim() { return cached('arrowDim', 7, 7, drawArrowDim); },
};
