import { describe, expect, it } from 'vitest';
import { flowColor } from '../../core';
import type { FlowView, WorldFrame } from '../../core';
import { familyId } from '../../../game';
import { colorAt, recordingContext } from '../../core/testCanvas';
import { drawWells, wellGrid, WELL_EMPTY } from './flowkit';
import { FAM, queueOf } from './flowFixtures';
import { CASES } from './fixtures';
import { FORK_Y, WAIT_AT, drawRackFlows, forkXs } from './flows';
import { LB_RECT, LB_WELLS, UPLINK_X, portCx } from './layout';
import { drawLB } from './infra';

const frame = { snapshot: { simTimeMs: 5000 }, timeMs: 5000, paused: false, reducedMotion: false, zoom: null } as unknown as WorldFrame;
const parallel = flowColor({ family: familyId(FAM.parallel) }), memory = flowColor({ family: familyId(FAM.memory) });

describe('rack D25 flows', () => {
  const s = CASES.flows(5000), flows = s.flows as readonly FlowView[];
  it('groups shards by task and forks at the switch from the uplink jack to each port', () => {
    const xs: number[] = [];
    // task 41: shards on ports of slots 0 and 3 (ports 0 and 3), the rest still on the uplink
    expect(forkXs(s, flows, 0, xs)).toBe(3);
    expect(xs).toEqual([UPLINK_X, portCx(0), portCx(3)]);
    // task 43: two shards on ports 9 and 10
    expect(forkXs(s, flows, flows.findIndex(f => f.taskId === 43), xs)).toBe(3);
    expect(xs).toEqual([UPLINK_X, portCx(9), portCx(10)]);
    // an unsplit task has no fork
    expect(forkXs(s, flows, flows.findIndex(f => f.taskId === 44), xs)).toBe(0);
    const rec = recordingContext();
    expect(drawRackFlows(rec.g, s, frame)).toBe(true);
    const bar = rec.fills.find(f => f.c === parallel && f.y === FORK_Y && f.h === 1 && f.w > 3);
    expect(bar).toMatchObject({ x: portCx(0), w: UPLINK_X - portCx(0) + 1 });
  });
  it('draws the uplink as one travelling shard and the rest as a waiting stack at its mouth', () => {
    const rec = recordingContext();
    drawRackFlows(rec.g, s, frame);
    // three waiting shards, oldest at the mouth: two of task 41 (Parallel), then task 42 (Memory)
    const pip = (k: number) => colorAt(rec.fills, WAIT_AT.x, WAIT_AT.y + 3 * k);
    expect([pip(0), pip(1), pip(2), pip(3)]).toEqual([parallel, parallel, memory, null]);
  });
  it('draws nothing without flows, so the per-port fallback runs', () => {
    expect(drawRackFlows(recordingContext().g, CASES.overview(5000), frame)).toBe(false);
  });
});

describe('router queue wells', () => {
  it('draws one well per slot, filled by its entries, the rest dark', () => {
    for (const slots of [1, 8, 32]) {
      const rec = recordingContext(), q = queueOf(slots, [FAM.parallel, FAM.memory, FAM.parallel]);
      expect(drawWells(rec.g, q, 0, 0, 12, 8, true)).toBe(slots);
      expect(rec.fills).toHaveLength(slots);
      expect(rec.fills.filter(f => f.c !== WELL_EMPTY)).toHaveLength(Math.min(slots, 3));
      // every well inside the box
      for (const f of rec.fills) { expect(f.x + f.w).toBeLessThanOrEqual(12); expect(f.y + f.h).toBeLessThanOrEqual(8); expect(f.w).toBeGreaterThan(0); }
    }
  });
  it('shows every well empty while dark or paused', () => {
    const rec = recordingContext();
    drawWells(rec.g, queueOf(4, [FAM.compute, FAM.compute]), 0, 0, 12, 8, false);
    expect(rec.fills.every(f => f.c === WELL_EMPTY)).toBe(true);
  });
  it('keeps 1 px gaps when they fit', () => {
    expect(wellGrid(8, 12, 8)).toMatchObject({ cols: 4, rows: 2, gx: 1, gy: 1 });
    expect(wellGrid(1, 12, 8)).toMatchObject({ cols: 1, rows: 1, cw: 3, ch: 4 });
    // a crowded queue keeps its rows apart, so it reads as rows filling left to right
    expect(wellGrid(32, 12, 8)).toMatchObject({ cols: 11, rows: 3, gy: 1 });
  });
  it('fills the rack LB slot from lb.queue, inside its wells box', () => {
    const rec = recordingContext(), s = CASES.flows(5000), b = LB_WELLS, y0 = LB_RECT.y + b.dy;
    drawLB(rec.g, s, false);
    const inBox = rec.fills.filter(f => f.x >= b.x && f.x + f.w <= b.x + b.w && f.y >= y0 && f.y + f.h <= y0 + b.h);
    expect(inBox.filter(f => f.c === WELL_EMPTY)).toHaveLength(5);
    expect(inBox.filter(f => f.c === flowColor(s.lb.queue.entries[0]!))).toHaveLength(1);
    expect(b.x + b.w).toBeLessThanOrEqual(LB_RECT.x + LB_RECT.w - 6);
  });
});
