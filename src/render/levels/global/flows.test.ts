import { describe, expect, it } from 'vitest';
import { flowColor } from '../../core';
import type { FlowView, WorldFrame } from '../../core';
import { familyId } from '../../../game';
import { recordingContext } from '../../core/testCanvas';
import { FAM } from '../rack/flowFixtures';
import { CASES as GLOBAL } from './fixtures';
import { drawGlobalFlows, drawGlobalForks, hubFork, zoneOfFlow } from './flows';

HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext'];
const frame = { snapshot: { simTimeMs: 5000 }, timeMs: 5000, paused: false, reducedMotion: false, zoom: null } as unknown as WorldFrame;
const color = (f: number) => flowColor({ family: familyId(f) });

describe('world D25 flows', () => {
  const s = GLOBAL.flows(5000), flows = s.flows as readonly FlowView[];
  it('maps each flow to the zone tile of its room', () => {
    const z = zoneOfFlow(s, flows[6]!);
    expect([z.site, z.zone]).toEqual([0, 0]);
  });
  it('draws a fork for a split task and a waiting stack beside the hub', () => {
    const rec = recordingContext();
    drawGlobalForks(rec.g, s);
    expect(drawGlobalFlows(rec.g, s, frame)).toBe(true);
    expect(rec.fills.filter(f => f.c === color(FAM.zones) && f.h === 1 && f.w > 3).length).toBeGreaterThan(0);
    expect(rec.fills.filter(f => f.c === color(FAM.region) && f.w === 2 && f.h === 1).length).toBeGreaterThan(0);
  });
});

describe('world hub fork', () => {
  it('branches once per site a split task leaves the hub for', () => {
    const s = GLOBAL.flows(5000), flows = s.flows as readonly FlowView[], xs: number[] = [];
    // task 61: backbone shards to EU West and AP South (the zone shards are in US West, behind its own landing)
    expect(hubFork(s, flows, 0, xs)).toBe(2);
    expect(xs[1]! - xs[0]!).toBe(3);
  });
});
