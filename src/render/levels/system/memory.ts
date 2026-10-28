// Access indicators for real RAM and disk reads. Usage is shown in reserved board rows.
// Access lights step at the active tier's real rate. Component silhouettes stay intact.
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
const r: Rect = { x: 0, y: 0, w: 0, h: 0 };

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
