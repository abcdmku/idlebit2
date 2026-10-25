import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RenderSnapshot } from '../../game';
import { familyId } from '../../game';
import { camera } from './camera';
import { drawFlow, drawFork, flowColor, flowPhase } from './flows';
import type { FlowView } from './flows';
import { rect } from './geom';
import { inbound } from './pipe';
import { ShardMarks } from './shardDone';
import { recordingContext } from './testCanvas';

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => recordingContext().g as unknown as ReturnType<HTMLCanvasElement['getContext']>);
});
afterEach(() => vi.restoreAllMocks());
const flow = (o: Partial<FlowView>): FlowView => ({ taskId: 1, family: familyId(0), systemId: 0 as never, link: 'uplink', bitsSent: 0, bits: 1000, speed: 1000, shard: 0, shards: 4, ...o }) as FlowView;
const SNAP = { simTimeMs: 1000 } as RenderSnapshot;

describe('D25 flows', () => {
  it('travels at its real progress, waits unsent, and flashes when shorter than a frame', () => {
    expect(flowPhase(flow({ bitsSent: 10 }))).toBe('travel');
    expect(flowPhase(flow({}))).toBe('waiting');
    expect(flowPhase(flow({ bits: 10, speed: 1000 }))).toBe('landing');
    const rec = recordingContext();
    expect(drawFlow(rec.g, flow({ bitsSent: 500 }), [[0, 0], [0, 100]], SNAP, 1000)).toBe('travel');
    expect(rec.fills.some(f => f.c === flowColor(flow({})))).toBe(true);
    const idle = recordingContext();
    expect(drawFlow(idle.g, flow({}), [[0, 0], [0, 100]], SNAP, 1000)).toBe('waiting');
    expect(idle.fills).toHaveLength(0);
  });
  it('draws one fork bar across the branches of a task, and none for one branch', () => {
    const rec = recordingContext(); drawFork(rec.g, [10, 30, 50], 5, '#7fe3ff');
    expect(rec.fills.filter(f => f.c === '#7fe3ff' && f.w === 41)).toHaveLength(1);
    const one = recordingContext(); drawFork(one.g, [10], 5, '#7fe3ff'); expect(one.fills).toHaveLength(0);
  });
  it('feeds the pipe from the level top-link shard: the travelling one, else the first waiting', () => {
    const rack = { level: 'rack', switch: { uplinks: [{ speedHz: 1e4 }] }, servers: [],
      flows: [flow({ shard: 1 }), flow({ shard: 0 }), flow({ link: 'server', shard: 2, bitsSent: 9 })] };
    const out = inbound({ focus: rack, feed: { transfers: [] } } as unknown as RenderSnapshot, { name: '', speed: 0, transfer: null });
    expect((out.transfer as FlowView).shard).toBe(0);
  });
  it('drains a finished shard\'s piece over 300 ms, merging marks per component', () => {
    const m = new ShardMarks(), cam = Object.assign(camera(), { s: 3 }), vp = rect(0, 0, 600, 400);
    m.add(0, rect(0, 0, 10, 10), 1000); m.add(0, rect(0, 0, 10, 10), 1050);
    const draw = (t: number) => { const rec = recordingContext(); m.draw(rec.g, t, cam, vp, { x: 1, y: 1 }, 3, vp); return rec.fills.length; };
    expect(draw(1100)).toBe(3); expect(draw(1400)).toBe(0);
  });
});
