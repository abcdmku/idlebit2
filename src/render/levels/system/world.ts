// System world (mockup v3 levels/system.js draw + core/power.js board PSU). Prices live in the
// callout, tray and plates; the world shows parts and state. While the round is not running there
// is no activity: only the steady PSU meter and the online lamp remain.
import { FAMILIES, POOL_DOMAIN } from '../../../game';
import type { QuoteResult, SystemSnapshot, TaskView } from '../../../game';
import { BG, P, R, darkFx, drawGhost, drawSaveIcon, drawUnitLamp, glowBit, lampState, pathAt, upArrow, upArrowFill } from '../../core';
import type { GhostState, LevelRegistry, Point, Rect, ViewPresentation, WorldFrame } from '../../core';
import { boardStatic } from './board';
import { drawLeaders, firstRow } from './labels';
import { CABLE_X, LAMP, PORT, POWERED, PSU, SAVE, packageRect, siteCentre, siteRect, worldRect } from './layout';
import type { SiteType } from './layout';
import { boardModel, pickedType } from './model';
import type { BoardModel, Site } from './model';
import { drawCable, drawCpuSocket, drawDrivePart, drawEmptySite, drawGpuPart, drawPackageBody, drawPackageFront, drawPort, drawPsu,
  drawRamPart, drawSiteLocked } from './sprites';

type G = CanvasRenderingContext2D;
/** The boot / cold-change drain the lamp shows, at base (Fast boot shortens the real timer). */
export const BOOT_MS = 10_000;
/** A transfer shorter than this shows no travelling packet (D12.4). */
export const MIN_VISIBLE_TRANSFER_S = 0.25;

/** Modes in which the board is powered and can work. */
export function powered(s: SystemSnapshot): boolean {
  return s.online === 'onMarket' || s.online === 'draining' || s.online === 'goingOffline' || s.online === 'asleep';
}
const world: Rect = { x: 0, y: 0, w: 0, h: 0 }, pkg: Rect = { x: 0, y: 0, w: 0, h: 0 }, hit: Rect = { x: 0, y: 0, w: 0, h: 0 };
const at: Point = { x: 0, y: 0 }, c0 = { x: 0, y: 0 }, c1 = { x: 0, y: 0 };
const link: [number, number][] = [[CABLE_X, -2], [CABLE_X, PORT.y - PORT.z], [CABLE_X, 0]];
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
  const transfer = live ? s.chip.pipe.transfer : null;
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
  if (transfer && transfer.bits > 0 && transfer.speed > 0 && transfer.bits / transfer.speed >= MIN_VISIBLE_TRANSFER_S) {
    const sent = transfer.bitsSent + transfer.speed * Math.max(0, frame.timeMs - frame.snapshot.simTimeMs) / 1000;
    link[2][1] = b.sites.cpu[0]!.y + 4;
    pathAt(link, Math.min(1, Math.max(0, sent / transfer.bits)), at);
    glowBit(g, at.x, at.y, transfer.bits, P.bit);
  }
  if (live) for (const t of s.running) drawStageBit(g, m, t);
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
  if (live) for (const t of s.running) { const k = KIND_OF[t.resource]; if (k) stages.add(k); }
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

const KIND_OF: Readonly<Partial<Record<TaskView['resource'], 'ram' | 'gpu' | 'drive'>>> = { ram: 'ram', gpu: 'gpu', io: 'drive' };
const COLOUR: Readonly<Record<'ram' | 'gpu' | 'drive', string>> = { ram: P.ram, gpu: P.gpu, drive: P.stor };
/** A RAM, GPU or IO stage runs out from CPU 1 to the part serving it, at the stage's real progress. */
export function drawStageBit(g: G, m: BoardModel, t: TaskView): void {
  const type = KIND_OF[t.resource];
  if (!type) return;
  const list = m.installed[type];
  if (type === 'gpu') {
    // A linked stage fans out only to GPUs. NPUs never join the GPU pool.
    if (t.accelDomain === POOL_DOMAIN) { for (const p of list) if (p.part?.kind === 'gpu') drawStagePath(g, m, p, t.progress, COLOUR.gpu); return; }
    const site = list.find(p => p.index === t.accelDomain);
    if (!site) return;
    if (site.part?.kind === 'npu' && (!FAMILIES[t.family]?.tensor || t.gpuCoresMin > 0)) return;
    drawStagePath(g, m, site, t.progress, site.part?.kind === 'npu' ? P.rnd : COLOUR.gpu);
    return;
  }
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
