import { projectRect } from './camera';
import type { Camera, PixelRatio } from './camera';
import type { Rect } from './geom';

export { contains } from './geom';
const scratch: Rect = { x: 0, y: 0, w: 0, h: 0 };
/** Exact hits win. Expanded hits pick the nearest rect, then nearest row, then frontmost.
 * Supply targets in stable back-to-front drawing order. Never return an invisible overlap arbitrarily.
 */
export function arbitrateHit<T extends { readonly rect: Rect }>(targets: readonly T[], count: number, xCss: number, yCss: number,
  cam: Camera, viewport: Rect, ratio: PixelRatio, minimumCss = 44): T | null {
  let best: T | null = null, bestDistance = Infinity, bestRow = Infinity, bestBottom = -Infinity;
  for (let i = 0; i < count; i++) {
    const target = targets[i], r = projectRect(cam, viewport, ratio, target.rect, scratch);
    const dx = Math.max(r.x - xCss, 0, xCss - r.x - r.w), dy = Math.max(r.y - yCss, 0, yCss - r.y - r.h);
    if (dx > Math.max(0, (minimumCss - r.w) / 2) || dy > Math.max(0, (minimumCss - r.h) / 2)) continue;
    const distance = dx * dx + dy * dy, row = Math.abs(yCss - r.y - r.h / 2), bottom = r.y + r.h;
    if (distance < bestDistance || (distance === bestDistance && (row < bestRow || (row === bestRow && bottom >= bestBottom)))) {
      best = target; bestDistance = distance; bestRow = row; bestBottom = bottom;
    }
  }
  return best;
}
