// System world (mockup v3 levels/system.js draw + core/power.js board PSU). Prices live in the
// callout, tray and plates; the world shows parts and state. While the round is not running there
// is no activity: only the steady PSU meter and the online lamp remain.
import type { QuoteResult, SystemSnapshot, TaskView } from '../../../game';
import { BG, P, R, darkFx, drawGhost, drawSaveIcon, drawUnitLamp, glowBit, lampState, pathAt, upArrow, upArrowFill } from '../../core';
import type { GhostState, LevelRegistry, Point, Rect, ViewPresentation, WorldFrame } from '../../core';
import { boardStatic } from './board';
import { drawLeaders, firstRow } from './labels';
import { CABLE_X, LAMP, PORT, POWERED, PSU, SAVE, packageRect, siteCentre, siteRect, worldRect } from './layout';
import type { SiteType } from './layout';
import { boardModel, pickedType } from './model';
import { drawGpuSpill, drawReadLights, drawTiers } from './memory';
import type { BoardModel, Site } from './model';
import { drawGpuPiece, drawInbound, inboundOf } from './shards';
import { drawCable, drawCpuSocket, drawDrivePart, drawEmptySite, drawGpuPart, drawPackageBody, drawPackageFront, drawPort, drawPsu,
  drawRamPart, drawSiteLocked } from './sprites';

type G = CanvasRenderingContext2D;
/** The boot / cold-change drain the lamp shows, at base (Fast boot shortens the real timer). */
export const BOOT_MS = 10_000;

/** Modes in which the board is powered and can work. */
export function powered(s: SystemSnapshot): boolean {
  return s.online === 'onMarket' || s.online === 'draining' || s.online === 'goingOffline' || s.online === 'asleep';
}
const world: Rect = { x: 0, y: 0, w: 0, h: 0 }, pkg: Rect = { x: 0, y: 0, w: 0, h: 0 }, hit: Rect = { x: 0, y: 0, w: 0, h: 0 };
const at: Point = { x: 0, y: 0 }, c0 = { x: 0, y: 0 }, c1 = { x: 0, y: 0 };
const stage: [number, number][] = [[0, 0], [0, 0], [0, 0]];

function quoteState(quotes: QuoteResult | null, type: SiteType): GhostState {
  if (!quotes) return 'open';
  for (const q of quotes.quotes) {
    const a = q.action;
    if ((a.type === 'addPart' && a.kind === type) || (a.type === 'installGpu' && type === 'gpu' && a.index === null)) return q.locked ? 'locked' : q.affordable ? 'picked' : 'open';
  }
  return 'locked';
}
function upgradeFraction(quotes: QuoteResult | null, site: Site, credits: number): number {
  if (!quotes || site.type === 'cpu') return 0;
  for (const q of quotes.quotes) {
    const a = q.action;
    if (a.type !== 'upgradePart' || q.locked || !('index' in a.part.slot) || a.part.slot.kind !== site.type || a.part.slot.index !== site.index) continue;
    const cost = Number(q.cost);
    return q.affordable ? 1 : cost > 0 ? credits / cost : 0;
  }
  return 0;
}

