// The CPU as a mini in the System board's socket: the package and its blocks, mapped with the same
// contain transform the zoom uses (miniRect = the package), so the dive lands on it exactly.
import type { ChipSnapshot, SystemSnapshot } from '../../../game';
import { P, R, containMap, contain, frame as outline, mix } from '../../core';
import type { Rect, WorldFrame } from '../../core';
import { coreSites, floorOf } from './layout';
import { PKG, PKG_HI } from './sprites';
import { isLive, siteCount } from './world';

const m = contain();
/** The live chip for a system: the focus or partner when it is on screen, else the system's copy. */
export function liveChip(frame: WorldFrame, system: SystemSnapshot): ChipSnapshot {
  const s = frame.snapshot;
  if (s.focus.level === 'chip' && s.focus.systemId === system.systemId) return s.focus;
  if (s.partner?.level === 'chip' && s.partner.systemId === system.systemId) return s.partner;
  return system.chip;
}
export function drawChipMini(g: CanvasRenderingContext2D, system: SystemSnapshot, rect: Rect, frame: WorldFrame): void {
  const chip = liveChip(frame, system), live = isLive(chip, frame), f = floorOf(frame.form);
  containMap(rect, f.pkg, m);
  const box = (r: Rect, c: string): Rect => {
    const x = Math.round(m.ox + r.x * m.k), y = Math.round(m.oy + r.y * m.k);
    const w = Math.max(1, Math.round(m.ox + (r.x + r.w) * m.k) - x), h = Math.max(1, Math.round(m.oy + (r.y + r.h) * m.k) - y);
    R(g, x, y, w, h, c); return { x, y, w, h };
  };
  const pkg = box(f.pkg, PKG);
  outline(g, pkg.x - 1, pkg.y - 1, pkg.w + 2, pkg.h + 2, P.ink);
  if (pkg.w >= 8) R(g, pkg.x, pkg.y, pkg.w, 1, PKG_HI);
  box(f.die, P.wafer);
  box(f.queue, chip.scheduler ? P.logicLo : mix(P.wafer, P.ink, 0.2));
  const cache = box(f.cache, P.sram);
  const cap = chip.cache.capacityBits, used = live ? Math.min(chip.cache.usedBits, cap) : 0;
  if (cap > 0 && used > 0) R(g, cache.x, cache.y, Math.max(1, Math.round(cache.w * used / cap)), cache.h, P.cacheOn);
  box(f.clock, P.waferHi);
  const sites = coreSites(f, siteCount(chip));
  for (let i = 0; i < sites.length; i++) {
    const c = chip.cores[i];
    box(sites[i]!, !c ? mix(P.wafer, P.ink, 0.25) : live && c.busy > 0 ? P.logicHi : live && c.research > 0 ? mix(P.logic, P.rnd, 0.3) : P.logic);
  }
}
