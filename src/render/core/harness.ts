// Renderer harness (dev only): every registered level over LEVEL_FIXTURES, zooms between
// adjacent levels with a partner, tap to drill. Missing chip/system levels use fixture boxes.
// Open http://127.0.0.1:6174/src/render/core/harness.html
import { LEVEL_FIXTURES } from '../../game/fixtures';
import type { LevelId, LevelSnapshot } from '../../game';
import { createLevelRegistry, ORDER } from './registry';
import { registerLevels } from '../levels';
import { createFixtureLevels, fixtureSnapshot } from './fixtureLevels';
import { createCanvasRenderer } from './view';
import { rect } from './geom';
import type { ViewPresentation } from './types';

const canvas = document.querySelector('canvas')!, status = document.querySelector('#status')!;
const registry = createLevelRegistry();
await registerLevels(registry);
for (const level of createFixtureLevels(registry)) if (!registry.has(level.id)) registry.register(level);
const renderer = createCanvasRenderer(canvas, registry);
let view: ViewPresentation = { selectedId: null, picked: null, quotes: null, reducedMotion: false };
let focus: LevelSnapshot = LEVEL_FIXTURES.system, partner: LevelSnapshot | null = null, round: 'running' | 'between' = 'running';
let published = performance.now(), simTimeMs = 0;

function go(level: LevelId): void {
  if (!registry.has(level) || level === focus.level) return;
  partner = focus; focus = LEVEL_FIXTURES[level];
}
const bar = document.querySelector('#levels')!;
for (const id of ORDER) {
  const button = document.createElement('button'); button.textContent = id; button.disabled = !registry.has(id);
  button.addEventListener('click', () => go(id)); bar.append(button);
}
document.querySelector('#motion')!.addEventListener('click', () => { view = { ...view, reducedMotion: !view.reducedMotion }; });
document.querySelector('#round')!.addEventListener('click', () => { round = round === 'running' ? 'between' : 'running'; });
document.querySelector('#hold')!.addEventListener('input', e => renderer.hold(Number((e.target as HTMLInputElement).value)));
document.querySelector('#release')!.addEventListener('click', () => renderer.hold(null));
canvas.addEventListener('pointerup', e => {
  const r = canvas.getBoundingClientRect(), t = renderer.hit(e.clientX - r.left, e.clientY - r.top);
  status.textContent = t ? `${t.kind} ${t.id}` : 'no target';
  if (t?.drill) go(t.drill.level); else view = { ...view, selectedId: t?.id ?? null };
});
function resize(): void { renderer.resize(390, 780, window.devicePixelRatio || 1, rect(0, 138, 390, 492)); }
window.addEventListener('resize', resize); resize();
// Stand-in for the store: sim time advances at 10 Hz publishes while the round runs.
setInterval(() => { if (round === 'running') { simTimeMs += 100; published = performance.now(); } }, 100);
let raf = 0;
function frame(now: number): void {
  const snapshot = fixtureSnapshot(focus, partner, { simTimeMs, round });
  renderer.draw(snapshot, view, { nowS: now / 1000, sincePublishMs: now - published });
  if (!renderer.transition) partner = null;
  raf = requestAnimationFrame(frame);
}
raf = requestAnimationFrame(frame);
const api = { renderer, go, hold: (p: number | null) => renderer.hold(p) };
declare global { interface Window { __r1: typeof api } }
window.__r1 = api;
window.addEventListener('pagehide', () => { cancelAnimationFrame(raf); renderer.dispose(); }, { once: true });
