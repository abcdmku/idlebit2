// D25 shard flows: the shared pieces every level uses to draw a split task.
// - A task arrives from the top and splits into shards. Each shard is its own transfer; a shared
//   uplink carries a task's shards one after another, ports carry them in parallel.
// - Positions come only from bitsSent / bits (plus the presentation extrapolation). A transfer
//   shorter than MIN_VISIBLE_TRANSFER_S is a landing flash at its end (D12.4). No synthetic motion.
// - Shards of one take share `taskId`; the fork is drawn at the router where their paths diverge.
// Router-queue wells (LbView.queue) are drawn by each level in its LB slot (rack/flowkit.ts).
import type { FamilyId, NodeRef, RenderSnapshot, TransferView } from '../../game';
import { typeColor, typeOf } from './familyIcons';
import { MIN_VISIBLE_TRANSFER_S, transferProgress } from './pipe';
import { P, mix } from './palette';
import { R, glowBit, pathAt, px } from './px';
import type { PixelPath } from './px';
import type { Point } from './geom';

/** A D25 transfer: one shard on one link. */
export type FlowView = Omit<TransferView, 'link'> & {
  readonly link: TransferView['link'] | 'uplink';
  readonly shard?: number; readonly shards?: number; readonly units?: number;
  readonly from?: NodeRef | null; readonly to?: NodeRef; readonly key?: number;
};
/** A level snapshot's `flows` (Rack, Room, Global), or none before the sim sends them. */
export function flowsOf(s: object): readonly FlowView[] {
  return (s as { readonly flows?: readonly FlowView[] }).flows ?? [];
}
/** Where a flow is drawn this frame: travelling at its real progress, landing (flash), or not shown. */
export type FlowPhase = 'travel' | 'landing' | 'waiting';
export function flowPhase(f: FlowView): FlowPhase {
  if (f.bits <= 0 || f.speed <= 0) return 'landing';
  if (f.bits / f.speed < MIN_VISIBLE_TRANSFER_S) return 'landing';
  return f.bitsSent > 0 ? 'travel' : 'waiting';
}
/** A shard's colour: its task type's (D23), so a task's pieces read as one set. */
export const flowColor = (f: { readonly family: FamilyId }): string => typeColor(typeOf(f.family));

const at: Point = { x: 0, y: 0 };
/**
 * Draw one shard on `path` (art px) at its real progress. Waiting shards (a shared uplink's later
 * shards) are not drawn on the path; the caller shows them as a stack at the link's mouth.
 * Returns the phase it drew.
 */
export function drawFlow(g: CanvasRenderingContext2D, f: FlowView, path: PixelPath, s: RenderSnapshot, timeMs: number): FlowPhase {
  const phase = flowPhase(f);
  if (phase === 'waiting') return phase;
  if (phase === 'landing') {
    const e = path[path.length - 1]!;
    R(g, e[0] - 2, e[1] - 2, 4, 4, mix(flowColor(f), '#ffffff', 0.5));
    return phase;
  }
  pathAt(path, transferProgress(f as TransferView, s.simTimeMs, timeMs), at);
  glowBit(g, at.x, at.y, f.bits, flowColor(f));
  return phase;
}
/** A link's waiting shards: one pip each (at most `max`), stacked from (x, y) downward. */
export function drawWaiting(g: CanvasRenderingContext2D, x: number, y: number, count: number, color: string, max = 6): void {
  for (let i = 0; i < Math.min(count, max); i++) { R(g, x - 2, y + i * 3, 4, 2, P.ink); R(g, x - 1, y + i * 3, 2, 1, color); }
}
/**
 * The fork at a router: a bar in the task's colour across the branch points, with a tick down to
 * each. `xs` are the branches' x (art px) at the router's row `y`. One branch draws nothing.
 */
export function drawFork(g: CanvasRenderingContext2D, xs: readonly number[], y: number, color: string): void {
  if (xs.length < 2) return;
  let lo = Infinity, hi = -Infinity;
  for (const x of xs) { lo = Math.min(lo, x); hi = Math.max(hi, x); }
  R(g, lo, y - 1, hi - lo + 1, 3, P.ink); R(g, lo, y, hi - lo + 1, 1, color);
  for (const x of xs) { R(g, x - 1, y, 3, 3, P.ink); px(g, x, y + 1, color); }
}
