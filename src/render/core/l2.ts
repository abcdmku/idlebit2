// Renderer harness (dev and QA only) in the L2 D17 frame: the real levels over the sim's view
// fixtures, at N with the lattice, the band, the queue strip and the core's pipe. Chrome is inert.
// http://127.0.0.1:6174/src/render/core/l2.html?form=desktop|phone&level=chip|system|rack|room|global
//   &zoom=<from level>&hold=<0..1>  hold a zoom from that level into or out of `level`
//   &scene=boot|landing|mid|max|paused  swap the CPU snapshot for a renderer QA scene
import { fixtureSnapshot, fixtureState } from '../../game/fixtures';
import { deriveRenderSnapshot } from '../../game';
import type { FixtureName } from '../../game/fixtures';
import type { LevelId, LevelSnapshot, NodeRef, RenderSnapshot } from '../../game';
import { DESKTOP_FRAMING, PHONE_FRAMING } from './camera';
import type { RestFraming } from './camera';
import { rect } from './geom';
import { createLevelRegistry, depth } from './registry';
import { registerLevels } from '../levels';
import { chipScene } from '../levels/chip/scenes';
import type { CpuScene } from '../levels/chip/scenes';
import { createCanvasRenderer } from './view';
import { loadCanvasFont } from './fonts';
import type { ViewPresentation } from './types';
import { refOf } from './types';

const q = new URLSearchParams(location.search);
const phone = q.get('form') === 'phone', level = (q.get('level') ?? 'chip') as LevelId;
const from = q.get('zoom') as LevelId | null, hold = q.has('hold') ? Number(q.get('hold')) : null, scene = q.get('scene') as CpuScene | null;
// L2 layout.js, D17: stage, world viewport, band, strip, pipe source and run, deck.
const W = phone ? 384 : 1440, H = phone ? 776 : 888;
const vp = phone ? rect(8, 8, 368, 600) : rect(24, 24, 1392, 648);
const framing: RestFraming = phone
  ? { ...PHONE_FRAMING, pipe: { x: 32, y: 136, runY: 144 } } : { ...DESKTOP_FRAMING, pipe: { x: 72, y: 120, runY: 144 } };
const root = document.querySelector<HTMLElement>('#root')!, canvas = root.querySelector('canvas')!;
root.style.width = `${W}px`; root.style.height = `${H}px`;
// The live alignment audit (scripts/qa/audit-live.mjs) reads N and the lattice from the stage.
root.dataset.n = String(framing.scale); root.dataset.lat = String(framing.lattice);
function chrome(cls: string, x: number, y: number, w: number, h: number, text: string): void {
  const el = document.createElement('div'); el.className = `chrome ${cls}`; el.textContent = text;
  Object.assign(el.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` }); root.append(el);
}
chrome('band', vp.x, vp.y, vp.w, phone ? 64 : 48, 'HUD band (U)');
chrome('strip', vp.x, phone ? 72 : 72, vp.w, phone ? 64 : 48, 'Queue strip (U)');
chrome('deck', vp.x, vp.y + vp.h + (phone ? 8 : 24), vp.w, H - vp.y - vp.h - (phone ? 16 : 48), 'Deck (U)');

const boot = q.has('boot');
const NAME: Record<LevelId, FixtureName> = { chip: boot ? 'chipBoot' : 'chipTop', system: boot ? 'systemBoot' : 'systemTop', rack: 'rack', room: 'room', global: 'global' };
function withScene(s: RenderSnapshot): RenderSnapshot {
  if (!scene) return s;
  const swap = <T extends RenderSnapshot['focus'] | null>(l: T) => (l?.level === 'chip' ? { ...chipScene(scene), systemId: l.systemId, parent: l.parent } : l);
  return { ...s, focus: swap(s.focus)!, partner: swap(s.partner), round: scene === 'paused' ? { ...s.round, state: 'between' } : s.round };
}
// A zoom between `from` and `level` comes from the parent level's own fixture state: its first
// built child is the focus and the parent is the partner, so every pair works in both directions.
const deeper = from && depth(from) < depth(level) ? from : level;
function childOf(p: LevelSnapshot): NodeRef | null {
  switch (p.level) {
    case 'system': return { level: 'chip', id: p.systemId };
    case 'rack': { const s = p.servers.find(v => v.systemId !== null); return s ? { level: 'system', id: s.systemId! } : null; }
    case 'room': { const r = p.racks.find(v => v.rackId !== null); return r ? { level: 'rack', id: r.rackId! } : null; }
    case 'global':
      for (const site of p.sites) for (const z of site.zones) if (z.roomId !== null) return { level: 'room', id: z.roomId };
      return null;
    default: return null;
  }
}
function zoomPair(parentLevel: LevelId): RenderSnapshot {
  const name = NAME[parentLevel], parent = fixtureSnapshot(name).focus, child = childOf(parent);
  if (!child) throw new Error(`The ${name} fixture has no built child to zoom into`);
  return deriveRenderSnapshot(fixtureState(name), { focus: child, partner: refOf(parent) });
}
const pair = withScene(from ? zoomPair(depth(from) > depth(level) ? from : level) : fixtureSnapshot(NAME[level]));
const target: RenderSnapshot = !from ? pair : deeper === level ? pair : { ...pair, focus: pair.partner!, partner: pair.focus };
const start: RenderSnapshot = { ...target, focus: target.partner ?? target.focus, partner: null };

const registry = createLevelRegistry();
await registerLevels(registry);
// The renderer draws nothing until Chakra Petch is in; wait so the zoom's first frame is real.
await loadCanvasFont(document);
const renderer = createCanvasRenderer(canvas, registry);
await loadCanvasFont(document);
renderer.resize(W, H, window.devicePixelRatio || 1, vp, framing);
const view: ViewPresentation = { selectedId: q.get('sel'), picked: null, quotes: null, reducedMotion: false };
let t = 0, current = from ? start : target;
function frame(now: number): void {
  t = now / 1000;
  renderer.draw(current, view, { nowS: t, sincePublishMs: 0 });
  requestAnimationFrame(frame);
}
renderer.draw(current, view, { nowS: 0, sincePublishMs: 0 });
if (from) { if (hold !== null) renderer.hold(hold); current = target; }
requestAnimationFrame(frame);
const api = { bootStatus: 'ready', bootError: null, ready: () => Promise.resolve(true), renderer, hold: (p: number | null) => renderer.hold(p) };
// The capture script's bridge (scripts/qa/capture.mjs): boot status and ready().
Object.assign(window, { __br: api });
