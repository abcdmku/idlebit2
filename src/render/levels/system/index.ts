// System level: the original motherboard (mockup v3 levels/system.js, D15.2), whole and on its own.
// Tap a part to select it (the UI opens its upgrade callout); a CPU target also carries `drill`, so
// a second tap or Open dives into the socket. The PSU is a fixed board part; nothing on a board cools.
import type { SystemSnapshot } from '../../../game';
import { P, R, copyRect, partVersionOf, resetHitTarget, setRect } from '../../core';
import type { HitTarget, LevelRegistry, LevelRenderer, Rect } from '../../core';
import { writeLabels } from './labels';
import { CABLE_X, FOCUS, PSU, PSU_TILE, SAVE, WORLD, packageRect, siteRect, worldRect } from './layout';
import { boardModel, boardPartRef, slotOf } from './model';
import { drawSystemMini } from './mini';
import { drawBoard } from './world';

const owner = (s: SystemSnapshot) => ({ level: 'system', id: s.systemId }) as const;
const chipRefs = new Map<number, { readonly level: 'chip'; readonly id: SystemSnapshot['systemId'] }>();
function chipRef(s: SystemSnapshot) {
  let ref = chipRefs.get(s.systemId);
  if (!ref) { ref = { level: 'chip', id: s.systemId }; chipRefs.set(s.systemId, ref); }
  return ref;
}
const CPU_IDS = ['cpu0', 'cpu1', 'cpu2', 'cpu3'];
/** Pop keys: CPU k is k (at most 4 sockets), GPU slot g is GPU_KEY + g. */
const GPU_KEY = 8;

function unitTarget(s: SystemSnapshot, out: HitTarget[], i: number, id: string, kind: 'unit' | 'link', r: Rect): number {
  if (i >= out.length) return i;
  const t = resetHitTarget(out[i]!, id, kind, owner(s));
  t.unit = { kind: 'system', id: s.systemId }; copyRect(r, t.rect);
  return i + 1;
}
const NAME: Rect = { x: 56, y: 28, w: 36, h: 8 };

export function createSystemRenderer(registry: LevelRegistry): LevelRenderer<'system'> {
  return {
    id: 'system', name: 'System',
    /** Shown whole, never panned (D15.2). */
    wholeAtRest: true,
    size: (_s, out, form) => worldRect(form, out),
    focus: (_s, _vp, out) => copyRect(FOCUS, out),
    miniRect: (_s, out) => copyRect(WORLD, out),
    entry: (_s, out) => { out.x = CABLE_X; out.y = 0; return out; },
    draw: (g, s, view, frame) => drawBoard(g, s, view, frame, registry),
    drawMini: drawSystemMini,
    children(s, out) {
      const c = out[0]!;
      c.ref = chipRef(s); packageRect(boardModel(s).b, 0, c.rect);
      return 1;
    },
    targets(s, _view, out, from) {
      const m = boardModel(s), b = m.b;
      // The board name and lamp open the system's own plate. D35: no port target; the pipe's tag is its speed.
      let i = unitTarget(s, out, from, 'unit', 'unit', NAME);
      for (const site of m.sites) {
        if (site.state === 'part' || i >= out.length) continue;
        const v = slotOf(s, site);
        if (!v) continue;
        const t = resetHitTarget(out[i++]!, `slot-${site.type}${site.index}`, 'slot', owner(s));
        t.slot = v.index; t.unit = { kind: 'system', id: s.systemId }; siteRect(b, site.type, site.index, t.rect);
      }
      for (const site of m.sites) {
        if (site.state !== 'part' || i >= out.length) continue;
        if (site.type === 'cpu') {
          // Same rect as the core's child target, and in front of it: the first tap selects, Open drills.
          const t = resetHitTarget(out[i++]!, CPU_IDS[site.index]!, 'part', owner(s));
          t.part = boardPartRef(s.systemId, 'cpu', site.index); t.drill = chipRef(s); packageRect(b, site.index, t.rect);
          continue;
        }
        const p = site.part!;
        const t = resetHitTarget(out[i++]!, `${site.type}${p.slot}`, 'part', owner(s));
        t.part = boardPartRef(s.systemId, site.type, p.slot); siteRect(b, site.type, site.index, t.rect);
      }
      if (i < out.length) {
        const t = resetHitTarget(out[i++]!, 'psu', 'part', owner(s));
        t.part = boardPartRef(s.systemId, 'psu'); copyRect(PSU_TILE, t.rect);
      }
      if (s.saveable && i < out.length) {
        const t = resetHitTarget(out[i++]!, 'save', 'save', owner(s));
        t.unit = { kind: 'system', id: s.systemId }; setRect(t.rect, SAVE.x, SAVE.y, 7, 7);
      }
      return i;
    },
    labels: (s, _view, frame, out) => writeLabels(s, frame, out),
    // A payout pops on the part that ran it: the GPU card (key 8 + slot) or the CPU package (key k).
    payoutAnchor(s, c, out) {
      if (c.system !== s.systemId) return -1;
      const m = boardModel(s);
      if (c.gpu !== null) {
        for (const site of m.installed.gpu) if (site.part!.slot === c.gpu) { siteRect(m.b, 'gpu', site.index, out); return GPU_KEY + c.gpu; }
        return -1;
      }
      const k = c.cpu ?? 0;
      if (k >= m.installed.cpu.length) return -1;
      packageRect(m.b, k, out); return k;
    },
    /** Purchase flash (A10): the part on each site, by its generation and level. */
    partVersion(s, id) {
      if (id === 'psu') return partVersionOf(s.psu);
      if (id.startsWith('cpu')) return Number(id.slice(3)) < s.cpuCount ? partVersionOf(s.cpu) : null;
      const list = id.startsWith('ram') ? s.ram : id.startsWith('gpu') ? s.gpu : id.startsWith('drive') ? s.storage : null;
      if (!list) return null;
      const slot = Number(id.replace(/^D+/, ''));
      for (const p of list) if (p.slot === slot) return partVersionOf(p);
      return null;
    },
    faults(s, out) {
      let n = 0;
      if (s.online === 'crashed' && n < out.length) packageRect(boardModel(s).b, 0, out[n++]!);
      if (s.psu.failed && n < out.length) setRect(out[n++]!, PSU.x, PSU.y - 5, PSU.w, PSU.h);
      return n;
    },
    icon(g) {
      g.clearRect(0, 0, 16, 16);
      R(g, 1, 3, 14, 11, P.ink); R(g, 2, 4, 12, 8, P.mask); R(g, 2, 4, 12, 1, P.maskHi); R(g, 2, 12, 12, 1, '#1f1848');
      R(g, 4, 5, 6, 6, P.ink); R(g, 5, 6, 4, 4, '#2b2550'); R(g, 6, 7, 2, 2, P.logicHi); R(g, 11, 5, 2, 6, P.ram); R(g, 4, 11, 1, 1, P.pad);
    },
  };
}