export function drawBoard(g: G, s: SystemSnapshot, view: ViewPresentation, frame: WorldFrame, registry: LevelRegistry): void {
  const m = boardModel(s), b = m.b, live = !frame.paused && powered(s), pick = pickedType(view.picked);
  worldRect(frame.form, world);
  R(g, world.x, world.y, world.w, world.h, BG.system);
  g.drawImage(boardStatic(s.board), 0, 0);
  const transfer = live ? inboundOf(s) : null;
  drawCable(g, CABLE_X, 0, PORT.y - PORT.z + 2, !!transfer);
  const stageOn = activeStages(s, live);
  for (const site of m.sites) {
    if (site.state === 'locked') { drawSiteLocked(g, siteRect(b, site.type, site.index, hit)); continue; }
    if (site.state === 'open') { drawEmptySite(g, b, site.type, site.f); continue; }
    const p = site.part!, on = live && (p.active || p.resourceBusy > 0 || stageOn.has(site.type));
    if (site.type === 'cpu') drawCpu(g, s, site, live, frame, registry);
    else if (site.type === 'ram') drawRamPart(g, b, site.f, p.level, live && p.active);
    else if (site.type === 'gpu') drawGpuPart(g, b, site.f, p.level, live && (p.active || p.resourceBusy > 0), p.kind === 'npu' ? P.rnd : P.gpu);
    else drawDrivePart(g, b, site.f, p.level, on && p.active);
  }
  if (pick) {
    const state = quoteState(view.quotes, pick);
    for (const site of m.sites) if (site.type === pick && site.state === 'open') { siteRect(b, site.type, site.index, hit); drawGhost(g, hit.x, hit.y, hit.w, hit.h, state); }
  }
  drawPort(g, PORT, !!transfer);
  // D25: the port's shard rides in at its real progress, in its task type's colour.
  if (transfer) drawInbound(g, transfer, b, frame);
  // D26: each tier fills its parts (spill hatched), and the tier a shard reads from now shows its light.
  drawTiers(g, s, m, live); drawGpuSpill(g, m, live); drawReadLights(g, s, m, frame.timeMs, live);
  if (live) for (const t of s.running) { drawStageBit(g, m, t); drawGpuPiece(g, m, t); }
  if (live) {
    const credits = Number(frame.snapshot.hud?.credits ?? 0);
    for (const site of m.sites) {
      if (site.state !== 'part') continue;
      const f = upgradeFraction(view.quotes, site, credits);
      if (f <= 0) continue;
      siteRect(b, site.type, site.index, hit);
      if (f >= 1) upArrow(g, hit.x + hit.w - 4, hit.y + 1); else if (f >= 0.5) upArrowFill(g, hit.x + hit.w - 4, hit.y + 1, f);
    }
  }
  if (s.saveable) drawSaveIcon(g, SAVE.x, SAVE.y);
  drawUnitLamp(g, LAMP.x, LAMP.y, LAMP.w, lampState(s.online), (s.timerS ?? 0) * 1000, Math.max(BOOT_MS, (s.timerS ?? 0) * 1000), frame.paused);
  if (s.online === 'offline' || s.online === 'dark' || s.online === 'crashed') darkFx(g, POWERED.x, POWERED.y, POWERED.w, POWERED.h);
  else if (s.psu.capFactor < 0.999) {
    // Real brownout: the board works at capFactor of its rate, so it dims by the missing share.
    const a = g.globalAlpha; g.globalAlpha = a * (1 - Math.max(0, s.psu.capFactor)); R(g, POWERED.x, POWERED.y, POWERED.w, POWERED.h, P.void); g.globalAlpha = a;
  }
  const usage = s.psu.capacityW > 0 ? s.psu.deliveredW / s.psu.capacityW : 0;
  drawPsu(g, PSU, usage, s.psu.failed || s.psu.overloadS > 0 || s.psu.capped);
  // Leaders belong to the labels: desktop only, and like the labels never during a zoom.
  if (frame.form !== 'phone' && !frame.zoom) drawLeaders(g, s, firstRow(frame));
}

const stages = new Set<SiteType>();
function activeStages(s: SystemSnapshot, live: boolean): Set<SiteType> {
  stages.clear();
  if (live) for (const t of s.running) { const k = stageKind(t); if (k) stages.add(k); }
  return stages;
}
function drawCpu(g: G, s: SystemSnapshot, site: Site, live: boolean, frame: WorldFrame, registry: LevelRegistry): void {
  const b = boardModel(s).b;
  drawCpuSocket(g, site.f);
  packageRect(b, site.index, pkg);
  drawPackageBody(g, pkg, live && (s.cpuBusy[site.index] ?? 0) > 0);
  if (registry.has('chip')) registry.level('chip').drawMini(g, s, pkg, frame);
  drawPackageFront(g, pkg);
}

/** The part a stage runs on: a D26 `mem` part on its tier (RAM sticks or drives; cache has none), or the GPU. */
function stageKind(t: TaskView): 'ram' | 'gpu' | 'drive' | undefined {
  if (t.resource === 'gpu') return 'gpu';
  if (t.resource !== 'mem') return undefined;
  return t.memTier === 'ram' ? 'ram' : t.memTier === 'disk' ? 'drive' : undefined;
}
const COLOUR: Readonly<Record<'ram' | 'drive', string>> = { ram: P.ram, drive: P.stor };
/**
 * A RAM or IO stage runs out from CPU 1 to the part serving it, at the stage's real progress. A GPU
 * stage is drawn as the shard's piece on its card instead (shards.ts `drawGpuPiece`).
 */
export function drawStageBit(g: G, m: BoardModel, t: TaskView): void {
  const type = stageKind(t);
  if (!type || type === 'gpu') return;
  const list = m.installed[type];
  let site: Site | null = null;
  for (const p of list) if (!site || p.part?.active) site = p;
  if (site) drawStagePath(g, m, site, t.progress, COLOUR[type]);
}
function drawStagePath(g: G, m: BoardModel, site: Site, progress: number, colour: string): void {
  siteCentre(m.b, 'cpu', 0, c0); siteCentre(m.b, site.type, site.index, c1);
  stage[0][0] = c0.x; stage[0][1] = c0.y; stage[1][0] = c1.x; stage[1][1] = c0.y; stage[2][0] = c1.x; stage[2][1] = c1.y;
  pathAt(stage, progress, at);
  glowBit(g, at.x, at.y, 16, colour, undefined);
}
