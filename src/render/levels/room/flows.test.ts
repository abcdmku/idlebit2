import { describe, expect, it } from 'vitest';
import { flowColor } from '../../core';
import type { FlowView, WorldFrame } from '../../core';
import { familyId } from '../../../game';
import { colorAt, recordingContext } from '../../core/testCanvas';
import { WELL_EMPTY } from '../rack/flowkit';
import { FAM } from '../rack/flowFixtures';
import { CASES } from './fixtures';
import { WAIT_AT, drawRoomFlows, forkXs } from './flows';
import { LB_WELLS_DY, drawNetRack } from './infra';
import { NET_FOOT, RACK_RECTS, SPINE, hallOf, trayY } from './layout';

HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext'];
const frame = { snapshot: { simTimeMs: 5000 }, timeMs: 5000, paused: false, reducedMotion: false, zoom: null } as unknown as WorldFrame;
const color = (f: number) => flowColor({ family: familyId(f) });

describe('room D25 flows', () => {
  const s = CASES.flows(5000), flows = s.flows as readonly FlowView[], trunk = hallOf(1).trunk + 1;
  it('forks a split task along each row tray, from the trunk to each rack its shards take', () => {
    const xs: number[] = [];
    expect(forkXs(s, flows, 0, 0, xs)).toBe(3);
    expect(xs).toEqual([trunk, RACK_RECTS[0].x + 8, RACK_RECTS[2].x + 8]);
    expect(forkXs(s, flows, 0, 1, xs)).toBe(2);
    expect(xs).toEqual([trunk, RACK_RECTS[9].x + 8]);
    // the unsplit task forks nowhere
    expect(forkXs(s, flows, flows.findIndex(f => f.taskId === 53), 0, xs)).toBe(0);
    const rec = recordingContext();
    expect(drawRoomFlows(rec.g, s, frame)).toBe(true);
    expect(rec.fills.some(f => f.c === color(FAM.parallel) && f.y === trayY(0) && f.h === 1 && f.w > 3)).toBe(true);
  });
  it('stacks the zone link\'s waiting shards at the fibre mouth, in order', () => {
    const rec = recordingContext();
    drawRoomFlows(rec.g, s, frame);
    const pip = (k: number) => colorAt(rec.fills, WAIT_AT.x, WAIT_AT.y + 3 * k);
    expect([pip(0), pip(1), pip(2), pip(3)]).toEqual([color(FAM.parallel), color(FAM.parallel), color(FAM.cluster), null]);
  });
  it('draws the room LB queue wells under the port lights: slots wells, entries filled', () => {
    for (const [c, slots, filled] of [['flows', 8, 3], ['queue32', 32, 27]] as const) {
      const rec = recordingContext(), room = CASES[c](5000);
      drawNetRack(rec.g, room, true, true, 5000);
      const top = NET_FOOT.y - SPINE.z + NET_FOOT.h + LB_WELLS_DY, bottom = NET_FOOT.y - SPINE.z + NET_FOOT.h + SPINE.z - 2;
      const wells = rec.fills.filter(f => f.y >= top && f.y + f.h <= bottom && f.x >= NET_FOOT.x && f.x + f.w <= NET_FOOT.x + NET_FOOT.w && f.h <= 3);
      expect(wells).toHaveLength(slots);
      expect(wells.filter(f => f.c !== WELL_EMPTY)).toHaveLength(filled);
    }
  });
});
