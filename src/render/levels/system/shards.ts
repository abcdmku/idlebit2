// D25 on the board: one shard enters on the port and runs as pieces on the board's parts. The
// port's shard (`SystemSnapshot.inbound`, before Rack the pipe's transfer) rides the cable and the
// trace into CPU 1 at its real progress. At the CPU its threads light as lanes on the package mini
// (the chip level draws them); a GPU-stage shard lights a piece on the card(s) of its domain. Every
// piece is the shard's remaining work in its task type's colour, so it empties as the shard runs.
import { FAMILIES, POOL_DOMAIN } from '../../../game';
import type { SystemSnapshot, TaskView, TransferView } from '../../../game';
import { drawFlow, flowColor } from '../../core';
import type { FlowPhase, WorldFrame } from '../../core';
import { drawPiece, remaining } from '../chip/shards';
import { CABLE_X, PORT } from './layout';
import type { BoardLayout } from './layout';
import type { BoardModel, Site } from './model';

type G = CanvasRenderingContext2D;

/** The shard on the system's port: its own inbound transfer, else (before Rack) the pipe's. */
export const inboundOf = (s: SystemSnapshot): TransferView | null => s.inbound ?? s.chip.pipe.transfer;

const link: [number, number][] = [[CABLE_X, -2], [CABLE_X, PORT.y - PORT.z], [CABLE_X, 0]];
/** Draw the port's shard down the cable into CPU 1 (a short one is a landing flash). */
export function drawInbound(g: G, t: TransferView, b: BoardLayout, frame: WorldFrame): FlowPhase {
  link[2][1] = b.sites.cpu[0]!.y + 4;
  return drawFlow(g, t, link, frame.snapshot, frame.timeMs);
}

const cards: Site[] = [];
/**
 * The card(s) serving a GPU-stage shard, by its lifetime domain: one card, or every GPU (never an
 * NPU) for the linked pool. An NPU only serves tensor work without a GPU-core minimum.
 */
export function servingCards(m: BoardModel, t: TaskView): readonly Site[] {
  cards.length = 0;
  if (t.resource !== 'gpu' || t.accelDomain === null) return cards;
  for (const site of m.installed.gpu) {
    const p = site.part!;
    if (t.accelDomain === POOL_DOMAIN) { if (p.kind === 'gpu') cards.push(site); continue; }
    if (site.index !== t.accelDomain) continue;
    if (p.kind === 'npu' && (!FAMILIES[t.family]?.tensor || t.gpuCoresMin > 0)) continue;
    cards.push(site);
  }
  return cards;
}

const face = { x: 0, y: 0, w: 0, h: 0 };
/** A card's top face: general cards sit flat in their slot, accelerator modules stand on the tray. */
function faceOf(b: BoardLayout, f: Site['f']): { x: number; y: number; w: number; h: number } {
  face.x = f.x + (b.dimm === 'h' ? 1 : 0); face.y = b.dimm === 'h' ? f.y : f.y - 6;
  face.w = b.dimm === 'h' ? f.w - 2 : f.w; face.h = b.dimm === 'h' ? f.h - 9 : f.h - 6;
  return face;
}
/** The shard's piece on each card serving it: a gauge on the card face, draining as the stage runs. */
export function drawGpuPiece(g: G, m: BoardModel, t: TaskView): number {
  const list = servingCards(m, t), colour = flowColor(t), left = remaining(t.progress);
  for (const site of list) {
    const r = faceOf(m.b, site.f);
    // General cards keep their heatsink block (right 12 px) clear; modules use the face's foot.
    if (m.b.dimm === 'h') drawPiece(g, r.x + 2, r.y + (r.h >> 1) - 2, r.w - 14, 4, left, colour);
    else drawPiece(g, r.x + 2, r.y + r.h - 8, r.w - 4, 4, left, colour);
  }
  return list.length;
}
