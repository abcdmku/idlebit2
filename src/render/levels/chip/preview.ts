// Dev-only snapshot preview. No mockup simulation is imported.
import type { RenderSnapshot } from '../../../game';
import { createCanvasRenderer, createLevelRegistry, rect } from '../../core';
import type { ViewPresentation } from '../../core';
import { createChipRenderer } from '.';
import { chipScene } from './scenes';
import type { CpuScene } from './scenes';

const params = new URLSearchParams(location.search), scene = (params.get('scene') ?? 'boot') as CpuScene;
const land = params.get('shape') === 'land', paused = scene === 'paused';
const registry = createLevelRegistry(); registry.register(createChipRenderer(registry));
const root = document.querySelector('#root')!, canvas = root.querySelector('canvas')!;
const renderer = createCanvasRenderer(canvas, registry), chip = chipScene(scene);
const w = innerWidth, h = innerHeight;
const viewport = land ? rect(236, 6, 386, 398) : rect(0, 138, w, 492);
function panel(x: number, y: number, width: number, height: number, text = ''): void {
  const p = document.createElement('div'); p.className = 'panel'; p.textContent = text;
  Object.assign(p.style, { left: x + 'px', top: y + 'px', width: width + 'px', height: height + 'px' }); root.append(p);
}
if (land) { panel(0, 0, 236, h, 'CPU / ' + scene); panel(622, 0, w - 622, h); }
else { panel(0, 0, w, 138, 'CPU / ' + scene); panel(0, 630, w, h - 630); }
const view: ViewPresentation = { selectedId: null, picked: null, quotes: null, reducedMotion: false };
let timeMs = 2000;
function snapshot(): RenderSnapshot {
  return { epoch: 1, tick: Math.floor(timeMs / 100), simTimeMs: timeMs, focus: chip, partner: null, events: [], firstSeq: 0, lastSeq: 0,
    round: { state: paused ? 'between' : 'running' }, research: { progress: 0.4 },
  } as unknown as RenderSnapshot;
}
renderer.resize(w, h, devicePixelRatio || 1, viewport);
function draw(): void { renderer.draw(snapshot(), view, { nowS: timeMs / 1000, sincePublishMs: 0 }); }
draw();
const mini = document.createElement('canvas'); mini.width = 96; mini.height = 96;
mini.style.cssText = 'position:absolute;left:12px;top:30px;width:96px;height:96px;image-rendering:pixelated';
root.append(mini);
const miniContext = mini.getContext('2d')!;
registry.level('chip').drawMini(miniContext, { chip, systemId: chip.systemId } as Parameters<ReturnType<typeof createChipRenderer>['drawMini']>[1],
  rect(8, 8, 80, 80), { snapshot: snapshot(), timeMs, paused, reducedMotion: false, zoom: null });
Object.assign(window, { __br: { bootStatus: 'ready', bootError: null, ready: () => Promise.resolve(true), renderer,
  setTime(ms: number) { timeMs = ms; draw(); },
} });
