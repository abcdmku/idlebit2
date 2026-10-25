// System level: the original motherboard (mockup v3 levels/system.js, D15.2), whole and on its own.
// Tap a part to select it (the UI opens its upgrade callout); a CPU target also carries `drill`, so
// a second tap or Open dives into the socket. The PSU is a fixed board part; nothing on a board cools.
import type { SystemSnapshot } from '../../../game';
import { P, R, copyRect, resetHitTarget, setRect } from '../../core';
import type { HitTarget, LevelRegistry, LevelRenderer, Rect } from '../../core';
import { writeLabels } from './labels';
import { CABLE_X, FOCUS, PORT, PSU, SAVE, WORLD, packageRect, siteRect, worldRect } from './layout';
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
const pkg: Rect = { x: 0, y: 0, w: 0, h: 0 };

function unitTarget(s: SystemSnapshot, out: HitTarget[], i: number, id: string, kind: 'unit' | 'link', r: Rect): number {
  if (i >= out.length) return i;
  const t = resetHitTarget(out[i]!, id, kind, owner(s));
  t.unit = { kind: 'system', id: s.systemId }; copyRect(r, t.rect);
  return i + 1;
}
const NAME: Rect = { x: 56, y: 28, w: 36, h: 8 };
const PORT_RECT: Rect = { x: PORT.x, y: PORT.y - PORT.z, w: PORT.w, h: PORT.h + PORT.z };

export function createSystemRenderer(registry: LevelRegistry): LevelRenderer<'system'> {
  return {
    id: 'system', name: 'System',
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
      // The board name and lamp open the system's own plate; the port is the pipe (fixed until the Rack switch).
      let i = unitTarget(s, out, from, 'unit', 'unit', NAME);
      i = unitTarget(s, out, i, 'pipe', 'link', PORT_RECT);
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
        t.part = boardPartRef(s.systemId, 'psu'); setRect(t.rect, PSU.x - 2, PSU.y - 7, PSU.w + 4, PSU.h + 9);
      }
      if (s.saveable && i < out.length) {
        const t = resetHitTarget(out[i++]!, 'save', 'save', owner(s));
        t.unit = { kind: 'system', id: s.systemId }; setRect(t.rect, SAVE.x, SAVE.y, 7, 7);
      }
      return i;
    },
    labels: (s, _view, frame, out) => writeLabels(s, frame, out),
    unitAnchor(s, id, out) {
      if (id !== s.systemId) return false;
      packageRect(boardModel(s).b, 0, pkg);
      setRect(out, pkg.x + pkg.w - 10, pkg.y + 2, 8, 8); return true;
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
