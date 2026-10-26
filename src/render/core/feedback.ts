// Feedback the core draws over the focus world, each one authorized by real state:
// - payout pops: one per task completion, on the component that finished it (pops.ts);
// - the failure beat: a red cause mark at the pipe mouth when a task fails (A11);
// - the purchase flash: a gold fill on a part whose level or generation just rose, or that just
//   appeared, for 300 ms, once (A10).
// Sim events are read once each, by `seq`. A load or reset consumes what it carries without drawing.
import type { RenderSnapshot } from '../../game';
import type { Camera, PixelRatio, RestFraming } from './camera';
import { projectRect } from './camera';
import type { CauseMark } from './feed';
import { drawCause } from './feed';
import type { Rect } from './geom';
import { rect } from './geom';
import type { Typography } from './labels';
import { P } from './palette';
import { POP_LIFE_MS, PayoutPops, completionMs } from './pops';
import type { Completion } from './pops';
import { R, brackets } from './px';
import { ShardMarks, shardsDoneOf } from './shardDone';
import type { HitTarget, LevelRenderer, LevelSnapshot, WorldForm } from './types';

/** Wall seconds. */
export const FAIL_BEAT_S = 0.4, FLASH_S = 0.3;
const lastSeqOf = (list: readonly { readonly seq?: number }[]): number => {
  let m = -1;
  for (const e of list) if (e.seq !== undefined && e.seq > m) m = e.seq;
  return m;
};

const childKeys = new Map<string, string>();
/** A stable key per child node (cached: no per-frame strings). */
function childKey(level: string, id: number): string {
  const k = level + id;
  let v = childKeys.get(k);
  if (v === undefined) { v = `child:${level}:${id}`; if (childKeys.size < 4096) childKeys.set(k, v); }
  return v;
}
export class Feedback {
  readonly pops = new PayoutPops();
  /** D25: finished non-final shards, drawn as their piece emptying (no pay). */
  readonly shards = new ShardMarks();
  private lastShard = -1;
  private lastCompletion = -1;
  private completionSnap: RenderSnapshot | null = null;
  private lastFailure = -1;
  private failSeen = -Infinity;
  private failCause: CauseMark = 'cantRun';
  private readonly versions = new Map<string, number>();
  private versionsFor: LevelSnapshot | null = null;
  private primed = false;
  private flashAt = -Infinity;
  private readonly flashRect = rect();
  private readonly scratch = rect();

  /** A new epoch (load, reset): everything it carries is history. */
  reset(s: RenderSnapshot): void {
    this.pops.clear(); this.leaveWorld(); this.lastShard = lastSeqOf(shardsDoneOf(s));
    this.lastCompletion = lastSeqOf(s.completions ?? []); this.completionSnap = s;
    this.lastFailure = lastSeqOf(s.failures ?? []); this.failSeen = -Infinity;
  }
  /** The focus world changed: its pops, part versions and flash go with it. */
  leaveWorld(): void { this.pops.clear(); this.shards.clear(); this.versions.clear(); this.versionsFor = null; this.primed = false; this.flashAt = -Infinity; }

  /** Read new completions and failures. `pop`: at rest and running, so pops are placed; else only consumed. */
  take(s: RenderSnapshot, level: LevelRenderer, form: WorldForm, timeMs: number, nowS: number, pop: boolean): void {
    for (const f of s.failures ?? []) if (f.seq > this.lastFailure) { this.lastFailure = f.seq; this.failSeen = nowS; this.failCause = f.cause; }
    const list: readonly Completion[] = s.completions ?? [];
    if (this.completionSnap === s) return;
    this.completionSnap = s;
    for (const d of shardsDoneOf(s)) {
      if (d.seq <= this.lastShard) continue;
      this.lastShard = d.seq;
      if (!pop || (!level.payoutAnchor && !level.shardAnchor)) continue;
      const t = completionMs(d as unknown as Completion, s.tick);
      if (timeMs - t >= POP_LIFE_MS) continue;
      const fill = !!level.shardAnchor;
      const key = level.shardAnchor ? level.shardAnchor(s.focus as never, d, this.scratch)
        : level.payoutAnchor ? level.payoutAnchor(s.focus as never, d as unknown as Completion, this.scratch, form) : -1;
      if (key >= 0) this.shards.add(key, this.scratch, t, fill);
    }
    for (const c of list) {
      if (c.seq !== undefined) { if (c.seq <= this.lastCompletion) continue; this.lastCompletion = c.seq; }
      if (!pop || !level.payoutAnchor) continue;
      const t = completionMs(c, s.tick);
      if (timeMs - t >= POP_LIFE_MS) continue;
      const key = level.payoutAnchor(s.focus as never, c, this.scratch, form);
      if (key >= 0) this.pops.add(key, this.scratch, t, c.credits, c.data, level.popWindowMs?.(s.focus as never));
    }
  }

