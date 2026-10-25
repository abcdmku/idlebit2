// CSS-space effects drawn over the world after the blit.
// Every effect is authorized by sim state: smoke by a fault that is still live this
// frame. Seeded randomness only varies the look. Payouts pop on their component (pops.ts).
import { P } from './palette';
import { rng } from './px';
import type { Rect } from './geom';

export type EffectKind = 'smoke';
export interface EffectSlot {
  active: boolean; kind: EffectKind; x: number; y: number; vx: number; vy: number;
  age: number; life: number; source: number; seen: boolean;
}
export const EFFECT_LIMITS = Object.freeze({ smoke: 16 });

/** Overflow drops a cosmetic; it never acknowledges a game action. */
export function createEffectPool(seed = 1) {
  const random = rng(seed), slots: EffectSlot[] = [], bounds: Rect = { x: 0, y: 0, w: 0, h: 0 };
  for (const kind of ['smoke'] as const) for (let i = 0; i < EFFECT_LIMITS[kind]; i++) {
    slots.push({ active: false, kind, x: 0, y: 0, vx: 0, vy: 0, age: 0, life: 1, source: -1, seen: false });
  }
  function acquire(kind: EffectKind, x: number, y: number, source: number): EffectSlot | null {
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i];
      if (slot.active || slot.kind !== kind) continue;
      slot.active = true; slot.x = x; slot.y = y; slot.age = 0; slot.vx = 0; slot.vy = 0; slot.source = source; slot.seen = true;
      return slot;
    }
    return null;
  }
  return {
    get capacity() { return slots.length; },
    activeCount(kind?: EffectKind): number {
      let count = 0;
      for (let i = 0; i < slots.length; i++) if (slots[i].active && (!kind || slots[i].kind === kind)) count++;
      return count;
    },
    resize(viewport: Rect): void { Object.assign(bounds, viewport); },
    /** Call every frame while `source` is faulted. Smoke stops the frame the caller stops calling. */
    smoke(source: number, x: number, y: number): boolean {
      for (let i = 0; i < slots.length; i++) {
        const slot = slots[i];
        if (slot.active && slot.kind === 'smoke' && slot.source === source) { slot.x = x; slot.y = y; slot.seen = true; return true; }
      }
      const slot = acquire('smoke', x, y, source);
      if (!slot) return false;
      slot.life = 0.8 + random() * 0.4; slot.vx = (random() - 0.5) * 8; slot.vy = -10 - random() * 8; return true;
    },
    /** Advance by real presentation seconds. Drops smoke not refreshed since the last update. */
    update(dtS: number): void {
      const dt = Math.max(0, dtS);
      for (let i = 0; i < slots.length; i++) {
        const slot = slots[i];
        if (!slot.active) continue;
        if (!slot.seen) { slot.active = false; continue; }
        slot.seen = false; slot.age = (slot.age + dt) % slot.life;
      }
    },
    draw(g: CanvasRenderingContext2D, reducedMotion = false): void {
      if (reducedMotion) return;
      g.save(); g.beginPath(); g.rect(bounds.x, bounds.y, bounds.w, bounds.h); g.clip();
      for (let i = 0; i < slots.length; i++) {
        const slot = slots[i];
        if (!slot.active) continue;
        const u = slot.age / slot.life;
        g.globalAlpha = Math.min(1, (1 - u) * 3);
        const size = 3 + Math.floor(u * 4);
        g.fillStyle = P.steelLo; g.fillRect(Math.round(slot.x + slot.vx * slot.age), Math.round(slot.y + slot.vy * slot.age), size, size);
      }
      g.restore();
    },
    /** Epoch change or load: forget everything. */
    clear(): void { for (let i = 0; i < slots.length; i++) slots[i].active = false; },
  };
}
export type EffectPool = ReturnType<typeof createEffectPool>;
