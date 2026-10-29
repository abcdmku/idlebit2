import { familyId, type ChipQueueEntryView, type ChipSnapshot } from '../../../game';
import { drawFamilyIcon, P, type WorldFrame, type WorldForm } from '../../core';
import { coreSites, queueWells, type Floor } from './layout';

const COLLAPSE_MS = 140, TRAVEL_MS = 280;
const identity = (task: number, shard = 0): string => `${task}:${shard}`;
interface Pickup {
  readonly task: number;
  readonly shard: number;
  readonly cores: readonly number[];
  readonly well: number;
  readonly family: number;
  readonly started: number;
}

/** A visible queued shard collapses in its own well; only its bits travel to the assigned cores. */
export class QueuePickups {
  private key = '';
  private tick = -1;
  private waiting: readonly ChipQueueEntryView[] = [];
  private staged: (ChipQueueEntryView | null)[] | undefined;
  private holdUntil = 0;
  private flights: Pickup[] = [];

  update(chip: ChipSnapshot, frame: WorldFrame): readonly (ChipQueueEntryView | null)[] | undefined {
    const key = `${frame.snapshot.epoch}:${frame.snapshot.hud.roundIndex}:${chip.systemId}:${chip.socket}`;
    if (key !== this.key || frame.snapshot.tick < this.tick) {
      this.key = key; this.tick = -1; this.waiting = []; this.staged = undefined; this.flights = [];
    }
    if (frame.timeMs >= this.holdUntil) this.staged = undefined;
    if (frame.snapshot.tick !== this.tick) {
      if (this.tick >= 0 && chip.scheduler && !frame.paused) {
        const queued = new Set(chip.queue.map(q => identity(q.taskId, q.shard)));
        const visible = this.staged ?? this.waiting;
        for (const entry of this.waiting) {
          const id = identity(entry.taskId, entry.shard);
          if (queued.has(id)) continue;
          const cores: number[] = [];
          chip.cores.forEach((core, index) => {
            if (core.taskId === entry.taskId && (core.shard ?? 0) === (entry.shard ?? 0) && core.activity !== 'preload') cores.push(index);
          });
          const well = visible.findIndex(q => q && identity(q.taskId, q.shard) === id);
          // A task that arrived and started between snapshots had no visible queue well.
          if (!cores.length || well < 0) continue;
          this.flights.push({ task: entry.taskId, shard: entry.shard ?? 0, cores, well, family: entry.family, started: frame.timeMs });
          this.staged ??= [...this.waiting];
          this.staged[well] = null;
          this.holdUntil = frame.timeMs + COLLAPSE_MS;
        }
      }
      this.waiting = chip.queue;
      this.tick = frame.snapshot.tick;
    }
    if (!chip.scheduler || frame.paused) { this.flights = []; this.staged = undefined; }
    this.flights = this.flights.filter(f => frame.timeMs - f.started < COLLAPSE_MS + TRAVEL_MS).slice(-64);
    return this.staged;
  }

  draw(g: CanvasRenderingContext2D, chip: ChipSnapshot, frame: WorldFrame, floor: Floor, count: number, form: WorldForm): void {
    if (!chip.scheduler) return;
    const wells = queueWells(floor, chip.scheduler.q, form), sites = coreSites(floor, count);
    for (const flight of this.flights) {
      const source = wells[flight.well];
      if (!source) continue;
      const age = Math.max(0, frame.timeMs - flight.started), cx = source.x + source.w / 2, cy = source.y - 2 + 8;
      if (frame.reducedMotion) {
        g.strokeStyle = P.net;
        for (const core of flight.cores) { const r = sites[core]; if (r) g.strokeRect(r.x - 1, r.y - 1, r.w + 2, r.h + 2); }
        continue;
      }
      if (age < COLLAPSE_MS) {
        const full = Math.min(16, source.w), size = full - (full - 2) * age / COLLAPSE_MS;
        g.strokeStyle = P.net; g.strokeRect(source.x - 1, source.y - 2, source.w + 2, source.h + 3);
        g.save(); g.translate(Math.round(cx - size / 2), Math.round(cy - size / 2)); g.scale(size / 16, size / 16);
        drawFamilyIcon(g, familyId(flight.family), 0, 0); g.restore();
        continue;
      }
      for (const core of flight.cores) {
        if (core >= chip.cores.length) continue;
        const target = sites[core];
        if (!target) continue;
        // The left gutter and row gaps keep bits clear of every other core.
        const rail = floor.die.x + 1;
        const route = [
          [cx, cy], [cx, floor.queue.y + floor.queue.h + 2], [rail, floor.queue.y + floor.queue.h + 2],
          [rail, target.y - 2], [target.x + target.w / 2, target.y - 2], [target.x + target.w / 2, target.y + target.h / 2],
        ] as const;
        for (let bit = 0; bit < 3; bit++) {
          const t = (age - COLLAPSE_MS - bit * 18) / (TRAVEL_MS - 36);
          if (t < 0 || t > 1) continue;
          drawBit(g, route, t, bit === 0 ? P.net : P.cacheOn);
        }
      }
    }
  }
}

function drawBit(g: CanvasRenderingContext2D, route: readonly (readonly [number, number])[], t: number, color: string): void {
  const lengths = route.slice(1).map((point, i) => Math.abs(point[0] - route[i]![0]) + Math.abs(point[1] - route[i]![1]));
  let distance = t * lengths.reduce((sum, length) => sum + length, 0);
  for (let i = 0; i < lengths.length; i++) {
    const a = route[i]!, b = route[i + 1]!, length = lengths[i]!;
    if (distance > length) { distance -= length; continue; }
    const step = length ? distance / length : 1;
    const x = Math.round(a[0] + (b[0] - a[0]) * step), y = Math.round(a[1] + (b[1] - a[1]) * step);
    g.fillStyle = P.ink; g.fillRect(x - 1, y - 1, 4, 4);
    g.fillStyle = color; g.fillRect(x, y, 2, 2);
    return;
  }
}
