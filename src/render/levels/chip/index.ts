// CPU level (L2, D15/D17): only the CPU. The internal node id remains chip. The pipe enters at the
// die's IN pad on top (the core draws the pipe); work falls through queue, cache and cores to OUT.
import type { ChipSnapshot } from '../../../game';
import { P, R, copyRect, resetHitTarget, setRect } from '../../core';
import type { HitTarget, LevelRegistry, LevelRenderer, Rect, WorldForm, WorldFrame } from '../../core';
import { chipLabels } from './labels';
import { coreSites, floorOf } from './layout';
import { CORE_IDS, SITE_IDS, partRef } from './model';
import type { TargetId } from './model';
import { drawChipMini } from './mini';
import { bottomOf, drawWorld, siteCount } from './world';

const owner = (s: ChipSnapshot) => ({ level: 'chip', id: s.systemId }) as const;
function part(s: ChipSnapshot, out: HitTarget[], i: number, id: Exclude<TargetId, `site${number}` | 'pipe'>, r: Rect): number {
  if (i >= out.length) return i;
  const t = resetHitTarget(out[i]!, id, 'part', owner(s));
  t.part = partRef(s.systemId, id); copyRect(r, t.rect);
  return i + 1;
}
function slot(s: ChipSnapshot, out: HitTarget[], i: number, id: TargetId, r: Rect, index: number): number {
  if (i >= out.length) return i;
  const t = resetHitTarget(out[i]!, id, 'slot', owner(s));
  t.slot = index; t.unit = { kind: 'system', id: s.systemId }; copyRect(r, t.rect);
  return i + 1;
}

export function createChipRenderer(_registry: LevelRegistry): LevelRenderer<'chip'> {
  let lastFrame: WorldFrame | null = null;
  return {
    id: 'chip', name: 'CPU',
    size: (_s, out, form) => copyRect(floorOf(form).world, out),
    focus: (_s, _vp, out, form) => copyRect(floorOf(form).focus, out),
    miniRect: (_s, out, form) => copyRect(floorOf(form).pkg, out),
    entry(_s, out, form) { const f = floorOf(form); out.x = f.inp.x; out.y = f.inp.y; return out; },
    draw(g, s, _view, frame) { lastFrame = frame; drawWorld(g, s, frame, frame.form ?? 'desktop'); },
    labels: (s, _view, frame, out) => chipLabels(s, frame, out, frame.form ?? 'desktop'),
    drawMini: drawChipMini,
    children: () => 0,
    targets(s, _view, out, from, form: WorldForm = 'desktop') {
      const f = floorOf(form);
      let i = part(s, out, from, 'clock', f.clock);
      i = part(s, out, i, 'cache', f.cache);
      i = s.scheduler ? part(s, out, i, 'queue', f.queue) : slot(s, out, i, 'queue', f.queue, 0);
      const sites = coreSites(f, siteCount(s));
      for (let c = 0; c < sites.length; c++) {
        i = c < s.cores.length ? part(s, out, i, CORE_IDS[c] as `core${number}`, sites[c]!) : slot(s, out, i, SITE_IDS[c]!, sites[c]!, c);
      }
      // The pipe's drop onto the IN pad: its callout says where the link is upgraded (D15.5).
      if (i < out.length) {
        const t = resetHitTarget(out[i++]!, 'pipe', 'link', owner(s));
        t.unit = { kind: 'system', id: s.systemId }; setRect(t.rect, f.inp.x - 4, f.pkg.y - 16, 8, f.inp.y - f.pkg.y + 18);
      }
      return i;
    },
    // Payouts pop where OUT's copper meets the world's bottom edge (D17).
    unitAnchor(s, id, out) {
      if (id !== s.systemId) return false;
      const form = lastFrame?.form ?? 'desktop', f = floorOf(form);
      setRect(out, f.out.x - 2, bottomOf(f, lastFrame) - 12, 4, 4); return true;
    },
    faults(s, out) {
      if (!out.length || (s.online !== 'crashed' && s.online !== 'dark')) return 0;
      copyRect(floorOf(lastFrame?.form).die, out[0]!); return 1;
    },
    icon(g) {
      g.clearRect(0, 0, 16, 16);
      for (let i = 0; i < 4; i++) { R(g, 4 + i * 3, 1, 1, 2, P.pad); R(g, 4 + i * 3, 13, 1, 2, P.pad); R(g, 1, 4 + i * 3, 2, 1, P.pad); R(g, 13, 4 + i * 3, 2, 1, P.pad); }
      R(g, 3, 3, 10, 10, P.ink); R(g, 4, 4, 8, 8, P.logic); R(g, 4, 4, 8, 1, P.logicHi); R(g, 4, 4, 1, 8, P.logicHi);
      R(g, 6, 6, 1, 5, P.op); R(g, 9, 6, 1, 5, P.op); R(g, 5, 5, 6, 1, P.cacheOn);
    },
  };
}