  /**
   * Compare each part target's version with the last snapshot of the same world. The first sight of
   * a world only primes the table. Call at rest once per new focus snapshot.
   */
  parts(s: LevelSnapshot, level: LevelRenderer, targets: readonly HitTarget[], count: number, nowS: number): void {
    if (s === this.versionsFor) return;
    this.versionsFor = s;
    for (let i = 0; i < count; i++) {
      const t = targets[i]!;
      // A part flashes when its version rises; a child (a sled, a rack, a site's hall) when it first
      // appears, keyed by what it drills into so the key survives the list reordering.
      let key: string, v: number | null;
      if (t.kind === 'part') { key = t.id; v = level.partVersion ? level.partVersion(s as never, t.id) : null; }
      else if (t.kind === 'child' && t.drill) { key = childKey(t.drill.level, t.drill.id); v = 0; }
      else continue;
      if (v === null) continue;
      const before = this.versions.get(key);
      if (this.primed && (before === undefined || v > before)) {
        this.flashAt = nowS;
        this.flashRect.x = t.rect.x; this.flashRect.y = t.rect.y; this.flashRect.w = t.rect.w; this.flashRect.h = t.rect.h;
      }
      this.versions.set(key, v);
    }
    this.primed = true;
  }

  drawPops(g: CanvasRenderingContext2D, timeMs: number, cam: Camera, vp: Rect, ratio: PixelRatio, type: Typography, n: number,
    clip: Rect, reduced: boolean): void {
    this.shards.draw(g, timeMs, cam, vp, ratio, n, clip);
    this.pops.draw(g, timeMs, cam, vp, ratio, type, n, clip, reduced);
  }
  /** The purchase flash: a gold fill and a 1·N gold bracket on the part, once. */
  drawFlash(g: CanvasRenderingContext2D, nowS: number, cam: Camera, vp: Rect, ratio: PixelRatio): void {
    const age = nowS - this.flashAt;
    if (age < 0 || age >= FLASH_S) return;
    const r = projectRect(cam, vp, ratio, this.flashRect, this.scratch), n = cam.s / ratio.x;
    g.save(); g.setTransform(ratio.x, 0, 0, ratio.y, 0, 0);
    g.beginPath(); g.rect(vp.x, vp.y, vp.w, vp.h); g.clip();
    g.globalAlpha = 0.35 * (1 - age / FLASH_S); g.fillStyle = P.gold; g.fillRect(r.x, r.y, r.w, r.h);
    g.globalAlpha = 1; g.translate(r.x - n, r.y - n); g.scale(n, n);
    brackets(g, 0, 0, Math.round(r.w / n) + 2, Math.round(r.h / n) + 2, P.gold);
    g.restore();
  }
  /** The failure beat at the pipe mouth: the cause's mark, red on an ink plate, at the shell's N. */
  drawFailure(g: CanvasRenderingContext2D, nowS: number, f: RestFraming, vp: Rect, ratio: PixelRatio): void {
    const p = f.pipe;
    if (!p || nowS - this.failSeen >= FAIL_BEAT_S || nowS < this.failSeen) return;
    const n = f.scale;
    g.save(); g.setTransform(ratio.x * n, 0, 0, ratio.y * n, 0, 0);
    g.beginPath(); g.rect(vp.x / n, vp.y / n, vp.w / n, vp.h / n); g.clip();
    const x = Math.round(p.x / n) - 4, y = Math.round(p.y / n) + 2;
    R(g, x, y, 9, 9, P.ink); R(g, x + 1, y + 1, 7, 7, '#2a0f18');
    drawCause(g, this.failCause, x + 2, y + 2, P.fault);
    g.restore();
  }
}
