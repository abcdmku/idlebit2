import { describe, expect, it } from 'vitest';
import { shellLayout } from '../layout';
import { intersects, placePlate } from './place';

describe('a part\'s detail never covers the tapped part (user, 26 Oct)', () => {
  it.each([[1440, 900, 300, 260], [390, 844, 374, 260]] as const)('anywhere in the world at %ix%i', (w, h, pw, content) => {
    const L = shellLayout(w, h), safe = L.calloutBounds, beside = L.kind === 'desktop';
    for (let y = safe.y; y + 48 <= safe.y + safe.h; y += 24) for (let x = safe.x; x + 48 <= safe.x + safe.w; x += 24) {
      const part = { x, y, w: 48, h: 48 }, at = placePlate(part, pw, content, safe, { beside });
      expect(intersects(at, part), `${w}x${h} part at ${x},${y} → ${JSON.stringify(at)}`).toBe(false);
      expect(at.h).toBeGreaterThan(0);
    }
  });
  it('desktop docks in the right gutter level with the part; phone sits below, else above', () => {
    const d = shellLayout(1440, 900), at = placePlate({ x: 600, y: 300, w: 96, h: 96 }, 300, 200, d.calloutBounds, { beside: true });
    expect([at.x + at.w, at.y]).toEqual([d.calloutBounds.x + d.calloutBounds.w, 300]);
    const p = shellLayout(390, 844), low = placePlate({ x: 100, y: 600, w: 96, h: 40 }, 374, 200, p.calloutBounds);
    expect(low.y + low.h).toBeLessThanOrEqual(600);
  });
});
