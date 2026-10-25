// D26 memory hierarchy on the System board: cache, then RAM, then disk. Each tier fills its own parts,
// part by part in slot order, so the board shows where the data sits: RAM sticks and drives fill
// along their long side in the tier colour. The sim counts every RAM and disk bit as spilled (it
// overflowed a faster tier), so only disk is hatched with ink stripes: that is the box paging to disk. A light on the tier a running shard reads from now steps
// at that tier's real rate. Everything here is snapshot state; nothing moves on its own.
import type { MemTierView, SystemSnapshot } from '../../../game';
import { P, R, createRateAnimation, rateAnimation } from '../../core';
import type { Rect } from '../../core';
import { siteRect } from './layout';
import type { BoardModel, Site } from './model';

type G = CanvasRenderingContext2D;
export function tierOf(s: SystemSnapshot, tier: MemTierView['tier']): MemTierView | null {
  for (const t of s.memory.tiers) if (t.tier === tier) return t;
  return null;
}
const SITES: Readonly<Record<'ram' | 'disk', 'ram' | 'drive'>> = { ram: 'ram', disk: 'drive' };
const COLOUR: Readonly<Record<'ram' | 'disk', string>> = { ram: P.ram, disk: P.stor };
const r: Rect = { x: 0, y: 0, w: 0, h: 0 };

/** Diagonal ink stripes over `x, y, w, h`: the spilled share. One art px wide, every third pixel. */
export function hatch(g: G, x: number, y: number, w: number, h: number): void {
  g.fillStyle = P.ink;
  for (let j = 0; j < h; j++) for (let i = (j % 3); i < w; i += 3) g.fillRect(x + i, y + j, 1, 1);
}
/** Fill a part's body along its long side: `used` of `cap`, the last `spill` of it hatched. */
function fillPart(g: G, f: Rect, cap: number, used: number, spill: number, colour: string): void {
  if (cap <= 0 || used <= 0) return;
  const tall = f.h > f.w, len = tall ? f.h - 2 : f.w - 2, u = Math.min(1, used / cap), s = Math.min(u, spill / cap);
  // Any spill shows: at least 3 art px of hatch, so a few kb paging on a big drive still reads.
  const k = spill > 0 ? Math.max(3, Math.round(len * s)) : 0, n = Math.max(1, k, Math.round(len * u)), a = g.globalAlpha;
  g.globalAlpha = a * 0.6;
  if (tall) R(g, f.x + 1, f.y + 1 + len - n, f.w - 2, n, colour); else R(g, f.x + 1, f.y + 1, n, f.h - 2, colour);
  g.globalAlpha = a;
  if (k > 0) { if (tall) hatch(g, f.x + 1, f.y + 1 + len - n, f.w - 2, k); else hatch(g, f.x + 1 + n - k, f.y + 1, k, f.h - 2); }
}
/** The RAM and disk tiers fill their parts in slot order; spilled bits are the last to arrive, so they fill last. */
export function drawTiers(g: G, s: SystemSnapshot, m: BoardModel, live: boolean): void {
  if (!live) return;
  for (const tier of ['ram', 'disk'] as const) {
    const t = tierOf(s, tier), sites = m.installed[SITES[tier]];
    if (!t || !sites.length || t.usedBits <= 0) continue;
    // Disk bits are paging (hatched); RAM holding cache overflow is normal, plain fill.
    const spillFrom = tier === 'disk' ? t.usedBits - t.spilledBits : t.usedBits;
    let left = t.usedBits;
    for (const site of sites) {
      const cap = site.part?.capacityBits ?? t.capacityBits / sites.length;
      const used = Math.min(cap, left), start = t.usedBits - left;
      const spill = Math.max(0, start + used - Math.max(start, spillFrom));
      fillPart(g, partRect(m, site), cap, used, spill, COLOUR[tier]);
      left -= used;
      if (left <= 0) break;
    }
  }
}
function partRect(m: BoardModel, site: Site): Rect { return siteRect(m.b, site.type, site.index, r); }

const read = { ram: createRateAnimation(), disk: createRateAnimation() };
/**
 * The light on the tier a running shard reads from now: a 2×2 lamp at the tier's first part, stepping
 * at the tier's real rate (steady at the eye rate and up). The cache part runs at core speed and has no light.
 */
export function drawReadLights(g: G, s: SystemSnapshot, m: BoardModel, timeMs: number, live: boolean): void {
  for (const tier of ['ram', 'disk'] as const) {
    let reading = false;
    if (live) for (const t of s.running) if (t.memTier === tier) { reading = true; break; }
    const v = tierOf(s, tier), site = m.installed[SITES[tier]][0];
    if (!v || !site) continue;
    const a = rateAnimation(v.rateBits ?? 0, timeMs, 2, reading, read[tier]);
    const f = partRect(m, site), x = f.x + f.w - 3, y = f.y + 1;
    R(g, x - 1, y - 1, 4, 4, P.ink);
    R(g, x, y, 2, 2, a.active && (a.saturated || a.phase < 0.5) ? (tier === 'disk' ? P.amber : P.ram) : P.ledOff);
  }
}

/**
 * D26 `unifiedMemory`: a card whose VRAM need overflowed into RAM and disk shows the share it spilled
 * as a hatched band along its foot, in the RAM colour, up to its full width.
 */
export function drawGpuSpill(g: G, m: BoardModel, live: boolean): void {
  if (!live) return;
  for (const site of m.installed.gpu) {
    const p = site.part, spill = p?.unifiedSpillBits ?? 0;
    if (!p || spill <= 0) continue;
    const vram = p.gpu?.vramBits ?? 0, f = partRect(m, site);
    const w = Math.max(3, Math.round((f.w - 2) * (vram > 0 ? Math.min(1, spill / vram) : 1)));
    R(g, f.x + 1, f.y + f.h - 4, w, 3, P.ram); hatch(g, f.x + 1, f.y + f.h - 4, w, 3);
  }
}
