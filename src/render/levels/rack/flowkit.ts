// D25 pieces the rack, room and world levels share on top of core/flows.ts: task grouping
// without allocation, and router-queue wells laid out as a grid that fits a fixed slot.
import { P, R, flowColor, mix } from '../../core';
import type { FlowView } from '../../core';
import type { LbView } from '../../../game';
type LbQueueView = LbView['queue'];

/** True when flows[i] is the first flow of its task, so a caller visits each task once. No allocation. */
export function firstOfTask(flows: readonly FlowView[], i: number): boolean {
  const id = flows[i]!.taskId;
  for (let j = 0; j < i; j++) if (flows[j]!.taskId === id) return false;
  return true;
}
/** A split task's shards count; an unsplit task (or a pre-D25 transfer) is 1. */
export const shardsOf = (f: FlowView): number => f.shards ?? 1;

/** The well grid for `n` wells in a w × h box: columns, rows, cell size and gaps. */
export interface WellGrid { cols: number; rows: number; cw: number; ch: number; gx: number; gy: number }
const grid: WellGrid = { cols: 1, rows: 1, cw: 1, ch: 1, gx: 0, gy: 0 };
/** The largest well drawn: a few slots stay wells, not one block. */
export const WELL_MAX = { w: 3, h: 4 } as const;
/**
 * The wells that read best: try each row count with 1 px gaps where they fit. Rows kept apart
 * come first (a crowded queue then reads as rows filling left to right), then columns kept apart,
 * then the larger cell (capped at WELL_MAX). Fills and returns a shared grid.
 */
export function wellGrid(n: number, w: number, h: number): WellGrid {
  let best = -1;
  for (let rows = 1; rows <= Math.min(n, h); rows++) {
    const cols = Math.ceil(n / rows), gx = cols * 2 - 1 <= w ? 1 : 0, gy = rows > 1 && rows * 2 - 1 <= h ? 1 : 0;
    const cw = Math.min(WELL_MAX.w, Math.floor((w - (cols - 1) * gx) / cols)), ch = Math.min(WELL_MAX.h, Math.floor((h - (rows - 1) * gy) / rows));
    if (cw < 1 || ch < 1) continue;
    const apart = (gy || rows === 1 ? 2 : 0) + (gx || cols === 1 ? 1 : 0), score = apart * 100 + cw * ch;
    if (score > best) { best = score; grid.cols = cols; grid.rows = rows; grid.cw = cw; grid.ch = ch; grid.gx = gx; grid.gy = gy; }
  }
  if (best < 0) { grid.cols = n; grid.rows = 1; grid.cw = 1; grid.ch = 1; grid.gx = 0; grid.gy = 0; }
  return grid;
}
export const WELL_EMPTY = mix(P.logicLo, P.ink, 0.45);
/**
 * A router queue (D25.7) in a fixed box: `slots` wells (1–32) in a grid, row-major, the oldest
 * entry first, each queued entry in its task colour, empty wells dark. While `live` is false
 * (dark or paused) every well is drawn empty. Returns the number of wells drawn.
 */
export function drawWells(g: CanvasRenderingContext2D, q: LbQueueView | null, x: number, y: number, w: number, h: number, live: boolean): number {
  if (!q) return 0;
  const n = Math.max(1, Math.min(32, q.slots)), l = wellGrid(n, w, h);
  const gw = l.cols * l.cw + (l.cols - 1) * l.gx, gh = l.rows * l.ch + (l.rows - 1) * l.gy;
  const x0 = x + ((w - gw) >> 1), y0 = y + ((h - gh) >> 1);
  for (let i = 0; i < n; i++) {
    const c = i % l.cols, r = (i / l.cols) | 0, e = live ? q.entries[i] : undefined;
    R(g, x0 + c * (l.cw + l.gx), y0 + r * (l.ch + l.gy), l.cw, l.ch, e ? flowColor(e) : WELL_EMPTY);
  }
  return n;
}
