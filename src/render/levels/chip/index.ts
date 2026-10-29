// CPU level (Control deck, D15/D17): only the CPU. The internal node id remains chip. The pipe enters at the
// die's IN pad on top (the core draws the pipe); work falls through queue and cache to the cores,
// and each payout pops on the core that ran it.
import type { ChipSnapshot } from '../../../game';
import { P, R, copyRect, partVersionOf, resetHitTarget, setRect, sumVersions } from '../../core';
import type { HitTarget, LevelRegistry, LevelRenderer, Rect, WorldForm, WorldFrame } from '../../core';
import { chipLabels } from './labels';
import { coreSites } from './layout';
import { partRef } from './model';
import type { TargetId } from './model';
import { drawChipMini } from './mini';
import { QueuePickups } from './pickups';
import { chipFloor, coresBlock, drawWorld, siteCount } from './world';

const owner = (s: ChipSnapshot) => ({ level: 'chip', id: s.systemId, socket: s.socket }) as const;
function part(s: ChipSnapshot, out: HitTarget[], i: number, id: Exclude<TargetId, `site${number}` | 'pipe' | 'cores'>, r: Rect): number {
  if (i >= out.length) return i;
  const t = resetHitTarget(out[i]!, id, 'part', owner(s));
  t.part = partRef(s.systemId, id, s.socket); copyRect(r, t.rect);
  return i + 1;
}
function slot(s: ChipSnapshot, out: HitTarget[], i: number, id: TargetId, r: Rect, index: number): number {
  if (i >= out.length) return i;
  const t = resetHitTarget(out[i]!, id, 'slot', owner(s));
  t.slot = index; t.unit = { kind: 'system', id: s.systemId }; copyRect(r, t.rect);
  return i + 1;
}

export function createChipRenderer(_registry: LevelRegistry): LevelRenderer<'chip'> {
  const pickups = new QueuePickups();
  let lastFrame: WorldFrame | null = null;
  let restForm: WorldForm = 'desktop', restHeight = Infinity;
  return {
    id: 'chip', name: 'CPU',
    /** The die grows with its cores (user): it keeps 3× desktop / 2× phone and pans down rather than shrink. */
    panAtRestScale: true,
    size: (s, out, form) => copyRect(chipFloor(s, form).world, out),
    focus(s, _vp, out, form, area) {
      restForm = form ?? 'desktop';
      if (area) restHeight = area.h / area.scale;
      return copyRect(chipFloor(s, restForm).focus, out);
    },
    miniRect: (s, out, form) => copyRect(chipFloor(s, form).pkg, out),
    entry(s, out, form) { const f = chipFloor(s, form); out.x = f.inp.x; out.y = f.inp.y; return out; },
    /** Short phones open on the clock and working cores. The full queue/cache remain reachable by panning. */
    restCentre(s, out) {
      const f = chipFloor(s, restForm), first = coreSites(f, siteCount(s))[0];
      out.x = f.pkg.x + f.pkg.w / 2;
      out.y = restForm === 'phone' && first && restHeight < first.y + first.h - f.focus.y
        ? (f.clock.y + first.y + first.h) / 2 : f.focus.y;
    },
    draw(g, s, view, frame) {
      lastFrame = frame; const form = frame.form ?? 'desktop';
      drawWorld(g, s, frame, form, view);
      pickups.draw(g, s, frame, chipFloor(s, form), siteCount(s), form);
    },
    labels: (s, view, frame, out) => chipLabels(s, frame, out, frame.form ?? 'desktop', view),
    drawMini: drawChipMini,
    children: () => 0,
    targets(s, _view, out, from, form: WorldForm = 'desktop') {
      const f = chipFloor(s, form);
      let i = part(s, out, from, 'clock', f.clock);
      i = part(s, out, i, 'cache', f.cache);
      i = s.scheduler ? part(s, out, i, 'queue', f.queue) : slot(s, out, i, 'queue', f.queue, 0);
      // D34: the cores are one component: one 'cores' target over every core and the add site.
      // part: core 0's ref (the system's cores); slot: the add site's index while a core can be added, else null.
      const sites = coreSites(f, siteCount(s));
      if (i < out.length && sites.length) {
        const t = resetHitTarget(out[i++]!, 'cores', 'part', owner(s));
        t.part = partRef(s.systemId, 'core0', s.socket); t.unit = { kind: 'system', id: s.systemId };
        t.slot = sites.length > s.cores.length ? s.cores.length : null; coresBlock(sites, t.rect);
      }
      // The "+" add site: tapping it buys the next core (addPart core on this system, at that index).
      if (i < out.length && sites.length > s.cores.length) {
        const t = resetHitTarget(out[i++]!, 'add:core', 'add', owner(s));
        t.unit = { kind: 'system', id: s.systemId }; t.slot = s.cores.length; copyRect(sites[s.cores.length]!, t.rect);
      }
      // The pipe's drop onto the IN pad: its callout says where the link is upgraded (D15.5).
      if (i < out.length) {
        const t = resetHitTarget(out[i++]!, 'pipe', 'link', owner(s));
        t.unit = { kind: 'system', id: s.systemId }; setRect(t.rect, f.inp.x - 4, f.pkg.y - 16, 8, f.inp.y - f.pkg.y + 18);
      }
      return i;
    },
    // A payout pops only on the selected socket's core. GPU work pops on the System board.
    payoutAnchor(s, c, out, form) {
      if (c.system !== s.systemId || c.core === null || (c.cpu ?? 0) !== s.socket) return -1;
      const f = chipFloor(s, form), sites = coreSites(f, siteCount(s));
      if (c.core >= sites.length) return -1;
      const r = sites[c.core]!;
      copyRect(r, out); return c.core;
    },
    /** Purchase flash (A10): each part's generation and level. */
    partVersion(s, id) {
      if (id === 'clock') return partVersionOf(s.clock);
      if (id === 'cache') return partVersionOf(s.cache);
      if (id === 'queue') return partVersionOf(s.scheduler);
      // a core added (or a core's part changed) flashes the whole block
      if (id === 'cores') return s.cores.length * 1000 + sumVersions(s.cores);
      return null;
    },
    faults(s, out) {
      if (!out.length || (s.online !== 'crashed' && s.online !== 'dark')) return 0;
      copyRect(chipFloor(s, lastFrame?.form).die, out[0]!); return 1;
    },
    icon(g) {
      g.clearRect(0, 0, 16, 16);
      for (let i = 0; i < 4; i++) { R(g, 4 + i * 3, 1, 1, 2, P.pad); R(g, 4 + i * 3, 13, 1, 2, P.pad); R(g, 1, 4 + i * 3, 2, 1, P.pad); R(g, 13, 4 + i * 3, 2, 1, P.pad); }
      R(g, 3, 3, 10, 10, P.ink); R(g, 4, 4, 8, 8, P.logic); R(g, 4, 4, 8, 1, P.logicHi); R(g, 4, 4, 1, 8, P.logicHi);
      R(g, 6, 6, 1, 5, P.op); R(g, 9, 6, 1, 5, P.op); R(g, 5, 5, 6, 1, P.cacheOn);
    }, };
}
