import { familyId, type ChipSnapshot } from '../../../game';
import { drawFamilyIcon, P, type Rect, type WorldFrame, type WorldForm } from '../../core';
import { coreSites, queueWells, type Floor } from './layout';

interface Pickup { readonly task: number; readonly core: number; readonly well: number; readonly family: number; readonly started: number }
/** Each observed assignment gets one queue-to-core handoff. No flow is drawn for idle hardware. */
export class QueuePickups {
  private key = '';
  private tick = -1;
  private running: readonly (number | null)[] = [];
  private waiting = new Map<number, number>();
  private flights: Pickup[] = [];

  draw(g: CanvasRenderingContext2D, chip: ChipSnapshot, frame: WorldFrame, floor: Floor, count: number, form: WorldForm): void {
    const key = `${frame.snapshot.epoch}:${frame.snapshot.hud.roundIndex}:${chip.systemId}:${chip.socket}`;
    if (key !== this.key || frame.snapshot.tick < this.tick) {
      this.key = key; this.tick = -1; this.running = []; this.waiting.clear(); this.flights = [];
    }
    if (frame.snapshot.tick !== this.tick) {
      if (this.tick >= 0 && chip.scheduler && !frame.paused) chip.cores.forEach((core, index) => {
        if (core.taskId !== null && core.family !== null && core.taskId !== this.running[index])
          this.flights.push({ task: core.taskId, core: index, well: this.waiting.get(core.taskId) ?? 0,
            family: core.family, started: frame.timeMs });
      });
      this.running = chip.cores.map(core => core.taskId);
      this.waiting = new Map(chip.queue.map((task, index) => [task.taskId, index]));
      this.tick = frame.snapshot.tick;
    }
    if (!chip.scheduler) { this.flights = []; return; }
    if (frame.paused) { this.flights = []; return; }
    const wells = queueWells(floor, chip.scheduler.q, form), sites = coreSites(floor, count);
    this.flights = this.flights.filter(flight => frame.timeMs - flight.started < 420 && flight.core < chip.cores.length).slice(-64);
    for (const flight of this.flights) {
      const source = wells[Math.min(flight.well, wells.length - 1)], target = sites[flight.core];
      if (!source || !target) continue;
      const t = Math.max(0, Math.min(1, (frame.timeMs - flight.started) / 420));
      if (frame.reducedMotion) {
        g.strokeStyle = P.net; g.strokeRect(target.x - 1, target.y - 1, target.w + 2, target.h + 2); continue;
      }
      // Use the die's left gutter; a handoff never crosses another core's tile.
      const rail = floor.die.x + 1;
      const route: readonly Rect[] = [
        { x: source.x + source.w / 2, y: source.y + source.h / 2, w: 0, h: 0 },
        { x: source.x + source.w / 2, y: floor.queue.y + floor.queue.h + 2, w: 0, h: 0 },
        { x: rail, y: floor.queue.y + floor.queue.h + 2, w: 0, h: 0 },
        { x: rail, y: target.y - 2, w: 0, h: 0 },
        { x: target.x + target.w / 2, y: target.y - 2, w: 0, h: 0 },
        { x: target.x + target.w / 2, y: target.y + target.h / 2, w: 0, h: 0 },
      ];
      const lengths = route.slice(1).map((point, i) => Math.abs(point.x - route[i]!.x) + Math.abs(point.y - route[i]!.y));
      let distance = t * lengths.reduce((sum, length) => sum + length, 0), x = route[0]!.x, y = route[0]!.y;
      for (let i = 0; i < lengths.length; i++) {
        const a = route[i]!, b = route[i + 1]!, length = lengths[i]!;
        const step = length ? Math.min(1, distance / length) : 1;
        x = a.x + (b.x - a.x) * step; y = a.y + (b.y - a.y) * step;
        if (distance <= length) break; distance -= length;
      }
      g.fillStyle = P.ink; g.fillRect(Math.round(x) - 9, Math.round(y) - 9, 18, 18);
      drawFamilyIcon(g, familyId(flight.family), Math.round(x) - 8, Math.round(y) - 8);
    }
  }
}
