// DEV-only: the rack, room and global level CASES (each level's fixtures.ts) in the L2 D17 frame,
// so renderer-only states the sim fixtures don't carry yet (D25 flows, LB queues) can be captured.
// /src/render/levels/rack/l2cases.html?form=desktop|phone&level=rack|room|global&case=<name>&t=<ms>
// Same chrome and framing as core/l2.html; exposes the capture bridge (window.__br).
import { DESKTOP_FRAMING, PHONE_FRAMING } from '../../core/camera';
import type { RestFraming } from '../../core/camera';
import { createCanvasRenderer, rect } from '../../core';
import type { LevelSnapshot, ViewPresentation } from '../../core';
import { fixtureSnapshot } from '../../core/fixtureLevels';
import { loadCanvasFont } from '../../core/fonts';
import { createGameRegistry } from '..';

type Cases = Readonly<Record<string, (timeMs: number) => LevelSnapshot>>;
const found = import.meta.glob<{ CASES: Cases }>('../*/fixtures.ts', { eager: true });
const all: Record<string, Cases> = {};
for (const [path, module] of Object.entries(found)) all[path.startsWith('./') ? 'rack' : path.split('/')[1]] = module.CASES;

const q = new URLSearchParams(location.search);
const phone = q.get('form') === 'phone', level = q.get('level') ?? 'rack', cases = all[level] ?? {};
const make = cases[q.get('case') ?? 'flows'] ?? Object.values(cases)[0], ok = Object.keys(cases).length > 0;
const W = phone ? 384 : 1440, H = phone ? 780 : 900;
const vp = phone ? rect(8, 8, 368, 692) : rect(24, 24, 1392, 708);
const framing: RestFraming = phone
  ? { ...PHONE_FRAMING, pipe: { x: 32, y: 200, runY: 208 } } : { ...DESKTOP_FRAMING, pipe: { x: 72, y: 168, runY: 192 } };
const root = document.querySelector<HTMLElement>('#root')!, canvas = root.querySelector('canvas')!;
root.style.width = `${W}px`; root.style.height = `${H}px`;
function chrome(cls: string, x: number, y: number, w: number, h: number, text: string): void {
  const el = document.createElement('div'); el.className = `chrome ${cls}`; el.textContent = text;
  Object.assign(el.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` }); root.append(el);
}
chrome('band', vp.x, vp.y, vp.w, phone ? 80 : 48, 'HUD band (U)');
chrome('strip', vp.x, phone ? 88 : 72, vp.w, phone ? 112 : 96, 'Queue strip (U)');
chrome('deck', vp.x, vp.y + vp.h + (phone ? 8 : 24), vp.w, H - vp.y - vp.h - (phone ? 16 : 48), 'Deck (U)');
if (!phone) chrome('dock', vp.x + vp.w - 312, 168 + 24, 288, 144, 'Callout dock (U)');

await loadCanvasFont(document);
const registry = await createGameRegistry(), renderer = createCanvasRenderer(canvas, registry);
renderer.resize(W, H, window.devicePixelRatio || 1, vp, framing);
const view: ViewPresentation = { selectedId: q.get('sel'), picked: null, quotes: null, reducedMotion: false };
const fixedT = q.get('t'), paused = q.has('paused');
function frame(now: number): void {
  if (!ok) return;
  const t = fixedT !== null ? Number(fixedT) : 5_000 + now;
  renderer.draw(fixtureSnapshot(make(t), null, { simTimeMs: t, round: paused ? 'between' : 'running' }), view, { nowS: now / 1000, sincePublishMs: 0 });
  requestAnimationFrame(frame);
}
frame(0);
const api = { bootStatus: ok ? 'ready' : 'error', bootError: ok ? null : `no case for ${level}`, ready: () => Promise.resolve(true), renderer };
Object.assign(window, { __br: api });
