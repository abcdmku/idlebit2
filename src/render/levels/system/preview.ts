// Dev preview of the chip and system levels through R1's canvas renderer, framed like the
// mockup's phone and landscape layouts. Open
// /src/render/levels/system/preview.html?scene=system&shape=phone
// Scenes: boot, chip, chip-paused, system, system-full, system-paused, zoom (chip → system, held).
import type { LevelSnapshot, QuoteResult, RenderSnapshot } from '../../../game';
import { DESKTOP_FRAMING, PHONE_FRAMING, createCanvasRenderer, createLevelRegistry, rect } from '../../core';
import type { Rect, ViewPresentation } from '../../core';
import { createChipRenderer } from '../chip';
import { createSystemRenderer } from '.';
import { chipScene, systemScene, upgradeQuote } from './scenes';

const params = new URLSearchParams(location.search);
const scene = params.get('scene') ?? 'system', shape = params.get('shape') ?? 'phone';
const registry = createLevelRegistry();
registry.register(createChipRenderer(registry)); registry.register(createSystemRenderer(registry));
const root = document.querySelector('#root')!, canvas = root.querySelector('canvas')!;
const renderer = createCanvasRenderer(canvas, registry);

// L2 world viewports: desktop 1392 x 648 at N = 3, phone 368 x 600 at N = 2, the band over the top.
const W = innerWidth, Hh = innerHeight, desk = shape === 'land' || shape === 'desktop';
const viewport: Rect = desk ? rect(24, 24, W - 48, Math.min(648, Hh - 48)) : rect(8, 8, Math.min(368, W - 16), 600);
const framing = desk ? DESKTOP_FRAMING : PHONE_FRAMING;
function panel(x: number, y: number, w: number, h: number): void {
  const d = document.createElement('div'); d.className = 'panel';
  Object.assign(d.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` }); root.append(d);
}
panel(viewport.x, viewport.y, viewport.w, framing.top);

const paused = scene.endsWith('paused');
const quotes: QuoteResult = { configRevision: 1, quotes: scene.startsWith('system')
  ? [upgradeQuote({ kind: 'drive', index: 0 }, true)]
  : [upgradeQuote({ kind: 'clock', socket: 0 }, true), upgradeQuote({ kind: 'core', socket: 0, index: 0 }, scene !== 'boot')] };
const view: ViewPresentation = { selectedId: null, picked: null, quotes, reducedMotion: false };
function focusOf(): { focus: LevelSnapshot; partner: LevelSnapshot | null } {
  if (scene === 'boot') return { focus: chipScene('boot'), partner: null };
  if (scene.startsWith('chip')) return { focus: chipScene('chip'), partner: null };
  if (scene === 'system-full') return { focus: systemScene('full'), partner: null };
  if (scene === 'zoom') return { focus: systemScene('system'), partner: chipScene('system') };
  return { focus: systemScene('system'), partner: null };
}
let simTimeMs = 0, published = performance.now(), first = true;
function snapshot(): RenderSnapshot {
  const { focus, partner } = focusOf(), state = paused ? 'between' : 'running';
  return {
    epoch: 1, tick: Math.floor(simTimeMs / 100), simTimeMs, focus, partner: first ? null : partner, events: [], firstSeq: 0, lastSeq: 0,
    hud: { credits: '1495', data: '128', netPerMinute: '889', sla: { met: 1, failed: 0, percent: 100 }, roundState: state, roundIndex: 1, roundElapsedMs: 0, autoReturnInMs: null },
    round: { index: 1, state, lastReport: null, canReturn: paused, autoReturn: { available: false, on: false, inMs: null } },
    research: { active: null, name: null, progress: 0.4, mode: 'shared', stoppedInsolvent: false, needsData: false, queued: 0, opsPerSec: 0 },
  } as unknown as RenderSnapshot;
}
renderer.resize(W, Hh, devicePixelRatio || 1, viewport, framing);
if (scene === 'zoom') renderer.hold(0.5);
setInterval(() => { if (!paused) { simTimeMs += 100; published = performance.now(); } }, 100);
function frame(now: number): void {
  if (scene === 'zoom' && first) {
    // Rest on the chip first so the next focus change is a zoom out with the chip as partner.
    renderer.draw({ ...snapshot(), focus: chipScene('system') } as RenderSnapshot, view, { nowS: now / 1000, sincePublishMs: 0 });
    first = false;
  } else { first = false; renderer.draw(snapshot(), view, { nowS: now / 1000, sincePublishMs: now - published }); }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
const bridge = { bootStatus: 'ready', bootError: null, ready: () => Promise.resolve(true), renderer };

Object.assign(window, { __br: bridge });
